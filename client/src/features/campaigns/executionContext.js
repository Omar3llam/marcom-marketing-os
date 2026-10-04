// Evidence formatting for this feature only. No ranking or diagnostics.
export const ACTIONABLE_VERDICTS = Object.freeze(['KILL', 'REALLOCATE']);

const METRIC_LABELS = Object.freeze({ ctr: 'CTR', roas: 'ROAS', frequency: 'Frequency' });
export const evidenceMetricLabel = (metric) => Object.hasOwn(METRIC_LABELS, metric) ? METRIC_LABELS[metric] : null;

export function formatEvidenceValue(metric, value) {
  if (!evidenceMetricLabel(metric) || typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (metric === 'ctr') return (value * 100).toFixed(2) + '%';
  if (metric === 'roas') return value.toFixed(2) + 'x';
  return value.toFixed(2);
}

export function formatEvidenceGap(gap, parentLabel) {
  if (typeof gap !== 'number' || !Number.isFinite(gap)) return null;
  const percent = Math.round(gap * 100);
  return {
    signed: (percent > 0 ? '+' : '') + percent + '%',
    relation: gap === 0 ? 'matches ' + parentLabel
      : Math.abs(percent) + '% ' + (gap < 0 ? 'below ' : 'above ') + parentLabel,
  };
}

export function shouldRequestEvidence(campaign, verdict) {
  return Boolean(campaign) && ACTIONABLE_VERDICTS.includes(verdict);
}

/**
 * The refusals the evidence endpoint can return, as sentences. Keys are the
 * server's `reasonKey`s verbatim — the API deliberately carries no prose so the
 * wording (and its translation) lives here.
 *
 * Each names the missing INPUT, not a generic shortfall: an operator told their
 * ad sets are too thin will go split their audience, when the real gap may be a
 * campaign that has not synced a snapshot yet.
 *
 * ONE map, not one per level — the same discipline EVIDENCE_REASON keeps on the
 * server, which has exactly one enum for both dimensions. Two of these sentences
 * name the entities involved, and those NOUNS differ by level: the same
 * NO_MEANINGFUL_GAP under a list of ads means "no ad", and the baseline an ad is
 * compared against is its ad set, not the campaign. Rendering the ad-set wording
 * under an ad list would be a true refusal about the wrong entity, so the
 * level-dependent sentences are functions of the dimension while the key set
 * stays single.
 */
const AD_SET_NOUNS  = Object.freeze({ cohort: 'ad set', baseline: 'campaign' });
const AD_NOUNS      = Object.freeze({ cohort: 'ad',     baseline: 'ad set' });
const nounsFor = (dimension) => (dimension === 'ad' ? AD_NOUNS : AD_SET_NOUNS);

export const EVIDENCE_REFUSAL_LABELS = Object.freeze({
  INSUFFICIENT_REPORTING_ADSETS: () => 'Not enough reporting ad sets to compare',
  INSUFFICIENT_REPORTING_ADS:    () => 'Not enough reporting ads to compare',
  BASELINE_UNAVAILABLE:          (n) => `No ${n.baseline} performance data to compare against yet`,
  NO_MEANINGFUL_GAP:             (n) => `No ${n.cohort} is measurably behind the others`,
  INVALID_METRIC:                () => 'That ranking metric is not supported',
});

/**
 * PURE: a refusal sentence, with a general fallback for a key we do not know.
 * @param {string|null} reasonKey — the server's key, verbatim
 * @param {'adset'|'ad'} [dimension='adset'] — which level asked
 */
export const refusalLabel = (reasonKey, dimension = 'adset') => {
  const nouns = nounsFor(dimension);
  const build = EVIDENCE_REFUSAL_LABELS[reasonKey];
  return build ? build(nouns) : `Not enough data to compare ${nouns.cohort}s`;
};
