import { describe, expect, it } from 'vitest';
import { readAllocationEfficiency, tagAllocationReasoning } from './allocationPlanMetric.js';

describe('AllocationPlan semantic storage reader', () => {
  it('reads dedicated columns without depending on legacy columns or a marker', () => {
    expect(readAllocationEfficiency({ blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.5,
      merBefore: null, merAfter: null, reasoning: 'ordinary allocation' })).toEqual({
      efficiencyStatus: 'BLENDED_REVENUE_EFFICIENCY',
      blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.5,
    });
  });
  it('prefers semantic columns even when legacy columns also contain values', () => {
    expect(readAllocationEfficiency({ blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.5,
      merBefore: 9, merAfter: 10 })).toEqual({
      efficiencyStatus: 'BLENDED_REVENUE_EFFICIENCY',
      blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.5,
    });
  });
  it('keeps untagged and #497-tagged historical values legacy, not MER or proven blended efficiency', () => {
    for (const reasoning of ['old projected MER', tagAllocationReasoning(['#497 allocation'])]) {
      expect(readAllocationEfficiency({ reasoning, merBefore: 2, merAfter: 2.5,
        blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null })).toEqual({
        efficiencyStatus: 'LEGACY_PROJECTED_EFFICIENCY',
        blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null,
      });
    }
  });
  it('does not publish partial or absent semantic values as a ratio', () => {
    expect(readAllocationEfficiency({ blendedRevenueEfficiencyBefore: 2,
      blendedRevenueEfficiencyAfter: null, merBefore: null, merAfter: null })).toEqual({
      efficiencyStatus: 'UNAVAILABLE', blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null,
    });
    expect(readAllocationEfficiency({ merBefore: null, merAfter: null })).toMatchObject({
      efficiencyStatus: 'UNAVAILABLE', blendedRevenueEfficiencyBefore: null,
    });
  });
});
