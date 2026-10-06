// ============================================================
// C-18 · the approved mix is what gets promoted
// ------------------------------------------------------------
// Ruling A: "الترقية هي تنفيذ لما تمت الموافقة عليه، وليست فرصة لإعادة تشغيل
// العقل." Approved X → the system must execute X, not a freshly computed Y,
// however much better Y is.
//
// What master does instead:
//
//   planToAllocationInput(plan)
//     → { totalBudgetMinor, goal: { type: GROWTH_CEILING } }   // two fields
//   commitAllocation(ws, input)
//     → previewAllocation → buildChannels → getBlendedTruth + latest verdicts
//
// `Plan.channelMix` — the schema calls it "snapshot of the allocation preview"
// — has exactly ONE mention in the repository: the write. Zero readers, backend
// or client. So the mix a strategist reviewed and signed off is not the mix that
// becomes budget moves, and nothing anywhere says so.
//
// These tests fix the two halves of the repair together, in one module, because
// they are one contract: what buildPlan writes must be exactly what promote can
// read back. A snapshot written in halves is the defect in a new costume.
// ============================================================
import { describe, it, expect } from 'vitest';
import { allocate } from '../allocation-engine/allocationEngine.js';
import {
  captureMixSnapshot,
  planToAllocationCommit,
  PROMOTION_REFUSAL,
} from './planPromotionSnapshot.js';

// A preview exactly as `previewAllocation` returns it (allocationEngine.js:235
// plus the `basis` that AllocationService adds).
const preview = () => ({
  goal: { type: 'GROWTH_CEILING', value: null },
  totalBudgetMinor: 1_000_000,
  currency: 'USD',
  monetaryStatus: 'MONETARY_VALID',
  monetaryReason: null,
  efficiencyStatus: 'VALID', efficiencyReason: null,
  spendPeriod: { status: 'MEASURABLE', currency: 'USD', spendMinor: 1_000_000 },
  basis: 'blended',
  allocations: [
    { channelId: 'ch-meta', channel: 'META', verdict: 'SCALE',
      currentSpendMinor: 400_000, recommendedSpendMinor: 600_000, deltaMinor: 200_000,
      blendedRoas: 2.4, rationale: 'SCALE at 2.40x blended' },
    { channelId: 'ch-goog', channel: 'GOOGLE', verdict: 'REALLOCATE',
      currentSpendMinor: 600_000, recommendedSpendMinor: 400_000, deltaMinor: -200_000,
      blendedRoas: 0.9, rationale: 'REALLOCATE at 0.90x blended' },
  ],
  projected: { blendedRevenueMinor: 2_100_000, projectedCpaMinor: 3_100, blendedRevenueEfficiencyBefore: 1.7, blendedRevenueEfficiencyAfter: 2.1 },
  reasoningTrail: ['ceiling 10,000.00 USD', 'META favoured on 2.40x blended'],
});

// A stored Plan row, as `buildPlan` writes one under this contract.
const storedPlan = (over = {}) => {
  const mix = preview();
  return {
    id: 'plan-1',
    totalBudgetMinor: mix.totalBudgetMinor,
    currency: mix.currency,
    channelMix: mix.allocations,
    projections: { scenario: null, economics: null, goalLanding: null, mix: captureMixSnapshot(mix) },
    ...over,
  };
};

describe('the snapshot is written whole', () => {
  it('captures everything the preview projected — not just the allocations', () => {
    // The four fields master threw away. AllocationPlan needs every one of them:
    // goalType and reasoning are NOT NULL columns, and the four projection
    // floats are what the row means.
    const snap = captureMixSnapshot(preview());
    expect(snap).toMatchObject({
      goal: { type: 'GROWTH_CEILING', value: null },
      totalBudgetMinor: 1_000_000,
      currency: 'USD',
      projected: { projectedCpaMinor: 3_100, blendedRevenueEfficiencyBefore: 1.7, blendedRevenueEfficiencyAfter: 2.1 },
      reasoningTrail: ['ceiling 10,000.00 USD', 'META favoured on 2.40x blended'],
    });
  });

  it('does NOT duplicate the allocations — channelMix stays their one home', () => {
    // channelMix is an existing column with existing rows. Widening it into an
    // object would give two shapes one name; storing the allocations twice would
    // give one fact two homes that can drift. Neither.
    expect(captureMixSnapshot(preview())).not.toHaveProperty('allocations');
  });

  it('answers null for a workspace with no channels, rather than an empty shell', () => {
    // previewAllocation returns null when buildChannels finds nothing. A shell of
    // zeroes would claim a projection that was never computed.
    expect(captureMixSnapshot(null)).toBeNull();
    expect(captureMixSnapshot(undefined)).toBeNull();
  });
});

describe('the snapshot is read back whole', () => {
  it('P7-07G copies the approved amount-free rationale/trail and exact money without recomputing prose', () => {
    const mix = { ...preview(), ...allocate({ totalBudgetMinor: 150_000, totalBudgetCurrency: 'EGP',
      channels: [
        { channelId: 'Meta', blendedRoas: 3, currentSpendMinor: 50_000, verdict: 'HOLD', currency: 'EGP', monetaryStatus: 'MONETARY_VALID' },
        { channelId: 'Google', blendedRoas: 1, currentSpendMinor: 50_000, verdict: 'HOLD', currency: 'EGP', monetaryStatus: 'MONETARY_VALID' },
      ] }), spendPeriod: { status: 'MEASURABLE', currency: 'EGP', spendMinor: 100_000 } };
    const commit = planToAllocationCommit({ id: 'approved-egp', totalBudgetMinor: mix.totalBudgetMinor,
      currency: mix.currency, channelMix: mix.allocations, projections: { mix: captureMixSnapshot(mix) } });
    expect(commit).toMatchObject({ totalBudgetMinor: 150_000, currency: 'EGP',
      allocations: mix.allocations, projected: mix.projected, reasoningTrail: mix.reasoningTrail });
    expect(commit.allocations[0]).toMatchObject({ currentSpendMinor: 50_000,
      recommendedSpendMinor: 105_000, deltaMinor: 55_000,
      rationale: 'Grow Meta (HOLD, blended revenue efficiency 3.00x).' });
    expect(commit.reasoningTrail[1]).toBe(commit.allocations[0].rationale);
  });
  it('rebuilds the exact allocation that was approved', () => {
    const commit = planToAllocationCommit(storedPlan());

    expect(commit.allocations).toEqual(preview().allocations);
    expect(commit.projected).toEqual(preview().projected);
    expect(commit.reasoningTrail).toEqual(preview().reasoningTrail);
    expect(commit.goal).toEqual({ type: 'GROWTH_CEILING', value: null });
    expect(commit.totalBudgetMinor).toBe(1_000_000);
    expect(commit.currency).toBe('USD');
  });

  it('carries the per-channel deltas untouched — these become the Decisions', () => {
    const commit = planToAllocationCommit(storedPlan());
    expect(commit.allocations.map((a) => [a.channelId, a.deltaMinor]))
      .toEqual([['ch-meta', 200_000], ['ch-goog', -200_000]]);
  });

  it('is pure — it takes a row and returns a value, and reads no live truth', () => {
    // The whole point. Called twice on the same row, a year apart, in a
    // workspace whose blended truth has completely turned over, it must answer
    // the same thing, because the answer is a record and not a computation.
    expect(planToAllocationCommit(storedPlan())).toEqual(planToAllocationCommit(storedPlan()));
  });
});

describe('an incomplete snapshot refuses — it is not filled in', () => {
  it('keeps a complete old mer snapshot legacy rather than granting current authority', () => {
    const p = storedPlan();
    delete p.projections.mix.efficiencyStatus;
    p.projections.mix.projected = { blendedRevenueMinor: 2_100_000, projectedCpaMinor: 3_100,
      merBefore: 1.7, merAfter: 2.1 };
    expect(() => planToAllocationCommit(p)).toThrowError(
      expect.objectContaining({ code: PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE }),
    );
    expect(p.projections.mix.projected.merAfter).toBe(2.1); // read refusal did not rewrite history
  });
  it('refuses a plan built before this contract, and names its prerequisite', () => {
    // Every plan on master carries channelMix and NO projections.mix. Its moves
    // are fully recorded; what it projected is not, and AllocationPlan.reasoning
    // is NOT NULL. Inventing a trail, or recomputing one from today's data, are
    // the two things Ruling A forbids. So it refuses and says what would end the
    // refusal (C-07's law).
    const legacy = storedPlan({ projections: { scenario: null, economics: null, goalLanding: null } });

    expect(() => planToAllocationCommit(legacy)).toThrowError(
      expect.objectContaining({ code: PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE }),
    );
  });

  it('refuses a snapshot missing its reasoning trail', () => {
    const p = storedPlan();
    delete p.projections.mix.reasoningTrail;
    expect(() => planToAllocationCommit(p)).toThrowError(
      expect.objectContaining({ code: PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE }),
    );
  });

  it('refuses a snapshot missing its projection', () => {
    const p = storedPlan();
    delete p.projections.mix.projected;
    expect(() => planToAllocationCommit(p)).toThrowError(
      expect.objectContaining({ code: PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE }),
    );
  });

  it('refuses a snapshot missing its goal type — the column is NOT NULL', () => {
    const p = storedPlan();
    delete p.projections.mix.goal;
    expect(() => planToAllocationCommit(p)).toThrowError(
      expect.objectContaining({ code: PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE }),
    );
  });

  it('refuses a plan with no channels in its mix, separately and by its own name', () => {
    // Different fact, different refusal: the snapshot is complete and says
    // "there was nothing to allocate". That is NothingToPromote, not incomplete.
    const p = storedPlan({ channelMix: [] });
    expect(() => planToAllocationCommit(p)).toThrowError(
      expect.objectContaining({ code: PROMOTION_REFUSAL.NOTHING_TO_PROMOTE }),
    );
  });

  it('does NOT treat an all-zero-delta mix as nothing to promote', () => {
    // An approved mix that says "current spend is already right" is a real
    // promotion with no moves — I-18.5's second outcome, not a refusal.
    const mix = preview();
    mix.allocations = mix.allocations.map((a) => ({ ...a, deltaMinor: 0, recommendedSpendMinor: a.currentSpendMinor }));
    const p = storedPlan({ channelMix: mix.allocations });

    expect(() => planToAllocationCommit(p)).not.toThrow();
    expect(planToAllocationCommit(p).allocations).toHaveLength(2);
  });
});

describe('the recompute path is gone, not merely unused', () => {
  it('PlanService no longer exports planToAllocationInput', async () => {
    // Asserted, not assumed — exactly as C-05 asserted the one-call promote was
    // gone rather than left as a quiet alias. That function's ENTIRE purpose was
    // to feed the recompute: it returned totalBudgetMinor and a hardcoded goal,
    // and threw the approved mix away. Leaving it exported keeps a live path
    // back to the defect.
    const PlanService = await import('./PlanService.js');
    expect(PlanService.planToAllocationInput).toBeUndefined();
  });
});
