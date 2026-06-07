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

  // Pacing (best-effort): treat the lookback spend as month-to-date.
  const daysInPeriod = daysInMonth(now);
  const daysElapsed  = Math.min(now.getUTCDate(), daysInPeriod);
  let pacing = null;
  if (budgetMinor && budgetMinor > 0) {
    pacing = projectPacing({
      monthlyBudgetMinor: budgetMinor,
      spentMinor:         portfolio.spendMinor,
      daysElapsed,
      daysInPeriod,
    });
  }

  // Per-channel pacing share (budget split by current spend share).
  const channelPacing = channels.map((c) => {
    if (!budgetMinor || portfolio.spendMinor <= 0) return { channelId: c.channelId, pacing: null };
    const share = c.spendMinor / portfolio.spendMinor;
    const chBudget = Math.round(budgetMinor * share);
    return {
      channelId: c.channelId,
      pacing: chBudget > 0
        ? projectPacing({ monthlyBudgetMinor: chBudget, spentMinor: c.spendMinor, daysElapsed, daysInPeriod })
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
    channels:       channels.map((c) => ({ ...c, pacing: channelPacing.find((p) => p.channelId === c.channelId)?.pacing ?? null })),
  };
}
