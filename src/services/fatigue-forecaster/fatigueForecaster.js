// ============================================================
// FatigueForecaster — forward-looking creative-fatigue prediction
// ============================================================
// Public API: forecastFatigue({ series, ceiling, memory })
//
// DETERMINISM CONTRACT:
//   Same input → same output. Pure math: a least-squares fit of the
//   frequency trend projected to the fatigue ceiling. No randomness,
//   no LLM, no DB. (Mirrors DiagnosisEngine / VerdictEngine.)
//
// ISOLATION CONTRACT:
//   Never writes to DB. Persistence + memory-on-resolution live in
//   FatiguePredictionService.
//
// The point: predict the day an ad set breaches its fatigue ceiling
// BEFORE it bleeds — e.g. "Carousel #4 projected to breach
// frequency 3.5 in ~3 days."
// ============================================================
import { logger } from '../../utils/logger.js';

const DAY_MS = 86_400_000;
const DEFAULT_CEILING = 3.5;
const MIN_POINTS = 2;

function toTime(d) {
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  if (!Number.isFinite(t)) throw new Error(`forecastFatigue: invalid date "${d}"`);
  return t;
}

function validate(series) {
  if (!Array.isArray(series) || series.length < MIN_POINTS) {
    throw new Error(`forecastFatigue: series must have at least ${MIN_POINTS} points`);
  }
  for (const p of series) {
    if (!p || typeof p !== 'object') throw new Error('forecastFatigue: each series point must be an object');
    if (typeof p.frequency !== 'number' || !Number.isFinite(p.frequency) || p.frequency < 0) {
      throw new Error('forecastFatigue: frequency must be a non-negative finite number');
    }
  }
}

/** Least-squares slope/intercept/R² of y over x. */
function linearFit(xs, ys) {
  const n = xs.length;
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xBar, dy = ys[i] - yBar;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yBar - slope * xBar;
  const ssRes = xs.reduce((acc, x, i) => acc + (ys[i] - (slope * x + intercept)) ** 2, 0);
  const r2 = syy === 0 ? 0 : 1 - ssRes / syy;
  return { slope, intercept, r2 };
}

/**
 * Project when an entity's fatigue metric will breach its ceiling.
 *
 * @param {object} args
 * @param {Array<{date:(string|Date), frequency:number, ctr?:number}>} args.series — time-ordered snapshots
 * @param {number} [args.ceiling=3.5] — breach threshold
 * @param {Array} [args.memory] — prior resolved fatigue events (confidence nudge)
 * @returns {{
 *   willBreach:boolean, metric:string, ceiling:number, currentValue:number,
 *   slopePerDay:number, daysToBreach:(number|null), projectedBreachDate:(string|null),
 *   confidence:number, basis:string
 * }}
 */
export function forecastFatigue({ series, ceiling = DEFAULT_CEILING, memory = [] } = {}) {
  validate(series);

  const sorted = [...series].sort((a, b) => toTime(a.date) - toTime(b.date));
  const t0 = toTime(sorted[0].date);
  const xs = sorted.map((p) => (toTime(p.date) - t0) / DAY_MS); // day index
  const freqs = sorted.map((p) => p.frequency);

  const { slope, intercept, r2 } = linearFit(xs, freqs);
  const lastX = xs[xs.length - 1];
  const lastDate = toTime(sorted[sorted.length - 1].date);
  const currentValue = freqs[freqs.length - 1];

  // Secondary signal: is CTR also decaying? (raises confidence)
  const ctrs = sorted.map((p) => p.ctr).filter((v) => typeof v === 'number' && Number.isFinite(v));
  let ctrDecaying = false;
  if (ctrs.length >= MIN_POINTS) {
    const ctrFit = linearFit(xs.slice(xs.length - ctrs.length), ctrs);
    ctrDecaying = ctrFit.slope < 0;
  }

  // Already breached.
  if (currentValue >= ceiling) {
    return {
      willBreach: true, metric: 'frequency', ceiling, currentValue,
      slopePerDay: round(slope), daysToBreach: 0,
      projectedBreachDate: new Date(lastDate).toISOString(),
      confidence: clamp(0.95), basis: `frequency ${currentValue.toFixed(1)} already at/above ceiling ${ceiling}`,
    };
  }

  // Flat or falling frequency → no breach projected.
  if (slope <= 0) {
    return {
      willBreach: false, metric: 'frequency', ceiling, currentValue,
      slopePerDay: round(slope), daysToBreach: null, projectedBreachDate: null,
      confidence: clamp(0.6 * Math.max(0, r2)),
      basis: `frequency trend flat/declining (${round(slope)}/day) — no breach projected`,
    };
  }

  const xBreach = (ceiling - intercept) / slope;
  const daysFromLast = xBreach - lastX;
  const projectedBreachDate = new Date(lastDate + daysFromLast * DAY_MS).toISOString();

  // Confidence: fit quality, plus boosts for corroborating CTR decay and
  // prior resolved fatigue memory. Deterministic.
  let confidence = 0.5 + 0.4 * Math.max(0, Math.min(1, r2));
  if (ctrDecaying) confidence += 0.05;
  if (Array.isArray(memory) && memory.length > 0) confidence += 0.05;

  const result = {
    willBreach: true, metric: 'frequency', ceiling, currentValue,
    slopePerDay: round(slope),
    daysToBreach: round(daysFromLast),
    projectedBreachDate,
    confidence: clamp(confidence),
    basis: `frequency rising +${round(slope)}/day over ${sorted.length}-day trend${ctrDecaying ? ', CTR decaying' : ''}`,
  };

  logger.debug({ daysToBreach: result.daysToBreach, confidence: result.confidence }, '[FatigueForecaster] projection');
  return result;
}

function round(n) { return Math.round(n * 100) / 100; }
function clamp(n) { return Math.max(0, Math.min(1, Math.round(n * 100) / 100)); }
