import { describe, expect, it } from 'vitest';
import { readAllocationEfficiency, tagAllocationReasoning } from './allocationPlanMetric.js';

describe('AllocationPlan legacy physical columns', () => {
  it('reads only explicitly tagged new rows as blended revenue efficiency', () => {
    const reasoning = tagAllocationReasoning(['a measured allocation']);
    expect(readAllocationEfficiency({ reasoning, merBefore: 2, merAfter: 2.5 })).toEqual({
      efficiencyStatus: 'VALID', blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.5,
    });
    expect(reasoning).toContain('a measured allocation');
  });
  it('keeps untagged historical values legacy, not MER or current efficiency', () => {
    expect(readAllocationEfficiency({ reasoning: 'old projected MER', merBefore: 2, merAfter: 2.5 })).toEqual({
      efficiencyStatus: 'LEGACY_PROJECTED_EFFICIENCY',
      blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null,
    });
  });
  it('does not publish partial or fabricated values from a tagged row', () => {
    expect(readAllocationEfficiency({ reasoning: tagAllocationReasoning([]), merBefore: null, merAfter: 0 })).toMatchObject({
      efficiencyStatus: 'LEGACY_PROJECTED_EFFICIENCY', blendedRevenueEfficiencyAfter: null,
    });
  });
});
