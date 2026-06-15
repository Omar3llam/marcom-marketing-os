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
