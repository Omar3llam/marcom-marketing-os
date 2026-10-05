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
//   error            — HTTP failure; structured failure owns retryability.
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
import { drillDownFailure } from './drillDownFailure.js';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';

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

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const CONTRACT_ERROR = 'Evidence response failed contract validation';

// Admission validates the published contract, never parent/child eligibility.
// There are deliberately no per-side source, period or currency comparisons.
function validEnvelope(envelope, metric) {
  if (!object(envelope)) return false;
  const units = { ctr: 'RATIO', roas: 'MULTIPLE', frequency: 'FREQUENCY' };
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const bound = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
  return envelope.status === 'AVAILABLE' && envelope.kind === 'RELATIVE_BASELINE'
    && envelope.metric === metric && envelope.valueUnit === units[metric]
    && envelope.gapUnit === 'RELATIVE_RATIO' && envelope.gapDenominator === 'PARENT_VALUE'
    && ['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN', 'GA4', 'SHOPIFY', 'MANUAL'].includes(envelope.source)
    && ['ROLLING_WINDOW', 'DAILY', 'CUMULATIVE_30D'].includes(envelope.measurementWindow)
    && bound(envelope.windowStart) && bound(envelope.windowEnd)
    && Date.parse(envelope.windowStart) <= Date.parse(envelope.windowEnd)
    && count(envelope.rankableCount) && count(envelope.comparableCount) && envelope.comparableCount >= 2
    && count(envelope.excludedByEnvelopeCount)
    && envelope.rankableCount === envelope.comparableCount + envelope.excludedByEnvelopeCount
    && (metric === 'roas'
      ? isKnownCurrency(envelope.currency)
        && ['PLATFORM_REPORTED'].includes(envelope.currencyProvenance)
      : envelope.currency === null && envelope.currencyProvenance === null);
}

// Validate this route's success/refusal envelope only. Never reconstruct a
// comparison or validate its arithmetic against the published values.
function validResponse(data, metric) {
  if (!object(data)) return false;
  if (data.insufficientData === true) {
    return data.evidence === null && typeof data.reasonKey === 'string' && data.reasonKey.trim().length > 0
      && (data.reasonKey !== 'COMPARISON_ENVELOPE_UNAVAILABLE' || data.comparisonEnvelope === null);
  }
  const evidence = data.evidence;
  const bottom = evidence?.summary?.bottom;
  return data.insufficientData === false && data.reasonKey === null
    && ['ctr', 'roas', 'frequency'].includes(metric)
    && object(data.entity) && finite(data.entity[metric])
    && object(evidence) && evidence.metric === metric
    && Array.isArray(evidence.ranked) && object(evidence.summary) && object(bottom)
    && finite(bottom[metric]) && finite(bottom._gap) && validEnvelope(data.comparisonEnvelope, metric);
}

/**
 * @param {{dimension?: 'adset'|'ad'}} [opts] — which level's children to rank.
 *   Defaults to 'adset', the original behaviour. An unknown dimension falls back
 *   to 'adset' rather than building a URL out of a typo.
 */
export function useEvidence({ dimension = 'adset' } = {}) {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [failures, setFailures] = useState({});
  const seen = useRef(new Set());
  const route = EVIDENCE_ROUTE[dimension] ?? EVIDENCE_ROUTE.adset;

  const load = useCallback(async (parentId, { metric = 'ctr' } = {}) => {
    if (!parentId) return;
    const key = evidenceKey(parentId, metric);
    if (seen.current.has(key)) return;
    seen.current.add(key);

    setLoading((s) => ({ ...s, [key]: true }));
    setErrors((s) => ({ ...s, [key]: null }));
    setFailures((s) => ({ ...s, [key]: null }));

    try {
      const res = await api.get(route(parentId), { params: { metric } });
      if (!validResponse(res.data, metric)) throw new Error(CONTRACT_ERROR);
      setById((s) => ({
        ...s,
        [key]: {
          entity:    res.data?.entity ?? null,
          objective: res.data?.objective ?? null,
          evidence:  res.data?.evidence ?? null,
          comparisonEnvelope: res.data.comparisonEnvelope ?? null,
          insufficientData: res.data.insufficientData,
          reasonKey: res.data?.reasonKey ?? null,
        },
      }));
    } catch (err) {
      const failure = err?.message === CONTRACT_ERROR
        ? { kind: 'CONTRACT_INVALID', retryable: true } : drillDownFailure(err);
      if (failure.retryable) seen.current.delete(key);
      setFailures((s) => ({ ...s, [key]: failure }));
      setErrors((s) => ({ ...s, [key]: err?.message ?? 'Failed to load evidence' }));
    } finally {
      setLoading((s) => ({ ...s, [key]: false }));
    }
  }, [route]);

  return { byId, loading, errors, failures, load };
}
