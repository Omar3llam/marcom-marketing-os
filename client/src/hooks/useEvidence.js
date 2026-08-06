// ============================================================
// MARCOM / Lumi — useEvidence
// ------------------------------------------------------------
// Server-ranked ad-set evidence for a connector campaign. Fetches
// GET /api/lumi/entities/:campaignId/adsets/evidence ON DEMAND, caches per
// campaign+metric, and loads each pair at most once.
//
// SIBLING of useAdsDrillDown and useEntityDrillDown, same shape and same
// `seen`-ref discipline. Keyed by `${campaignId}:${metric}` rather than a bare
// id: the same campaign ranked by ctr and by roas are two different answers, and
// a bare-id cache would serve the first one forever.
//
// THREE OUTCOMES, NOT TWO. This is the whole reason the hook exists rather than
// a fourth field on useEntityDrillDown:
//   error            — the request failed. Retryable, our fault.
//   insufficientData — the request SUCCEEDED and the engine declined to rank.
//                      Not an error, not empty: a real answer with a reasonKey
//                      naming which input was missing.
//   evidence         — a real ranking.
// Folding a refusal into the error slot would render "couldn't load" over a
// perfectly healthy campaign that simply has two ad sets performing alike.
//
// Returns: { byId, loading, errors, load }
//   byId[key]: { entity, objective, evidence, insufficientData, reasonKey }
//   load(campaignId, { metric }): idempotent; retries allowed after an error
// ============================================================
import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

/** PURE: the cache key. Exported so a consumer reads the same entry it asked for. */
export const evidenceKey = (campaignId, metric = 'ctr') => `${campaignId}:${metric}`;

export function useEvidence() {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const seen = useRef(new Set());

  const load = useCallback(async (campaignId, { metric = 'ctr' } = {}) => {
    if (!campaignId) return;
    const key = evidenceKey(campaignId, metric);
    if (seen.current.has(key)) return;
    seen.current.add(key);

    setLoading((s) => ({ ...s, [key]: true }));
    setErrors((s) => ({ ...s, [key]: null }));

    try {
      const res = await api.get(`/api/lumi/entities/${campaignId}/adsets/evidence`, { params: { metric } });
      setById((s) => ({
        ...s,
        [key]: {
          entity:    res.data?.entity ?? null,
          objective: res.data?.objective ?? null,
          evidence:  res.data?.evidence ?? null,
          // A body that says nothing about sufficiency is treated as a refusal,
          // never as a ranking: the alternative is rendering `evidence: null` as
          // if it were data. `=== true` so a missing field cannot read as false.
          insufficientData: res.data?.insufficientData === true || res.data?.evidence == null,
          reasonKey: res.data?.reasonKey ?? null,
        },
      }));
    } catch (err) {
      seen.current.delete(key); // allow a retry on the next expand
      setErrors((s) => ({ ...s, [key]: err?.message ?? 'Failed to load evidence' }));
    } finally {
      setLoading((s) => ({ ...s, [key]: false }));
    }
  }, []);

  return { byId, loading, errors, load };
}
