// ============================================================
// TestReadoutEngine — honest winner readout for a concluded test
// ============================================================
// Public API:
//   readTest({ variants, metric })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no
//   timestamps.
//
// The moat's integrity lives here: a Testing OS that declares winners
// it can't justify is worse than useless. So the readout is HONEST —
// it labels confidence from a real significance test (two-proportion
// z-test for rate metrics) or a lift+sample floor for ratio metrics,
// and REFUSES to emit a verdict when the sample is too thin, no matter
// how big the raw lift looks.
// ============================================================
import { CONFIDENCE_LABEL, RATE_METRICS, METRIC } from './testReadoutTypes.js';
import { logger }                                 from '../../utils/logger.js';

// Sample floors below which we will not call a winner (frozen).
const FLOOR = Object.freeze({
  CTR:  1000, // impressions per variant
  CVR:  100,  // clicks per variant
  ROAS: 25,   // conversions per variant
  CPA:  25,   // conversions per variant
});

// |z| thresholds → confidence band, for rate metrics (frozen).
const Z = Object.freeze({ HIGH: 2.33, MODERATE: 1.64, LOW: 1.0 });

// A lift this large on a confident test scales the winner; smaller
// confident wins just refresh the creative to the winner.
const SCALE_LIFT_PCT = 30;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compute the observed metric value for a single variant.
 *
 * @param {Object} v - Variant measurement object (may contain impressions, clicks, conversions, spendMinor, revenueMinor).
 * @param {string} metric - Metric identifier (one of METRIC.CTR, METRIC.CVR, METRIC.ROAS, METRIC.CPA).
 * @returns {number} For `CTR`/`CVR`, the proportion (clicks/impressions or conversions/clicks). For `ROAS`, revenue divided by spend. For `CPA`, spend divided by conversions. Returns `0` when the relevant denominator is zero or negative (except `CPA` returns `Infinity` when conversions are zero or negative).
 * @throws {Error} If `metric` is not supported.
 */
function metricValue(v, metric) {
  switch (metric) {
    case METRIC.CTR:  return v.impressions > 0 ? v.clicks / v.impressions : 0;
    case METRIC.CVR:  return v.clicks      > 0 ? v.conversions / v.clicks  : 0;
    case METRIC.ROAS: return v.spendMinor  > 0 ? v.revenueMinor / v.spendMinor : 0;
    case METRIC.CPA:  return v.conversions > 0 ? v.spendMinor / v.conversions  : Infinity;
    default: throw new Error(`readTest: unsupported metric ${metric}`);
  }
}

/**
 * Return the success count (`x`) and trial count (`n`) used for a two-proportion z-test for a variant and metric.
 * @param {Object} v - Variant record containing numeric fields used by the metric (e.g., `clicks`, `impressions`, `conversions`).
 * @param {string} metric - Metric identifier (e.g., `METRIC.CTR`, `METRIC.CVR`).
 * @returns {{x: number, n: number}} `x` is the number of successes and `n` is the number of trials; for `CTR` this is `{ x: clicks, n: impressions }`, otherwise `{ x: conversions, n: clicks }`.
 */
function trials(v, metric) {
  return metric === METRIC.CTR
    ? { x: v.clicks,      n: v.impressions }
    : { x: v.conversions, n: v.clicks };
}

/**
 * Selects the per-variant sample count used for sample-floor checks.
 * @param {Object} v - Variant stats object.
 * @param {number} v.impressions - Total impressions for the variant.
 * @param {number} v.clicks - Total clicks for the variant.
 * @param {number} v.conversions - Total conversions for the variant.
 * @param {string} metric - Metric identifier (e.g., METRIC.CTR, METRIC.CVR, METRIC.ROAS, METRIC.CPA).
 * @returns {number} The sample count: impressions for CTR, clicks for CVR, conversions for other metrics.
 */
function sampleSize(v, metric) {
  switch (metric) {
    case METRIC.CTR:  return v.impressions;
    case METRIC.CVR:  return v.clicks;
    default:          return v.conversions; // ROAS / CPA
  }
}

/**
 * Compute the absolute z-score for a two-proportion z-test comparing two variants.
 *
 * @param {Object} winner - Variant record treated as the first sample in the test.
 * @param {Object} control - Variant record treated as the second sample (control).
 * @param {string} metric - Metric key used to extract trials (e.g., "CTR" or "CVR").
 * @returns {number} The absolute z-score magnitude; returns `0` when the z-score is undefined
 * (for example, when either sample size is nonpositive or the standard error is zero/non-finite).
 */
function twoProportionZ(winner, control, metric) {
  const a = trials(winner, metric);
  const b = trials(control, metric);
  if (a.n <= 0 || b.n <= 0) return 0;
  const p1 = a.x / a.n;
  const p2 = b.x / b.n;
  const pool = (a.x + b.x) / (a.n + b.n);
  const se = Math.sqrt(pool * (1 - pool) * (1 / a.n + 1 / b.n));
  if (!Number.isFinite(se) || se === 0) return 0;
  return Math.abs((p1 - p2) / se);
}

/**
 * Read a concluded test and declare a winner — honestly.
 *
 * @param {object} args
 * @param {Array}  args.variants — [{ variantId?, label, isControl, impressions, clicks, conversions, spendMinor, revenueMinor }]
 * @param {string} args.metric   — 'CTR' | 'CVR' | 'ROAS' | 'CPA'
 * @returns {{ winnerLabel, winnerVariantId, lift, confidence, confidenceLabel, sampleNote, verdict, rationale, metric }}
 */
export function readTest({ variants, metric } = {}) {
  if (!Array.isArray(variants) || variants.length < 2) {
    throw new Error('readTest: at least two variants are required');
  }
  if (!metric) throw new Error('readTest: metric is required');

  const higherIsBetter = !RATE_METRICS.isLowerBetter(metric);

  // Normalize and score every variant.
  const scored = variants.map((v) => ({
    variantId:   v.variantId ?? null,
    label:       v.label,
    isControl:   !!v.isControl,
    impressions: v.impressions ?? 0,
    clicks:      v.clicks ?? 0,
    conversions: v.conversions ?? 0,
    spendMinor:  v.spendMinor ?? 0,
    revenueMinor: v.revenueMinor ?? 0,
    value:       metricValue(v, metric),
  }));

  const control = scored.find((v) => v.isControl) ?? scored[0];

  // Best challenger by the watched metric (excluding the control).
  const challengers = scored.filter((v) => v !== control);
  const best = challengers.reduce((acc, v) => {
    if (!acc) return v;
    const better = higherIsBetter ? v.value > acc.value : v.value < acc.value;
    return better ? v : acc;
  }, null);

  const inconclusive = (sampleNote, extra = {}) => ({
    winnerLabel: null, winnerVariantId: null, lift: 0,
    confidence: 0, confidenceLabel: CONFIDENCE_LABEL.INCONCLUSIVE,
    sampleNote, verdict: null, metric,
    rationale: sampleNote,
    ...extra,
  });

  // No challenger beat the control → nothing to adopt.
  const beatsControl = best && (higherIsBetter ? best.value > control.value : best.value < control.value);
  if (!best || !beatsControl || best.value === control.value) {
    return inconclusive(`No variant beat the control on ${metric} — no winner to call.`);
  }

  // Relative lift vs control (always expressed as an improvement %).
  const lift = higherIsBetter
    ? ((best.value - control.value) / control.value) * 100
    : ((control.value - best.value) / control.value) * 100;

  // Sample floor — below this we refuse to call it, regardless of lift.
  const floor = FLOOR[metric];
  const minSample = Math.min(sampleSize(best, metric), sampleSize(control, metric));
  if (minSample < floor) {
    return inconclusive(
      `Only ${minSample} ${metric === METRIC.CTR ? 'impressions' : metric === METRIC.CVR ? 'clicks' : 'conversions'} ` +
      `on the smaller arm — too thin to call (need ${floor}).`,
      { winnerLabel: best.label, winnerVariantId: best.variantId, lift: round2(lift) },
    );
  }

  // Confidence: real z-test for rate metrics; lift+floor for ratio metrics.
  let confidence;
  let confidenceLabel;
  if (RATE_METRICS.has(metric)) {
    const z = twoProportionZ(best, control, metric);
    if      (z >= Z.HIGH)     { confidence = 0.98; confidenceLabel = CONFIDENCE_LABEL.HIGH; }
    else if (z >= Z.MODERATE) { confidence = 0.90; confidenceLabel = CONFIDENCE_LABEL.MODERATE; }
    else if (z >= Z.LOW)      { confidence = 0.70; confidenceLabel = CONFIDENCE_LABEL.LOW; }
    else                      { confidence = 0.50; confidenceLabel = CONFIDENCE_LABEL.INCONCLUSIVE; }
  } else {
    // Ratio metrics: no clean variance, so we cap at MODERATE — honesty.
    if      (lift >= 50) { confidence = 0.80; confidenceLabel = CONFIDENCE_LABEL.MODERATE; }
    else if (lift >= 20) { confidence = 0.65; confidenceLabel = CONFIDENCE_LABEL.LOW; }
    else                 { confidence = 0.50; confidenceLabel = CONFIDENCE_LABEL.INCONCLUSIVE; }
  }

  // A formatted view of each side's value for the human-readable trail.
  const fmt = (val) => RATE_METRICS.has(metric) ? `${round2(val * 100)}%` : `${round2(val)}${metric === METRIC.ROAS ? 'x' : ''}`;
  const rationale =
    `${best.label} beat ${control.label} by ${round2(lift)}% ${metric} ` +
    `(${fmt(best.value)} vs ${fmt(control.value)}), ${confidenceLabel.toLowerCase()} confidence.`;
  const sampleNote =
    `${minSample.toLocaleString('en-US')} ${metric === METRIC.CTR ? 'impressions' : metric === METRIC.CVR ? 'clicks' : 'conversions'} on the smaller arm.`;

  // Verdict gating — INCONCLUSIVE / LOW never auto-acts.
  let verdict = null;
  if (confidenceLabel === CONFIDENCE_LABEL.HIGH || confidenceLabel === CONFIDENCE_LABEL.MODERATE) {
    verdict = lift >= SCALE_LIFT_PCT ? 'SCALE' : 'REFRESH';
  }

  logger.debug({ winner: best.label, metric, lift: round2(lift), confidenceLabel, verdict }, '[TestReadoutEngine] read');

  return {
    winnerLabel:     best.label,
    winnerVariantId: best.variantId,
    lift:            round2(lift),
    confidence,
    confidenceLabel,
    sampleNote,
    verdict,
    rationale,
    metric,
  };
}
