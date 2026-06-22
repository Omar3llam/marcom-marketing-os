import { describe, it, expect } from 'vitest';
import { planToAllocationInput, isPromotionApprovalBlocked } from './PlanService.js';
import { buildScenarioInputs } from '../scenario-engine/ScenarioService.js';
import { GOAL_TYPE } from '../allocation-engine/allocationEngine.js';

describe('isPromotionApprovalBlocked — the role-agnostic plan-state gate', () => {
  it('does NOT block a plan with no approval gate (the default)', () => {
    expect(isPromotionApprovalBlocked({ requiresApproval: false, approvalState: null })).toBe(false);
  });
  it('blocks a plan whose gate is open and PENDING — for ANY role', () => {
    expect(isPromotionApprovalBlocked({ requiresApproval: true, approvalState: 'PENDING' })).toBe(true);
  });
  it('blocks a REJECTED (revision-requested) plan', () => {
    expect(isPromotionApprovalBlocked({ requiresApproval: true, approvalState: 'REJECTED' })).toBe(true);
  });
  it('unblocks once APPROVED', () => {
    expect(isPromotionApprovalBlocked({ requiresApproval: true, approvalState: 'APPROVED' })).toBe(false);
  });
  it('treats a missing plan as not-blocked (the not-found path owns that error)', () => {
    expect(isPromotionApprovalBlocked(null)).toBe(false);
  });
});

describe('planToAllocationInput — promotion rides the Phase-3 loop', () => {
  it('derives a GROWTH_CEILING allocation input from a stored plan', () => {
    const input = planToAllocationInput({ totalBudgetMinor: 2_000_000 });
    expect(input.totalBudgetMinor).toBe(2_000_000);
    expect(input.goal.type).toBe(GOAL_TYPE.GROWTH_CEILING);
  });

  it('throws when the plan has no budget', () => {
    expect(() => planToAllocationInput({})).toThrow(/totalBudgetMinor/);
  });
});

describe('buildScenarioInputs — memory powers the band + traceability', () => {
  const channels = [
    { channelId: 'meta', channel: 'META', spendMinor: 1_000_000, blendedRoas: 3.0, currency: 'USD' },
  ];
  const economics = { aovMinor: 5_000, grossMarginPct: 0.6, currency: 'USD' };

  it('maps accurate patterns into both memory band and memoryBasis', () => {
    const patterns = [
      { id: 'p1', kind: 'FATIGUE_CEILING', statement: 'fatigue at 3.5', accuracy: 0.82, cohortTag: 'EG-apparel' },
      { id: 'p2', kind: 'SCALING_WINDOW', statement: 'scale held at 2.4x', accuracy: 0.74 },
      { id: 'p3', kind: 'SEASONAL_EFFECT', statement: 'no accuracy yet', accuracy: null }, // dropped
    ];
    const out = buildScenarioInputs(channels, economics, patterns);
    expect(out.baseline).toHaveLength(1);
    expect(out.economics.aovMinor).toBe(5_000);
    // null-accuracy pattern is excluded from both.
    expect(out.memory).toHaveLength(2);
    expect(out.memoryBasis).toHaveLength(2);
    expect(out.memoryBasis[0]).toMatchObject({ patternId: 'p1', accuracy: 0.82 });
  });

  it('produces empty memory when no patterns', () => {
    const out = buildScenarioInputs(channels, economics, []);
    expect(out.memory).toEqual([]);
    expect(out.memoryBasis).toEqual([]);
  });
});
