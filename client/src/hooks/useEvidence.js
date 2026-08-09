// ============================================================
// MARCOM / Lumi — useEvidence
// ------------------------------------------------------------
// Server-ranked evidence for one parent's children. Fetches the evidence route
// ON DEMAND, caches per parent+metric, and loads each pair at most once.
//
// TWO DIMENSIONS, ONE IMPLEMENTATION, TWO INSTANCES. The server exposes the
// same contract at two levels — ad-sets ranked against their campaign, and ads
// ranked against their ad-set — so a second hook file would be this one copied
// with a different string in it. The dimension is fixed at CONSTRUCTION rather
// than passed to load():
//
//   const adSetEvidence = useEvidence();                    // default: adset
//   const adEvidence    = useEvidence({ dimension: 'ad' });
//
// which gives each level its own byId/seen maps and keeps the key a bare
// `${parentId}:${metric}`. Threading the dimension through load() instead would
// put a campaign id and an ad-set id in ONE map — the exact collision
// useAdsDrillDown's header rejects for the same reason. Two instances, two
// maps, zero shared state.
//
// SIBLING of useAdsDrillDown and useEntityDrillDown, same shape and same
// `seen`-ref discipline. Keyed by `${parentId}:${metric}` rather than a bare
// id: the same parent ranked by ctr and by roas are two different answers, and
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
//   load(parentId, { metric }): idempotent; retries allowed after an error
// ============================================================
import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

/** PURE: the cache key. Exported so a consumer reads the same entry it asked for. */
export const evidenceKey = (parentId, metric = 'ctr') => `${parentId}:${metric}`;

/**
 * The route per dimension. The two paths are NOT a pattern with a swappable
 * segment — '/entities/:adSetId/evidence' and '/entities/:campaignId/adsets/
 * evidence' differ in shape because the shorter one would otherwise be the same
 * express pattern as the ad-set list route. Building them by concatenation
 * would encode a symmetry the server deliberately does not have.
 */
const EVIDENCE_ROUTE = Object.freeze({
  adset: (parentId) => `/api/lumi/entities/${parentId}/adsets/evidence`,
  ad:    (parentId) => `/api/lumi/entities/${parentId}/evidence`,
});

/**
 * @param {{dimension?: 'adset'|'ad'}} [opts] — which level's children to rank.
 *   Defaults to 'adset', the original behaviour. An unknown dimension falls back
 *   to 'adset' rather than building a URL out of a typo.
 */
export function useEvidence({ dimension = 'adset' } = {}) {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const seen = useRef(new Set());
  const route = EVIDENCE_ROUTE[dimension] ?? EVIDENCE_ROUTE.adset;

  const load = useCallback(async (parentId, { metric = 'ctr' } = {}) => {
    if (!parentId) return;
    const key = evidenceKey(parentId, metric);
    if (seen.current.has(key)) return;
    seen.current.add(key);

    setLoading((s) => ({ ...s, [key]: true }));
    setErrors((s) => ({ ...s, [key]: null }));

    try {
      const res = await api.get(route(parentId), { params: { metric } });
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
  }, [route]);

  return { byId, loading, errors, load };
}
