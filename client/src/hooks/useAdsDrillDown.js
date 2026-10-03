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
// Returns: { byId, loading, errors, failures, load }
//   byId[adSetId]: { entity, objective, children }
//     entity     — the ad-set's own measured row (required on valid success)
//     children[] — never null on success
//   load(adSetId): idempotent; retries allowed for retryable failures
//
// The `seen` ref makes load() load-once + StrictMode-safe (no double fetch).
// ============================================================
import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';
import { parseAdsDrillDownResponse } from './drillDownContracts.js';
import { drillDownFailure } from './drillDownFailure.js';

export function useAdsDrillDown() {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [failures, setFailures] = useState({});
  const seen = useRef(new Set());

  const load = useCallback(async (adSetId) => {
    if (!adSetId || seen.current.has(adSetId)) return;
    seen.current.add(adSetId);

    setLoading((s) => ({ ...s, [adSetId]: true }));
    setErrors((s) => ({ ...s, [adSetId]: null }));
    setFailures((s) => ({ ...s, [adSetId]: null }));

    try {
      const res = await api.get(`/api/lumi/entities/${adSetId}/ads`);
      const parsed = parseAdsDrillDownResponse(res.data);
      setById((s) => ({
        ...s,
        [adSetId]: {
          // The route returns the ad-set's REAL row. The old `{ id: adSetId }`
          // fallback dates from when it echoed back an id stub; keeping it would
          // now substitute a metric-less object for one that has metrics, and a
          // consumer reading entity.ctr would see undefined rather than a number.
          entity: parsed.entity,
          // The campaign objective the ad-set hangs off — null when unknown.
          objective: parsed.objective,
          children: parsed.children,
        },
      }));
    } catch (err) {
      const failure = drillDownFailure(err);
      if (failure.retryable) seen.current.delete(adSetId);
      setFailures((s) => ({ ...s, [adSetId]: failure }));
      setErrors((s) => ({ ...s, [adSetId]: err?.message ?? 'Failed to load ads' }));
    } finally {
      setLoading((s) => ({ ...s, [adSetId]: false }));
    }
  }, []);

  return { byId, loading, errors, failures, load };
}
