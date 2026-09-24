// AllocationPlan's physical merBefore/merAfter columns predate the current
// metric contract. New writes carry a marker in the existing reasoning field;
// unmarked historical rows remain legacy and cannot be promoted by a read.
const MARKER = '[BLENDED_REVENUE_EFFICIENCY_V1]\n';

export function tagAllocationReasoning(lines) {
  return `${MARKER}${lines.join('\n')}`;
}

export function readAllocationEfficiency(row) {
  if (!row?.reasoning?.startsWith(MARKER)
    || !Number.isFinite(row.merBefore) || !Number.isFinite(row.merAfter)) {
    return { efficiencyStatus: 'LEGACY_PROJECTED_EFFICIENCY',
      blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null };
  }
  return { efficiencyStatus: 'VALID',
    blendedRevenueEfficiencyBefore: row.merBefore,
    blendedRevenueEfficiencyAfter: row.merAfter };
}
