// ============================================================
// MARCOM / Lumi — useEntityDrillDown
// ------------------------------------------------------------
// Lazy ad-set drill-down for a connector campaign. Fetches
// GET /api/lumi/entities/:campaignId/adsets ON DEMAND (when a row is expanded),
// caches per entityId, and loads each entity at most once. A 404 from the route
// means "no such campaign in this workspace" → surfaced as an error, never a
// fake-empty expansion.
//
// Returns: { byId, load }
//   byId[entityId]: { loading, error, adSets|null, entity|null, objective|null }
//   load(entityId): kicks off the fetch (idempotent; retries allowed on error)
//
// The `seen` ref makes load() load-once + StrictMode-safe (no double fetch).
// ============================================================
import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useEntityDrillDown() {
  const [byId, setById] = useState({});
  const seen = useRef(new Set());

  const load = useCallback(async (entityId) => {
    if (!entityId || seen.current.has(entityId)) return;
    seen.current.add(entityId);
    setById((s) => ({ ...s, [entityId]: { loading: true, error: null, adSets: null } }));
    try {
      const res = await api.get(`/api/lumi/entities/${entityId}/adsets`);
      setById((s) => ({
        ...s,
        [entityId]: {
          loading: false,
          error: null,
          adSets: Array.isArray(res.data?.adSets) ? res.data.adSets : [],
          // The campaign's own measured row and objective. The route carries
          // both; they were being dropped on the floor here, so a consumer had
          // no baseline to state an ad-set's gap against without re-deriving it.
          entity: res.data?.entity ?? null,
          objective: res.data?.objective ?? null,
        },
      }));
    } catch (err) {
      seen.current.delete(entityId); // allow a retry on the next expand
      setById((s) => ({ ...s, [entityId]: { loading: false, error: err, adSets: null } }));
    }
  }, []);

  return { byId, load };
}
