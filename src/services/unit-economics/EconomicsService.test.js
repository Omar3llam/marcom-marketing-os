// ============================================================
// EconomicsService — the standalone assessment's correctness gate
// ============================================================
// The Intelligence surface reads a CURRENT (realized) CAC that must NOT be
// confused with a plan's projected CAC. This gate proves:
//   1. currentBlendedCacMinor = Σ real spend ÷ Σ real platform conversions
//      (the same conversion source attribution uses); null when 0 conversions.
//   2. non-platform-source conversions are excluded (no CSV/manual inflation).
//   3. getEconomicsAssessment computes a verdict ONLY when economics are
//      ASSERTED (not default) AND a real CAC exists — never off seeded defaults.
// The real engine runs; only the DB + blended truth are mocked.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// getBlendedTruth is stubbed, but latestPerStream is deliberately kept REAL:
// the invariant under test is that Economics and Attribution reduce snapshots
// identically, and a hand-written stub of the reduction would let the two drift
// apart while both test suites stayed green.
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    accountEconomics: { findUnique: vi.fn() },
    workspace:        { findUnique: vi.fn() },
    metricSnapshot:   { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getCurrentCac, getEconomicsAssessment } from './EconomicsService.js';

const channel = (channelId, spendMinor, currency = 'USD') => ({ channelId, spendMinor, currency });
const conv = (entityId, conversions, source, date = new Date('2026-08-01T00:00:00Z')) =>
  ({ entityId, conversions, source, date });
// A conversion count as it is actually stored: a trailing-window total for its
// sync day, so day N already contains day N-1's conversions.
const convOn = (n, entityId, conversions, source = 'META') =>
  conv(entityId, conversions, source, new Date(`2026-08-0${n}T09:00:00Z`));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
});

describe('getCurrentCac — realized blended CAC (distinct from a plan projection)', () => {
  it('= Σ spend ÷ Σ platform conversions', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000), channel('google', 40000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      conv('meta', 50, 'META'), conv('google', 30, 'GOOGLE'),
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalSpendMinor).toBe(100000);
    expect(cac.totalConversions).toBe(80);
    expect(cac.currentBlendedCacMinor).toBe(1250); // round(100000 / 80)
  });

  it('is null when there are zero conversions (no realized CAC to compute)', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([conv('meta', 0, 'META')]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.currentBlendedCacMinor).toBeNull();
  });

  it('excludes non-platform-source conversions (no CSV/manual inflation)', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      conv('meta', 40, 'META'), conv('meta', 999, 'CSV'), // CSV ignored
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).toBe(40);
    expect(cac.currentBlendedCacMinor).toBe(1500); // round(60000 / 40)
  });

  it('null CAC when no channels are connected', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [], portfolio: {} });
    const cac = await getCurrentCac('ws-1');
    expect(cac.currentBlendedCacMinor).toBeNull();
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// Overlapping trailing-window snapshots (#359)
// ------------------------------------------------------------
// This query has NO date filter at all, so before the fix it summed every
// conversion row a channel had ever written — one trailing-window total per
// sync, added together. CAC is spend ÷ conversions, so an inflated denominator
// makes acquisition look CHEAPER than it is, which is the direction that gets
// a budget increased. That is why this number matters more than its size
// suggests.
// ============================================================
describe('getCurrentCac — conversions come from the newest reading, not every reading', () => {
  it('C · three overlapping conversion totals collapse to the newest', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 100000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 80), convOn(2, 'meta', 83), convOn(3, 'meta', 91),
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).toBe(91);
    expect(cac.totalConversions).not.toBe(254); // 80+83+91 — the defect
    expect(cac.currentBlendedCacMinor).toBe(1099); // round(100000/91), not 394
  });

  it('D · sums ACROSS entities but never ACROSS one entity\'s syncs', async () => {
    getBlendedTruth.mockResolvedValue({
      channels: [channel('meta', 60000), channel('google', 40000)], portfolio: {},
    });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 40),             convOn(2, 'meta', 50),
      convOn(1, 'google', 24, 'GOOGLE'), convOn(2, 'google', 30, 'GOOGLE'),
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).toBe(80); // 50 + 30, the two newest
    expect(cac.currentBlendedCacMinor).toBe(1250);
  });

  // §9 cross-service fixture — the same rows, the same 140, in all three services.
  it('G · a stale historical row is superseded, never added', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 100), convOn(2, 'meta', 120), convOn(3, 'meta', 140),
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).toBe(140);
    expect(cac.totalConversions).not.toBe(360);
  });

  it('E · no snapshots leaves CAC null — a missing measurement is not zero cost', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).toBe(0);
    expect(cac.currentBlendedCacMinor).toBeNull(); // NOT 0, and NOT 60000
  });

  it('F · conversions absent from the newest row are not inherited from an older one', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 100),
      { entityId: 'meta', source: 'META', date: new Date('2026-08-02T09:00:00Z') }, // no `conversions`
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).not.toBe(100);
    expect(cac.currentBlendedCacMinor).toBeNull(); // honest absence, not a stale CAC
  });

  it('still excludes non-platform sources after the reduction', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 60000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 30), convOn(2, 'meta', 40),
      convOn(3, 'meta', 999, 'MANUAL'), // newest overall, still ignored
    ]);
    const cac = await getCurrentCac('ws-1');
    expect(cac.totalConversions).toBe(40);
  });

  it('is order-independent — the query carries no orderBy', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 100000)], portfolio: {} });
    for (const rows of [[3, 1, 2], [2, 3, 1], [1, 2, 3]]) {
      prisma.metricSnapshot.findMany.mockResolvedValue(
        rows.map((n) => convOn(n, 'meta', { 1: 80, 2: 83, 3: 91 }[n])),
      );
      expect((await getCurrentCac('ws-1')).totalConversions).toBe(91);
    }
  });
});

describe('getEconomicsAssessment — verdict only on asserted economics + real CAC', () => {
  it('NOT_CONFIGURED: economics never asserted → no verdict even when a CAC exists', async () => {
    prisma.accountEconomics.findUnique.mockResolvedValue(null); // → isDefault
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 100000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([conv('meta', 50, 'META')]);

    const out = await getEconomicsAssessment('ws-1');
    expect(out.isDefault).toBe(true);
    expect(out.reason).toBe('NOT_CONFIGURED');
    expect(out.assessment).toBeNull(); // never computed off defaults
    expect(out.currentCac.currentBlendedCacMinor).toBe(2000); // CAC still reported
  });

  it('NO_CONVERSIONS: asserted economics but no realized CAC → honest-empty', async () => {
    prisma.accountEconomics.findUnique.mockResolvedValue({
      workspaceId: 'ws-1', currency: 'USD', aovMinor: 10000, grossMarginPct: 0.6,
      repeatRate: 0, avgOrdersPerCustomer: 2, targetLtvToCac: 3,
    });
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 100000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([conv('meta', 0, 'META')]);

    const out = await getEconomicsAssessment('ws-1');
    expect(out.isDefault).toBe(false);
    expect(out.reason).toBe('NO_CONVERSIONS');
    expect(out.assessment).toBeNull();
  });

  it('computes a real verdict when economics are asserted AND a CAC exists', async () => {
    prisma.accountEconomics.findUnique.mockResolvedValue({
      workspaceId: 'ws-1', currency: 'USD', aovMinor: 10000, grossMarginPct: 0.6,
      repeatRate: 0, avgOrdersPerCustomer: 2, targetLtvToCac: 3,
    });
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta', 100000)], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([conv('meta', 50, 'META')]); // CAC = 2000

    const out = await getEconomicsAssessment('ws-1');
    expect(out.isDefault).toBe(false);
    expect(out.reason).toBeNull();
    expect(out.assessment).not.toBeNull();
    // contribution = 10000×0.6 = 6000; LTV = 6000×2 = 12000; LTV:CAC = 12000/2000 = 6
    expect(out.assessment.ltvToCac.expected).toBe(6);
    expect(out.assessment.sustainabilityBand.expected).toBe('HEALTHY'); // 6 ≥ target 3
    expect(out.assessment.paybackOrders).toBe(1); // ceil(2000/6000)
  });
});
