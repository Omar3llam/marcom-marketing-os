// ============================================================
// PacingEngine — budget burn-rate projection
// ============================================================
// Public API: projectPacing({ monthlyBudgetMinor, spentMinor,
//                             daysElapsed, daysInPeriod })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no
//   timestamps (the caller passes daysElapsed/daysInPeriod).
//
// ISOLATION CONTRACT:
//   Never reads/writes DB. PortfolioService composes this per channel
//   and for the portfolio, and surfaces alerts in the radar.
//
// Answers the landing-page promise: "Meta exhausts budget 6 days
// early at this pace." Money stays in integer minor units.
// ============================================================
import { logger } from '../../utils/logger.js';

export const PACE_STATUS = Object.freeze({ ON_TRACK: 'ON_TRACK', OVER: 'OVER', UNDER: 'UNDER' });

// How far off the linear pace counts as a real OVER/UNDER alert.
const PACE_TOLERANCE = 0.05; // ±5%

function validate({ monthlyBudgetMinor, spentMinor, daysElapsed, daysInPeriod }) {
  for (const [k, v] of Object.entries({ monthlyBudgetMinor, spentMinor, daysElapsed, daysInPeriod })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`projectPacing: ${k} must be a finite number`);
  }
  if (monthlyBudgetMinor <= 0) throw new Error('projectPacing: monthlyBudgetMinor must be positive');
  if (daysInPeriod <= 0) throw new Error('projectPacing: daysInPeriod must be positive');
  if (daysElapsed < 0 || daysElapsed > daysInPeriod) throw new Error('projectPacing: daysElapsed must be within [0, daysInPeriod]');
}

/**
 * Project end-of-period spend from the current burn rate.
 *
 * @param {object} args
 * @param {number} args.monthlyBudgetMinor — the period budget (minor units)
 * @param {number} args.spentMinor — spend so far this period (minor units)
 * @param {number} args.daysElapsed — days elapsed (≥0)
 * @param {number} args.daysInPeriod — total days in the period (>0)
 * @returns {{
 *   runRateMinor, projectedSpendMinor, paceRatio, daysRemaining,
 *   exhaustsOnDay: number|null, daysEarly: number|null, status
 * }}
 */
export function projectPacing({ monthlyBudgetMinor, spentMinor, daysElapsed, daysInPeriod } = {}) {
  validate({ monthlyBudgetMinor, spentMinor, daysElapsed, daysInPeriod });

  const runRateMinor = daysElapsed > 0 ? spentMinor / daysElapsed : 0;
  const projectedSpendMinor = Math.round(runRateMinor * daysInPeriod);

  // paceRatio: projected vs budget. >1 over-pacing, <1 under-pacing.
  const paceRatio = projectedSpendMinor / monthlyBudgetMinor;
  const daysRemaining = daysInPeriod - daysElapsed;

  // The day the budget is fully consumed at the current run rate.
  let exhaustsOnDay = null;
  let daysEarly = null;
  if (runRateMinor > 0) {
    exhaustsOnDay = monthlyBudgetMinor / runRateMinor;
    // Positive ⇒ exhausts before the period ends (early); negative ⇒ leftover.
    daysEarly = Math.round((daysInPeriod - exhaustsOnDay) * 10) / 10;
  }

  let status = PACE_STATUS.ON_TRACK;
  if (paceRatio > 1 + PACE_TOLERANCE) status = PACE_STATUS.OVER;
  else if (paceRatio < 1 - PACE_TOLERANCE) status = PACE_STATUS.UNDER;

  logger.debug({ paceRatio, status, daysEarly }, '[PacingEngine] projected');

  return {
    runRateMinor: Math.round(runRateMinor),
    projectedSpendMinor,
    paceRatio,
    daysRemaining,
    exhaustsOnDay: exhaustsOnDay == null ? null : Math.round(exhaustsOnDay * 10) / 10,
    daysEarly,
    status,
  };
}
