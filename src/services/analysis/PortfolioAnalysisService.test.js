// ============================================================
// PortfolioAnalysisService — advisory portfolio narration
// ------------------------------------------------------------
// The load-bearing contract: this service ADVISES. It must never write a
// Decision (the deterministic verdict engine owns those), never fabricate a
// campaign, and never fail its caller. The revenueNeeded list must come from
// real rows — not from whatever the model said.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  campaigns: [],
  verdicts: [],
  gatewayResult: { success: true, output: { insight: 'Portfolio is stable.' } },
  gatewayThrows: false,
}));

const loopRunUpdate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const decisionCreate = vi.hoisted(() => vi.fn());
const decisionUpsert = vi.hoisted(() => vi.fn());

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn(async () => ({ name: 'Acme', currency: 'EGP', objective: 'growth', market: 'EG', industry: 'retail' })) },
    loopRun: { update: loopRunUpdate },
    decision: { create: decisionCreate, upsert: decisionUpsert },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../entity-graph/index.js', () => ({
  getConnectorCampaigns: vi.fn(async () => h.campaigns),
}));
vi.mock('../verdict-engine/index.js', async () => {
  // Reuse the REAL needsRevenueData so the test exercises the true objective
  // taxonomy (an awareness campaign must never be told it needs revenue).
  const real = await vi.importActual('../verdict-engine/connectorVerdictService.js');
  return {
    getConnectorVerdicts: vi.fn(async () => ({ verdicts: h.verdicts })),
    needsRevenueData: real.needsRevenueData,
  };
});
vi.mock('./AccountHealthService.js', () => ({
  computeAccountHealth: vi.fn(() => ({ score: 62, label: 'Fair', wastedSpend: { minor: 5000, pct: 12.5 } })),
}));
vi.mock('../ai-gateway/ProviderGateway.js', () => ({
  execute: vi.fn(async () => {
    if (h.gatewayThrows) throw new Error('gateway down');
    return h.gatewayResult;
  }),
}));

import { runPortfolioAnalysis, enrichCampaigns, countVerdicts } from './PortfolioAnalysisService.js';
import { execute } from '../ai-gateway/ProviderGateway.js';

// A conversion campaign that spent but measured no revenue → needs revenue.
const conversionNoRevenue = {
  entityId: 'c1', name: 'Ramadan Cold', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 1_416_000, revenueMinor: 0, impressions: 90_000, clicks: 900, ctr: 0.01, frequency: 4.2,
};
// A genuine awareness campaign with no revenue → does NOT need revenue.
const awareness = {
  entityId: 'c2', name: 'Brand Reach', channel: 'META', objective: 'OUTCOME_AWARENESS',
  spendMinor: 500_000, revenueMinor: 0, impressions: 200_000, clicks: 1000, ctr: 0.005, frequency: 2.1,
};
// A measured conversion campaign → scoreable, no gap.
const measured = {
  entityId: 'c3', name: 'PMax Warm', channel: 'GOOGLE', objective: 'OUTCOME_SALES',
  spendMinor: 200_000, revenueMinor: 960_000, roas: 4.8, impressions: 40_000, clicks: 800, ctr: 0.02, frequency: 1.4,
};

beforeEach(() => {
  h.campaigns = [conversionNoRevenue, awareness, measured];
  h.verdicts = [{ id: 'c1', verdict: 'KILL' }, { id: 'c3', verdict: 'SCALE' }];
  h.gatewayResult = { success: true, output: { insight: 'Portfolio is stable.' } };
  h.gatewayThrows = false;
  vi.clearAllMocks();
  loopRunUpdate.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('PortfolioAnalysisService — advises, never overrides', () => {
  it('NEVER writes a Decision row (the deterministic engine owns verdicts)', async () => {
    await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(decisionCreate).not.toHaveBeenCalled();
    expect(decisionUpsert).not.toHaveBeenCalled();
  });

  it('stores the advisory prose on the sweep’s LoopRun.aiInsight', async () => {
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(out.insight).toBe('Portfolio is stable.');
    expect(loopRunUpdate).toHaveBeenCalledWith({ where: { id: 'run1' }, data: { aiInsight: 'Portfolio is stable.' } });
  });

  it('routes through the ANALYZE_PORTFOLIO capability', async () => {
    await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ capability: 'ANALYZE_PORTFOLIO', workspaceId: 'ws1' }));
  });
});

describe('PortfolioAnalysisService — deterministic revenueNeeded', () => {
  it('flags a conversion campaign with no measured revenue, NOT the awareness one', async () => {
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(out.revenueNeeded).toEqual([{ entityId: 'c1', name: 'Ramadan Cold' }]);
  });

  it('comes from real rows, never from the model (a hallucinated name cannot leak)', async () => {
    h.gatewayResult = { success: true, output: { insight: 'Upload revenue for "Totally Made Up Campaign".' } };
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(out.revenueNeeded.map((r) => r.name)).toEqual(['Ramadan Cold']);
  });

  it('a measured campaign is never asked for revenue', async () => {
    h.campaigns = [measured];
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(out.revenueNeeded).toEqual([]);
  });
});

describe('PortfolioAnalysisService — honest degradation', () => {
  it('a gateway failure still returns the real revenueNeeded, with a null insight', async () => {
    h.gatewayResult = { success: false, error: { message: 'rate limited' } };
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(out.insight).toBeNull();
    expect(out.revenueNeeded).toHaveLength(1);
    expect(loopRunUpdate).not.toHaveBeenCalled(); // never store a null insight
  });

  it('a thrown gateway never fails the caller (the sweep must survive)', async () => {
    h.gatewayThrows = true;
    await expect(runPortfolioAnalysis('ws1', { loopRunId: 'run1' })).resolves.toBeNull();
  });

  it('a zero-spend / cold account narrates nothing (no invented "looks fine")', async () => {
    h.campaigns = [{ entityId: 'r1', name: 'Roster only', channel: 'META', spendMinor: 0 }];
    await expect(runPortfolioAnalysis('ws1', { loopRunId: 'run1' })).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('no workspaceId → null, no gateway call', async () => {
    await expect(runPortfolioAnalysis(null)).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('PortfolioAnalysisService — pure helpers', () => {
  it('enrichCampaigns drops zero-spend rows and sorts by spend desc', () => {
    const rows = enrichCampaigns([awareness, { entityId: 'z', spendMinor: 0 }, conversionNoRevenue], {});
    expect(rows.map((r) => r.entityId)).toEqual(['c1', 'c2']); // 1.4M > 0.5M; zero-spend gone
  });

  it('enrichCampaigns carries the deterministic verdict through', () => {
    const rows = enrichCampaigns([conversionNoRevenue], { c1: { verdict: 'KILL' } });
    expect(rows[0].verdict).toBe('KILL');
    expect(rows[0].needsRevenue).toBe(true);
  });

  it('countVerdicts counts only real verdicts (an unscored campaign adds nothing)', () => {
    expect(countVerdicts([{ verdict: 'KILL' }, { verdict: 'KILL' }, { verdict: 'SCALE' }, { verdict: null }]))
      .toEqual({ KILL: 2, SCALE: 1 });
  });
});
