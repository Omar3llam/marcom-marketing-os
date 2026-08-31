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
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { incrementalityTest: { findMany: vi.fn() } },
}));

import { getReconciliation, incrementalChannels } from './ReconciliationService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { prisma } from '../../lib/prisma.js';

function channel(over = {}) {
  return {
    channelId: 'a', channel: 'META',
    platformRevenueMinor: 100_000, blendedRevenueMinor: 90_000,
    spendMinor: 50_000, blendedRoas: 1.8, currency: 'USD', coverage: 'RECONCILED',
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

describe('ReconciliationService.getReconciliation', () => {
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
    expect(a.incremental.value).toBe(60_000);
    expect(a.incremental.source).toBe('INCREMENTALITY');
    expect(a.incremental.band).toEqual([50_000, 70_000]);
    expect(a.gaps.platformVsBlendedMinor).toBe(10_000);   // 100k − 90k
    expect(a.gaps.blendedVsIncrementalMinor).toBe(30_000); // 90k − 60k

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
    expect(out.rows[0].incremental.value).toBe(45_000);
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

  it('discounts marginal efficiency by the measured incremental/claimed ratio (basis=incremental)', async () => {
    // ratio = 60k / 100k = 0.6 → 2.0 * 0.6 = 1.2
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 60_000 },
    ]);
    const { channels, anyIncremental } = await incrementalChannels('ws1');
    expect(anyIncremental).toBe(true);
    expect(channels[0].marginalEfficiency).toBeCloseTo(1.2);
    expect(channels[0].basis).toBe('incremental');
  });

  it('clamps the ratio to [0, 1.5] — incremental cannot inflate efficiency unboundedly', async () => {
    // ratio = 200k / 100k = 2.0 → clamped to 1.5 → 2.0 * 1.5 = 3.0
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: 200_000 },
    ]);
    const { channels } = await incrementalChannels('ws1');
    expect(channels[0].marginalEfficiency).toBeCloseTo(3.0);
  });

  it('clamps a negative measured lift to 0 (basis=incremental, efficiency floored)', async () => {
    getBlendedTruth.mockResolvedValue(bt([channel({ blendedRoas: 2.0, blendedRevenueMinor: 100_000 })]));
    prisma.incrementalityTest.findMany.mockResolvedValue([
      { entityId: 'a', channel: 'META', status: 'CONCLUDED', incrementalRevenueMinor: -10_000 },
    ]);
    const { channels, anyIncremental } = await incrementalChannels('ws1');
    expect(anyIncremental).toBe(true);
    expect(channels[0].marginalEfficiency).toBe(0);
    expect(channels[0].basis).toBe('incremental');
  });
});
