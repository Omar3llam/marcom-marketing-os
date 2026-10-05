// ============================================================
// ReconciliationService — three honest revenue views + allocation feed
// ============================================================
// Proves the composition: platform / blended / incremental columns with
// the gaps explicit, and the incremental-discounted allocation feed. The
// DB seam (getBlendedTruth + concluded holdouts) is mocked; the real
// attribution primitive runs. Governing law: a channel with no holdout
// reports incremental = null (not proven causal), never a fabricated lift.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...await importOriginal(), getBlendedTruth: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { incrementalityTest: { findMany: vi.fn() }, decision: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('../budget-period/spendPeriod.js', async (importOriginal) => ({
  ...await importOriginal(), readPeriodSpend: vi.fn(),
}));

import { getReconciliation, incrementalChannels } from './ReconciliationService.js';
import { projectIncrementalityTest } from '../incrementality-engine/incrementalityProjection.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { prisma } from '../../lib/prisma.js';
import { readPeriodSpend } from '../budget-period/spendPeriod.js';
import { previewAllocation, persistAllocation, planToDecisionRows } from '../allocation-engine/AllocationService.js';
import { reconcile } from '../blended-truth/blendedTruthEngine.js';
import { exactRevenueWindow } from '../../lib/revenueMeasurementWindow.js';

function channel(over = {}) {
  return {
    channelId: 'a', channel: 'META',
    platformRevenueMinor: 100_000, blendedRevenueMinor: 90_000,
    spendMinor: 50_000, blendedRoas: 1.8, currency: 'USD', coverage: 'RECONCILED',
    reconciliation: { status: 'AVAILABLE', gapMinor: 10_000, gapPct: .1 },
    gapMinor: 10_000, monetaryStatus: 'MONETARY_VALID', monetaryReason: null,
    ...over,
  };
}

function bt(channels) {
  return {
    channels,
    portfolio: {
      spendMinor: channels.reduce((s, c) => s + c.spendMinor, 0),
      platformRevenueMinor: channels.reduce((s, c) => s + c.platformRevenueMinor, 0),
      blendedRevenueMinor: channels.reduce((s, c) => s + c.blendedRevenueMinor, 0),
      gapMinor: 0, gapPct: 0,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.incrementalityTest.findMany.mockResolvedValue([]);
});

it('allocation preview remains eligible with valid efficiency and unavailable source reconciliation', async () => {
  const window = exactRevenueWindow('2026-08-01', '2026-08-30');
  const money = { monetaryStatus: 'MONETARY_VALID', monetaryReason: null, currency: 'USD' };
  const truth = reconcile({ channels: ['a', 'b'].map(channelId => ({ channelId, channel: 'META',
    platformRevenueMinor: 100000, actualRevenueMinor: 75000, spendMinor: 25000,
    platformRevenueWindow: exactRevenueWindow('2026-09-01', '2026-09-30'), actualRevenueWindow: window, spendWindow: window,
    monetaryEvidence: { platform: money, actual: money, blended: money, spend: money } })) });
  expect(truth.portfolio.blendedRevenueEfficiency.status).toBe('VALID');
  expect(truth.channels.every(c => c.reconciliation.status === 'UNAVAILABLE')).toBe(true);
  getBlendedTruth.mockResolvedValue(truth);
  readPeriodSpend.mockResolvedValue({ portfolio: { status: 'MEASURABLE', ...money, spendMinor: 50000,
    spendWindow: window, period: { start: '2026-08-01', end: '2026-08-30' } }, byEntity: new Map([['a', 25000], ['b', 25000]]) });
  const plan = await previewAllocation('ws1', { totalBudgetMinor: 100000, totalBudgetCurrency: 'USD', period: { start: '2026-08-01', end: '2026-08-30' } });
  expect(plan.monetaryStatus).toBe('MONETARY_VALID'); expect(plan.efficiencyStatus).toBe('VALID');
  expect(plan.allocations.every(c => Number.isFinite(c.recommendedSpendMinor))).toBe(true);
  expect(plan.projected.blendedRevenueEfficiencyAfter).not.toBeNull();
});

describe('ReconciliationService.getReconciliation', () => {
  it('cannot claim reconciliation from coverage or stale aliases alone', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ reconciliation: { status: 'UNAVAILABLE', gapMinor: null }, gapMinor: 10000 })]));
    const result = await getReconciliation('ws1');
    expect(result.rows[0].blended.caveat).toBe('actual revenue evidence — platform comparison unavailable');
    expect(result.rows[0].gaps.platformVsBlendedMinor).toBeNull();
    expect(result.portfolio.platformVsBlendedMinor).toBeNull();
  });
  it('requires a workspaceId', async () => {
    await expect(getReconciliation()).rejects.toThrow(/workspaceId/);
  });

  it('returns INSUFFICIENT_DATA (no rows, no portfolio) when no channels are connected', async () => {
    getBlendedTruth.mockResolvedValue(bt([]));
    const out = await getReconciliation('ws1');
    expect(out).toEqual({ status: 'INSUFFICIENT_DATA', rows: [], portfolio: null });
    expect(prisma.incrementalityTest.findMany).not.toHaveBeenCalled(); // short-circuits before the test read
  });

  it('maps platform/blended/incremental columns with confidence by coverage + holdout, and explicit gaps', async () => {
    getBlendedTruth.mockResolvedValue(bt([
      channel({ channelId: 'a', channel: 'META', coverage: 'RECONCILED' }),
      channel({ channelId: 'b', channel: 'GOOGLE', platformRevenueMinor: 80_000, blendedRevenueMinor: 80_000, coverage: 'UNVERIFIED' }),
    ]));
    // A concluded holdout on channel A only (matched by entityId), with a CI band.
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 60_000, confidenceLabel: 'MEDIUM', ciLow: 50_000, ciHigh: 70_000 },
    ]);

    const out = await getReconciliation('ws1');
    expect(out.status).toBe('OK');
    expect(out.rows).toHaveLength(2);

    const a = out.rows.find((r) => r.channelId === 'a');
    expect(a.platform.confidence).toBe('MEDIUM');
    expect(a.blended.confidence).toBe('HIGH');        // RECONCILED → HIGH
    expect(a.incremental.value).toBeNull();
    expect(a.incremental.reason).toBe('INCREMENTAL_MONETARY_BASIS_UNPROVEN');
    expect(a.holdout).toMatchObject({ ciLow: 50_000, ciHigh: 70_000, confidenceLabel: 'MEDIUM' });
    expect(a.gaps.platformVsBlendedMinor).toBe(10_000);   // 100k − 90k
    expect(a.gaps.blendedVsIncrementalMinor).toBeNull();

    const b = out.rows.find((r) => r.channelId === 'b');
    expect(b.blended.confidence).toBe('LOW');         // UNVERIFIED → LOW
    expect(b.incremental.value).toBeNull();           // no holdout — not proven causal
    expect(b.gaps.blendedVsIncrementalMinor).toBeNull();
  });

  it('matches a holdout by channel name when the test carries no entityId', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ channelId: 'a', channel: 'META' })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: null, channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 45_000 },
    ]);

    const out = await getReconciliation('ws1');
    expect(out.rows[0].incremental.reason).toBe('INCREMENTAL_MONETARY_BASIS_UNPROVEN');
  });
});

// ── B5-01T′ · reporting degrades, decisions refuse ─────────────────────────
//
// Both halves read the SAME holdout query through the same helper. Before this
// slice both answered a rejection with an empty Map, so the report said "no
// holdout on this channel" and the allocation feed said "optimise on claimed
// performance" — two different lies from one dead read.
describe('ReconciliationService — a failed holdout read (B5-01T′)', () => {
  it('T3 — the REPORT says unavailable, not "no holdout on this channel"', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel()]));
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    const out = await getReconciliation('ws1');

    expect(out.status).toBe('EVIDENCE_UNAVAILABLE');
    expect(out.evidence).toEqual({ incrementality: 'UNAVAILABLE' });

    const inc = out.rows[0].incremental;
    expect(inc.value).toBeNull();
    expect(inc.status).toBe('UNAVAILABLE');
    expect(inc.reason).toBe('INCREMENTALITY_EVIDENCE_UNAVAILABLE');
    expect(inc.source).toBe('UNAVAILABLE');
    expect(inc.source).not.toBe('INCREMENTALITY');
    expect(inc.caveat).not.toMatch(/no holdout on this channel/);
    expect(inc.caveat).toMatch(/could not be read/);
  });

  it('T3b — a SUCCESSFUL empty read keeps saying "no holdout on this channel"', async () => {
    // The distinction, from the other side. This is a real finding about the
    // account and must survive untouched — value null, but for a reason we
    // actually established.
    getBlendedTruth.mockResolvedValue(bt([channel()]));
    prisma.incrementalityTest.findMany.mockResolvedValue([]);

    const out = await getReconciliation('ws1');

    expect(out.status).toBe('OK');
    expect(out.evidence).toEqual({ incrementality: 'OK' });
    expect(out.rows[0].incremental.value).toBeNull();
    expect(out.rows[0].incremental.status).toBe('OK');
    expect(out.rows[0].incremental.source).toBe('INCREMENTALITY');
    expect(out.rows[0].incremental.caveat).toMatch(/no holdout on this channel/);
  });

  it('T5 — the platform and blended columns still carry their real numbers', async () => {
    // Reporting degrades; it does not blank. Only the column whose evidence died
    // goes dark.
    getBlendedTruth.mockResolvedValue(bt([channel()]));
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    const out = await getReconciliation('ws1');
    expect(out.rows[0].platform.value).toBe(100_000);
    expect(out.rows[0].platform.status).toBe('OK');
    expect(out.rows[0].blended.value).toBe(90_000);
    expect(out.portfolio.spendMinor).toBe(50_000);
  });

  it('T7 — the ALLOCATION FEED refuses instead of falling back to claimed', async () => {
    // The half that moves money. `basis: 'incremental'` is a caller stating that
    // claimed performance is not good enough for this decision; answering it with
    // claimed performance anyway is the failure this refuses.
    getBlendedTruth.mockResolvedValue(bt([channel()]));
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    await expect(incrementalChannels('ws1')).rejects.toMatchObject({
      code: 'ATTRIBUTION_EVIDENCE_UNAVAILABLE',
      reason: 'INCREMENTALITY_EVIDENCE_UNAVAILABLE',
    });
  });

  it('T8 — a SUCCESSFUL empty read still feeds allocation on the blended basis', async () => {
    // Successful absence is not failed measurement. "This account has run no
    // holdouts" is a legitimate answer and must keep working, or the refusal
    // above would have made the feature unusable rather than honest.
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([]);

    const { channels, anyIncremental } = await incrementalChannels('ws1');
    expect(anyIncremental).toBe(false);
    expect(channels[0].basis).toBe('blended');
    expect(channels[0].marginalEfficiency).toBeCloseTo(2.0);
  });
});

describe('ReconciliationService.incrementalChannels — allocation feed', () => {
  it('SC-10 safe public projection cannot restore monetary reconciliation or allocation authority', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([projectIncrementalityTest({
      entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 60_000,
    })]);
    const report = await getReconciliation('ws1');
    expect(report.rows[0].incremental.value).toBeNull();
    expect(report.rows[0].incremental.reason).toBe('INCREMENTAL_MONETARY_BASIS_UNPROVEN');
    const feed = await incrementalChannels('ws1');
    expect(feed.anyIncremental).toBe(false);
    expect(feed.channels[0]).toMatchObject({
      monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED', currency: null,
      monetaryReason: 'INCREMENTAL_MONETARY_BASIS_UNPROVEN',
    });
    readPeriodSpend.mockResolvedValue({
      portfolio: { status: 'MEASURABLE', monetaryStatus: 'MONETARY_VALID', currency: 'USD',
        spendMinor: 50_000, period: { start: '2026-08-01', end: '2026-08-31' } },
      byEntity: new Map([['a', 50_000]]),
    });
    const plan = await previewAllocation('ws1', {
      basis: 'incremental', totalBudgetMinor: 100_000, totalBudgetCurrency: 'USD',
    });
    expect(plan.monetaryStatus).toBe('MONETARY_UNAVAILABLE_UNTRUSTED');
    expect(plan.allocations[0].recommendedSpendMinor).toBeNull();
    expect(plan.projected.blendedRevenueEfficiencyAfter).toBeNull();
    expect(planToDecisionRows(plan, { workspaceId: 'ws1', planId: 'p1' })).toEqual([]);
    const create = vi.fn();
    await expect(persistAllocation({ allocationPlan: { create } }, 'ws1', plan))
      .rejects.toMatchObject({ code: 'AllocationMonetaryUnavailable' });
    expect(create).not.toHaveBeenCalled();
  });
  it('requires a workspaceId', async () => {
    await expect(incrementalChannels()).rejects.toThrow(/workspaceId/);
  });

  it('returns an empty feed when no channels are connected', async () => {
    getBlendedTruth.mockResolvedValue(bt([]));
    expect(await incrementalChannels('ws1')).toEqual({ channels: [], anyIncremental: false });
  });

  it('keeps blendedRoas as marginal efficiency for an untested channel (basis=blended)', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 90_000 })]));
    const { channels, anyIncremental } = await incrementalChannels('ws1');
    expect(anyIncremental).toBe(false);
    expect(channels[0].marginalEfficiency).toBeCloseTo(2.0);
    expect(channels[0].basis).toBe('blended');
  });

  it('refuses a historical holdout ratio without a valuation denomination', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 60_000 },
    ]);
    const { channels, anyIncremental } = await incrementalChannels('ws1');
    expect(anyIncremental).toBe(false);
    expect(channels[0].monetaryStatus).toBe('MONETARY_UNAVAILABLE_UNTRUSTED');
    expect(channels[0].monetaryReason).toBe('INCREMENTAL_MONETARY_BASIS_UNPROVEN');
    expect(channels[0].currency).toBeNull();
  });

  it('does not turn an oversized unproven holdout value into efficiency', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 200_000 },
    ]);
    const { channels } = await incrementalChannels('ws1');
    expect(channels[0].monetaryReason).toBe('INCREMENTAL_MONETARY_BASIS_UNPROVEN');
    expect(channels[0].basis).toBe('blended');
  });

  it('does not treat negative unproven holdout money as a zero efficiency', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: -10_000 },
    ]);
    const { channels, anyIncremental } = await incrementalChannels('ws1');
    expect(anyIncremental).toBe(false);
    expect(channels[0].monetaryReason).toBe('INCREMENTAL_MONETARY_BASIS_UNPROVEN');
    expect(channels[0].marginalEfficiency).toBeCloseTo(2.0);
  });
});
