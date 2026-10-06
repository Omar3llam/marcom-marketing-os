import { formatCurrency } from '@/lib/money';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';
const BASIS_LABELS = { blended: 'Blended revenue efficiency', incremental: 'Measured incremental efficiency' };
const ratio = value => Number.isFinite(value) ? `${value.toFixed(1)}×` : '—';

// Format admitted server facts once for desktop and mobile. The denomination
// comes from the panel's existing money gate; no fallback, move math or model.
export function allocationPresentation(plan, currency) {
  const money = value => isKnownCurrency(currency) && Number.isFinite(value) ? formatCurrency(value, currency) : '—';
  const period = plan.spendPeriod?.period;
  return {
    basis: BASIS_LABELS[plan.basis] ?? 'Unavailable',
    period: period ? `${period.start} → ${period.end}` : 'Unavailable',
    totalBudget: money(plan.totalBudgetMinor),
    projection: { before: ratio(plan.projected?.blendedRevenueEfficiencyBefore),
      after: ratio(plan.projected?.blendedRevenueEfficiencyAfter), cpa: money(plan.projected?.projectedCpaMinor) },
    rows: plan.allocations.map(move => {
      const change = money(move.deltaMinor);
      return { id: move.channelId, channel: move.channel ?? move.channelId,
        measuredSpend: money(move.currentSpendMinor), recommendedBudget: money(move.recommendedSpendMinor),
        budgetChange: change === '—' ? '—' : move.deltaMinor > 0 ? `+${change}` : move.deltaMinor === 0 ? `No change · ${change}` : change,
        efficiency: ratio(move.blendedRoas), rationale: move.rationale };
    }),
  };
}
