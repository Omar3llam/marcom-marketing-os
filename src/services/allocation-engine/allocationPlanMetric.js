// AllocationPlan's physical merBefore/merAfter columns are legacy-only.
// New writes use dedicated semantic columns. The reasoning marker remains for
// audit of #497-era rows, but it grants no metric authority to legacy columns.
const MARKER = '[BLENDED_REVENUE_EFFICIENCY_V1]\n';

export function tagAllocationReasoning(lines) {
  return `${MARKER}${lines.join('\n')}`;
}

export function readAllocationEfficiency(row) {
  if (Number.isFinite(row?.blendedRevenueEfficiencyBefore)
    && Number.isFinite(row?.blendedRevenueEfficiencyAfter)) {
    return { efficiencyStatus: 'BLENDED_REVENUE_EFFICIENCY',
      blendedRevenueEfficiencyBefore: row.blendedRevenueEfficiencyBefore,
      blendedRevenueEfficiencyAfter: row.blendedRevenueEfficiencyAfter };
  }
  return { efficiencyStatus: Number.isFinite(row?.merBefore) || Number.isFinite(row?.merAfter)
    ? 'LEGACY_PROJECTED_EFFICIENCY' : 'UNAVAILABLE',
  blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null };
}
