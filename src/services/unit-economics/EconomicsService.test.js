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
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));
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
const conv = (entityId, conversions, source) => ({ entityId, conversions, source });

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
