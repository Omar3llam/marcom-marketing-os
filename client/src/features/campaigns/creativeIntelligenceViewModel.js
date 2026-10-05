// ============================================================
// creativeIntelligenceViewModel — the server's ad ranking, ready to render
// ============================================================
// PRESENTATION MAPPING ONLY. No ranking, no sorting, no thresholds, no
// benchmark comparison, no inference of any kind. Every judgement in here was
// made by analyzeEvidence() on the server; this file reads its answer.
//
// ── WHY THERE IS NO ORDINAL RANK ─────────────────────────────────────────────
// The obvious shape is `rank: 3, of: 7`, and it is not available. The server
// publishes a SORTED list (`ranked`) plus the two ends it is willing to name
// (`summary.bottom`, `summary.top`) — it does not publish an ordinal, and it
// does not claim the middle of the list is meaningfully ordered: the sort key
// is a raw gap, so two ads a rounding error apart get adjacent positions that
// read as a standing. Counting a row's index and calling it "3rd of 7" would
// turn the server's "this one is the worst" into a leaderboard the engine never
// scored. So `rank` carries the server's own word — BOTTOM — and comparedCount
// carries the size of the set it beat, which is what makes BOTTOM mean anything.
//
// ── EVIDENCE, NOT VERDICT ────────────────────────────────────────────────────
// The worst-ranked creative in an ad set is not a creative to kill. The engine
// emits no ad-level verdict, so this model emits no action, no recommendation,
// and no severity word. It states which ad is furthest behind and by how much.
// What to do about that is a decision, and decisions come from the verdict
// engine or from the operator.
// ============================================================

import { evidenceMetricLabel, formatEvidenceValue, formatEvidenceGap, evidenceBasisLabel, evidencePopulationLabel } from './executionContext.js';

/** The video signals the ad-level ingestion lands, in funnel order. */
const VIDEO_KEYS = Object.freeze(['videoView', 'video25', 'video50', 'video95']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * PURE: a platform timestamp → "14 Jun 2026".
 *
 * The YEAR is not decoration here: a creative's age is the whole point of the
 * field, and "14 Jun" beside an ad running since last year reads as two weeks
 * old. Hand-rolled in UTC rather than toLocaleDateString for the same reason
 * memoryTimelineViewModel is — a date that reads one way in CI and another on
 * screen is a test that lies.
 *
 * NO "3 days old". There is no canonical date-age formatter in this client, and
 * a days-since computed here would be arithmetic against the reader's clock
 * dressed as a stored fact. The date is what we know; the reader can subtract.
 *
 * null for anything unparseable — creative age must read as UNKNOWN, never as
 * "brand new", which is the one wrong answer a fatigue reader would act on.
 */
function creativeDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * PURE: the stored actionMetrics bag → the video signals that are actually in it.
 *
 * A key that is absent stays absent. Defaulting a missing quartile to 0 would
 * say "nobody watched 50% of this video" about an image ad that has no video at
 * all, and about a video ad whose quartiles Meta simply did not report.
 * @returns {object|null} null when the bag carries no video signal at all.
 */
function videoSignalsOf(actionMetrics) {
  if (!actionMetrics || typeof actionMetrics !== 'object') return null;
  const out = {};
  for (const k of VIDEO_KEYS) {
    const v = num(actionMetrics[k]);
    if (v != null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * PURE: analyzeEvidence's payload → the Creative Intelligence view model.
 *
 * @param {object} args
 * @param {object|null} args.evidence — the `evidence` object from
 *   GET /api/lumi/entities/:adSetId/evidence. Its `summary.bottom` is the ad
 *   the SERVER ranked lowest; this model never picks its own.
 * @returns {object|null} null whenever the payload cannot support the surface —
 *   which the renderer turns into nothing at all, never into an empty card.
 */
export function buildCreativeIntelligenceViewModel({ evidence, parent, comparisonEnvelope } = {}) {
  const worst = evidence?.summary?.bottom ?? null;
  if (!worst || !comparisonEnvelope) return null;

  const metric = typeof evidence.metric === 'string' ? evidence.metric : null;
  const metricLabel = evidenceMetricLabel(metric);
  if (!metricLabel) return null;
  const gap = formatEvidenceGap(worst._gap, 'ad set');
  // The set the server actually ranked, after its own rankability filter. Not
  // the number of ads in the ad set: rows too thin to compare were excluded, and
  // counting them would overstate how many this one came last out of.
  const comparedCount = comparisonEnvelope.comparableCount;

  // The server's own gap, as a percentage of the ad-set baseline. Rounding a
  // stored ratio is formatting; the comparison itself was made on the server.
  const gapPercent = num(worst._gap) == null ? null : Math.round(worst._gap * 100);

  return {
    comparisonEnvelope,
    ad: {
      id:                  worst.entityId ?? null,
      name:                worst.name ?? null,
      channel:             worst.channel ?? null,
      status:              worst.status ?? null,
      // Raw, for anything that needs the instant; `creativeAge` is the string.
      platformCreatedTime: worst.platformCreatedTime ?? null,
      creativeAge:         creativeDate(worst.platformCreatedTime),
    },
    // Null stays null throughout — an unreported CTR is not a zero one, and a
    // renderer handed 0 has no way left to tell the two apart.
    metrics: {
      ctr:         num(worst.ctr),
      roas:        num(worst.roas),
      frequency:   num(worst.frequency),
      spendMinor:  num(worst.spendMinor),
      currency:    worst.currency ?? null,
      impressions: num(worst.impressions),
      clicks:      num(worst.clicks),
      conversions: num(worst.conversions),
    },
    videoSignals: videoSignalsOf(worst.actionMetrics),
    comparison: {
      basisLabel: evidenceBasisLabel(comparisonEnvelope),
      populationLabel: evidencePopulationLabel(comparisonEnvelope, 'ads'),
      metricLabel,
      childValue: formatEvidenceValue(metric, worst[metric]),
      parentValue: formatEvidenceValue(metric, parent?.[metric]),
      gap: gap?.signed ?? null,
      relation: gap?.relation ?? null,
    },
    ranking: {
      // The server's word for the end of its own sorted list, not an index.
      rank: 'BOTTOM',
      comparedCount,
      metric,
      metricLabel,
      gapPercent,
      // The finding as a sentence, so the renderer holds no vocabulary. Says what
      // the number DID — "below"/"above" is the sign, not a judgement — and stops
      // there. A frequency 42% over its ad set reads "above", because that is
      // what happened; whether that is bad is the verdict engine's call.
      label: rankingLabel({ metricLabel, gapPercent, comparedCount, gap: worst._gap }),
    },
  };
}

/**
 * PURE: the finding, in words. Degrades a clause at a time rather than all at
 * once — a payload with a gap but no cohort size still has something true to say.
 */
function rankingLabel({ metricLabel, gapPercent, comparedCount, gap }) {
  if (!metricLabel) return null;
  const cohort = comparedCount >= 2 ? ` within ${comparedCount} reporting ads with comparable evidence` : '';
  // Direction-neutral, because the ranking is not: `summary.bottom` is the WORST
  // row, and for a ceiling metric like frequency the worst row is the HIGHEST
  // one. "Lowest frequency" would name the healthiest ad in the set.
  if (gapPercent == null) return `Furthest behind on ${metricLabel}${cohort}`;
  if (gap === 0) return `${metricLabel} matches the ad set${cohort}`;
  const direction = gap < 0 ? 'below' : 'above';
  return `${metricLabel} ${Math.abs(gapPercent)}% ${direction} the ad set${cohort}`;
}
