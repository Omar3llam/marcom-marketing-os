// ============================================================
// PortfolioService — cross-channel portfolio view
// ============================================================
// Owns DB I/O. Composes the deterministic engines:
//   blended-truth (honest revenue) + pacing (burn projection).
//
// Surfaces: total spend, blended CPA, blended ROAS / MER across
// connected channels, paced against a monthly budget. The totals
// reconcile to the Phase-1 entity rollup (every channel figure is a
// sum of MetricSnapshot rows — see the reconciliation test).
//
// Monthly budget comes from the latest AllocationPlan (its budget IS
// the spend ceiling) unless one is passed explicitly — no new schema.
// ============================================================
import { prisma }        from '../../lib/prisma.js';
import { logger }        from '../../utils/logger.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { projectPacing }   from '../pacing-engine/pacingEngine.js';
import {
  readPeriodSpend, calendarMonthOf, PERIOD_COVERAGE, SPEND_PERIOD_STATUS,
} from '../budget-period/spendPeriod.js';

/** Days in the calendar month of `date` (UTC). */
function daysInMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Build the portfolio view for a workspace.
 *
 * @param {string} workspaceId
 * @param {object} [opts]
 * @param {number} [opts.monthlyBudgetMinor] — overrides the latest plan budget
 * @param {Date}   [opts.now] — injectable clock (defaults to new Date())
 * @returns {Promise<object>} portfolio view
 */
export async function getPortfolio(workspaceId, { monthlyBudgetMinor, now = new Date() } = {}) {
  if (!workspaceId) throw new Error('getPortfolio: workspaceId required');

  const { channels, portfolio } = await getBlendedTruth(workspaceId);

  // Monthly budget: explicit override, else the most recent allocation plan's
  // ceiling (its budget IS the monthly spend cap).
  let budgetMinor = monthlyBudgetMinor ?? null;
  if (budgetMinor == null) {
    const latestPlan = await prisma.allocationPlan.findFirst({
      where:   { workspaceId },
      orderBy: { createdAt: 'desc' },
      select:  { totalBudgetMinor: true },
    }).catch(() => null);
    budgetMinor = latestPlan?.totalBudgetMinor ?? null;
  }

  // ── Pacing: this month's budget against THIS MONTH'S spend, or nothing ──
  //
  // This block used to open with "Pacing (best-effort): treat the lookback spend
  // as month-to-date." — and divide the blended total by the day of the month.
  // That total covers whatever the last sync fetched: 90 days from the cron, the
  // account's whole life from the Sync button. Dogfood readiness measured an
  // account spending EXACTLY its budget published on Attention as "over-pacing,
  // exhausts ~25.7 days early".
  //
  // The spend now comes from spendPeriod, which accepts a row only when the
  // window META DECLARED for it runs from the first of this month to a day
  // inside it. `daysElapsed` is that window's length — the days the spend
  // actually covers — never `now.getUTCDate()`. Anything else is NOT_MEASURABLE
  // and pacing is null, with the refusal published beside it as `spendPeriod`.
  const daysInPeriod = daysInMonth(now);
  const spend = await readPeriodSpend(workspaceId, {
    period: calendarMonthOf(now), coverage: PERIOD_COVERAGE.TO_DATE, now,
  });
  const measured = spend.portfolio.status === SPEND_PERIOD_STATUS.MEASURABLE;

  let pacing = null;
  if (budgetMinor && budgetMinor > 0 && measured) {
    pacing = projectPacing({
      monthlyBudgetMinor: budgetMinor,
      spentMinor:         spend.portfolio.spendMinor,
      daysElapsed:        spend.portfolio.daysCovered,
      daysInPeriod,
    });
  }

  // Per-channel pacing: the budget split by each channel's share of the SAME
  // measured spend. A share of a window that is not this month is not a share of
  // this month, so an unmeasured period leaves every channel unpaced too.
  const channelPacing = channels.map((c) => {
    const chSpend = spend.byEntity.get(c.channelId);
    if (!budgetMinor || !measured || chSpend == null || spend.portfolio.spendMinor <= 0) {
      return { channelId: c.channelId, pacing: null };
    }
    const chBudget = Math.round(budgetMinor * (chSpend / spend.portfolio.spendMinor));
    return {
      channelId: c.channelId,
      pacing: chBudget > 0
        ? projectPacing({ monthlyBudgetMinor: chBudget, spentMinor: chSpend, daysElapsed: spend.portfolio.daysCovered, daysInPeriod })
        : null,
    };
  });

  logger.info({ workspaceId, channels: channels.length, blendedRoas: portfolio.blendedRoas }, '[PortfolioService] built');

  return {
    monthlyBudgetMinor: budgetMinor,
    totals: {
      spendMinor:           portfolio.spendMinor,
      platformRevenueMinor: portfolio.platformRevenueMinor,
      blendedRevenueMinor:  portfolio.blendedRevenueMinor,
      blendedRoas:          portfolio.blendedRoas,  // MER (blended)
      platformRoas:         portfolio.platformRoas,
      gapMinor:             portfolio.gapMinor,
      gapPct:               portfolio.gapPct,
      reconciledCount:      portfolio.reconciledCount,
      unverifiedCount:      portfolio.unverifiedCount,
    },
    pacing,
    // What the pacing comparison was allowed to use — or why it was refused.
    spendPeriod: spend.portfolio,
    channels:       channels.map((c) => ({ ...c, pacing: channelPacing.find((p) => p.channelId === c.channelId)?.pacing ?? null })),
  };
}
