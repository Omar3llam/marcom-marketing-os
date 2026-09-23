// ============================================================
// GoalTrackerEngine — north-star landing ESTIMATE + leading risk
// ============================================================
// Public API: estimateLanding({ target, actuals, leadingSignals,
//   periodStart, periodEnd, now })
//
// DETERMINISM CONTRACT:
//   Pure. Same input → same output. No DB/LLM/randomness. `now` is the
//   only clock and it is injected. Reuses fatigueForecaster.linearFit —
//   the exact same trend primitive the forecaster uses.
//
// ISOLATION CONTRACT:
//   PlanService/ScenarioService load the actuals series + pre-computed
//   leading fatigue signals and feed this engine; nothing here reads DB.
//
// TWO HONESTY MOVES:
//   1. LANGUAGE: the output is a `trendBasedLandingEstimate`, NOT a
//      "projected landing". CAC/ROAS/MER are not linear; a standing
//      non-linearity assumption rides every result.
//   2. LEADING INDICATORS: a goal can read AT_RISK *before* the headline
//      metric breaks — if a fatigue signal breaches before period end, the
//      status is raised even when the lagging trend is on target. Final
//      status = the WORSE of lagging vs leading.
// ============================================================
import { logger } from '../../utils/logger.js';
import { linearFit } from '../fatigue-forecaster/fatigueForecaster.js';
import { GOAL_STATUS, NON_LINEARITY_ASSUMPTION } from './goalTrackerTypes.js';

const DAY_MS = 86_400_000;
const COMPARATORS = new Set(['GT', 'GTE', 'LT', 'LTE']);

function toTime(d) {
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  if (!Number.isFinite(t)) throw new Error(`estimateLanding: invalid date "${d}"`);
  return t;
}

function validate(target, actuals, periodStart, periodEnd) {
  if (!target || typeof target.targetValue !== 'number' || !Number.isFinite(target.targetValue)) {
    throw new Error('estimateLanding: target.targetValue must be a finite number');
  }
  if (!COMPARATORS.has(target.comparator)) {
    throw new Error(`estimateLanding: target.comparator must be one of ${[...COMPARATORS].join(', ')}`);
  }
  if (!Array.isArray(actuals) || actuals.length === 0) {
    throw new Error('estimateLanding: actuals must be a non-empty array');
  }
  if (toTime(periodEnd) <= toTime(periodStart)) {
    throw new Error('estimateLanding: periodEnd must be after periodStart');
  }
}

/** Does `value` satisfy `comparator targetValue`? (the GOOD direction) */
function meets(value, comparator, targetValue) {
  switch (comparator) {
    case 'GT':  return value >  targetValue;
    case 'GTE': return value >= targetValue;
    case 'LT':  return value <  targetValue;
    case 'LTE': return value <= targetValue;
    default:    return false;
  }
}

// Lower-is-better metrics (CAC, CPA) use LT/LTE; higher-is-better (ROAS,
// MER) use GT/GTE. For the worse-case end of the band we pick accordingly.
function lowerIsBetter(comparator) {
  return comparator === 'LT' || comparator === 'LTE';
}

const RANK = { [GOAL_STATUS.ON_TRACK]: 0, [GOAL_STATUS.AT_RISK]: 1, [GOAL_STATUS.OFF_TRACK]: 2 };
function worse(a, b) { return RANK[a] >= RANK[b] ? a : b; }

/**
 * Estimate where a north-star metric lands at period end — as a RANGE —
 * and fold in leading fatigue signals.
 *
 * @param {object} args
 * @param {{metric, comparator, targetValue, spendCeilingMinor?}} args.target
 * @param {Array<{date:(string|Date), value:number}>} args.actuals — metric over time
 * @param {Array<{signal, entityId?, projectedBreachDate, daysToBreach?, confidence?}>} [args.leadingSignals]
 * @param {(string|Date)} args.periodStart
 * @param {(string|Date)} args.periodEnd
 * @param {(string|Date)} args.now
 * @returns {{ metric, target, paceToDate, trendBasedLandingEstimate:{low,expected,high},
 *   laggingStatus, leadingRisk, leadingSignals, status, pctOfPeriodElapsed,
 *   assumptions, basis }}
 */
export function estimateLanding({ target, actuals, leadingSignals = [], periodStart, periodEnd, now, measurementEligibility } = {}) {
  if (measurementEligibility && (measurementEligibility.status !== 'VALID' || !measurementEligibility.currency)) {
    throw new Error('estimateLanding: authoritative measurement eligibility required');
  }
  validate(target, actuals, periodStart, periodEnd);

  const tStart = toTime(periodStart);
  const tEnd   = toTime(periodEnd);
  const tNow   = now != null ? toTime(now) : tEnd;
  const pctOfPeriodElapsed = Math.max(0, Math.min(1, (tNow - tStart) / (tEnd - tStart)));

  const sorted = [...actuals].sort((a, b) => toTime(a.date) - toTime(b.date));
  const t0 = toTime(sorted[0].date);
  const xs = sorted.map((p) => (toTime(p.date) - t0) / DAY_MS);
  const ys = sorted.map((p) => p.value);
  const paceToDate = ys[ys.length - 1];

  const { slope, intercept } = linearFit(xs, ys);
  const xEnd = (tEnd - t0) / DAY_MS;
  const expected = slope * xEnd + intercept;

  // Residual spread → band half-width. Widen when data is thin or the
  // period is young (less evidence ⇒ wider, honest band).
  const residuals = xs.map((x, i) => ys[i] - (slope * x + intercept));
  const variance = residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length);
  const resStd = Math.sqrt(variance);
  const thinFactor = 1 + (1 - pctOfPeriodElapsed) + (sorted.length < 4 ? 0.5 : 0);
  const halfWidth = Math.max(Math.abs(expected) * 0.02, resStd) * thinFactor;

  const round = (v) => Math.round(v * 100) / 100;
  const trendBasedLandingEstimate = {
    low:      round(expected - halfWidth),
    expected: round(expected),
    high:     round(expected + halfWidth),
  };

  // ── Lagging status: compare the band against the target. The WORST end
  //    of the band is the high side for lower-is-better, low side otherwise.
  const worst = lowerIsBetter(target.comparator)
    ? trendBasedLandingEstimate.high
    : trendBasedLandingEstimate.low;
  let laggingStatus;
  if (meets(worst, target.comparator, target.targetValue)) {
    laggingStatus = GOAL_STATUS.ON_TRACK;                       // even the worst end clears
  } else if (meets(trendBasedLandingEstimate.expected, target.comparator, target.targetValue)) {
    laggingStatus = GOAL_STATUS.AT_RISK;                        // expected clears, worst end misses
  } else {
    laggingStatus = GOAL_STATUS.OFF_TRACK;                      // expected misses
  }

  // ── Leading risk: any fatigue signal breaching BEFORE period end is an
  //    early warning, even when the lagging trend is on target.
  const activeSignals = (leadingSignals ?? []).filter(
    (s) => s?.projectedBreachDate && toTime(s.projectedBreachDate) <= tEnd,
  );
  const leadingRisk = activeSignals.length > 0;

  const status = worse(laggingStatus, leadingRisk ? GOAL_STATUS.AT_RISK : GOAL_STATUS.ON_TRACK);

  const assumptions = [NON_LINEARITY_ASSUMPTION];
  if (sorted.length < 4) assumptions.push(`thin history (${sorted.length} points) — band widened`);
  if (pctOfPeriodElapsed < 0.34) assumptions.push(`early in period (${Math.round(pctOfPeriodElapsed * 100)}% elapsed) — band widened`);

  let basis = `trend-based landing ~${trendBasedLandingEstimate.expected} vs target ${target.comparator} ${target.targetValue}`;
  if (leadingRisk && laggingStatus === GOAL_STATUS.ON_TRACK) {
    const s = activeSignals[0];
    basis += ` — on track on ${target.metric}, but ${s.signal} on ${s.entityId ?? 'an entity'} projects a breach before period end`;
  }

  logger.debug({ metric: target.metric, status, leadingRisk }, '[GoalTrackerEngine] estimated');
  return {
    metric: target.metric,
    target: { comparator: target.comparator, targetValue: target.targetValue, spendCeilingMinor: target.spendCeilingMinor ?? null },
    paceToDate: round(paceToDate),
    trendBasedLandingEstimate,
    laggingStatus,
    leadingRisk,
    leadingSignals: activeSignals,
    status,
    pctOfPeriodElapsed: round(pctOfPeriodElapsed),
    assumptions,
    basis,
  };
}
