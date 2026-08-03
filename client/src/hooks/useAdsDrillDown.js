// ============================================================
// MARCOM / Lumi — useAdsDrillDown
// ------------------------------------------------------------
// Lazy ad drill-down for a connector ad-set. Fetches
// GET /api/lumi/entities/:adSetId/ads ON DEMAND, caches per adSetId, and loads
// each ad-set at most once. A 404 means "no such ad set in this workspace" →
// surfaced as an error, never a fake-empty expansion.
//
// SIBLING of useEntityDrillDown, deliberately not a parameterisation of it:
// that hook's cache is keyed by a bare entityId and its payload key is `adSets`,
// which ConnectorCampaignsPanel/DecisionCard/WatchSection read directly. Sharing
// one cache across two levels would also let a campaign id and an ad-set id
// collide in the same map. Two hooks, two maps, zero shared state.
//
// Returns: { byId, loading, errors, load }
//   byId[adSetId]: { entity, children }   — children[] is never null on success
//   load(adSetId): kicks off the fetch (idempotent; retries allowed on error)
//
// The `seen` ref makes load() load-once + StrictMode-safe (no double fetch).
// ============================================================
import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useAdsDrillDown() {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const seen = useRef(new Set());

  const load = useCallback(async (adSetId) => {
    if (!adSetId || seen.current.has(adSetId)) return;
    seen.current.add(adSetId);

    setLoading((s) => ({ ...s, [adSetId]: true }));
    setErrors((s) => ({ ...s, [adSetId]: null }));

    try {
      const res = await api.get(`/api/lumi/entities/${adSetId}/ads`);
      setById((s) => ({
        ...s,
        [adSetId]: {
          entity: res.data?.entity ?? { id: adSetId },
          // A malformed body degrades to an empty drill-down, not to null —
          // the error path is reserved for a request that actually failed.
          children: Array.isArray(res.data?.children) ? res.data.children : [],
        },
      }));
    } catch (err) {
      seen.current.delete(adSetId); // allow a retry on the next expand
      setErrors((s) => ({ ...s, [adSetId]: err?.message ?? 'Failed to load ads' }));
    } finally {
      setLoading((s) => ({ ...s, [adSetId]: false }));
    }
  }, []);

  return { byId, loading, errors, load };
}
