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
  // R8 / I29 — the verdict computation itself failing, as distinct from an
  // account that legitimately has no verdicts.
  verdictsThrow: false,
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
vi.mock('../verdict-engine/index.js', async () => {
  // Reuse the REAL needsRevenueData so the test exercises the true objective
  // taxonomy (an awareness campaign must never be told it needs revenue).
  const real = await vi.importActual('../verdict-engine/connectorVerdictService.js');
  return {
    // R13-D / B2 — the campaigns now ride on the ONE canonical evaluation (R8),
    // so the rows narrated and the rows judged are the same set.
    evaluateConnectorVerdicts: vi.fn(async () => ({
      workspaceId: 'ws-1', campaigns: h.campaigns, gatedOut: [], status: 'OK',
    })),
    getConnectorVerdicts: vi.fn(async () => {
      if (h.verdictsThrow) throw new Error('canonical read timed out');
      return { verdicts: h.verdicts };
    }),
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
import { getConnectorVerdicts } from '../verdict-engine/index.js';

// A conversion campaign that spent but measured no revenue → needs revenue.
const conversionNoRevenue = {
  entityId: 'c1', name: 'Ramadan Cold', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 1_416_000, revenueMinor: 0, impressions: 90_000, clicks: 900, ctr: 0.01, frequency: 4.2, currency: 'EGP',
};
// A genuine awareness campaign with no revenue → does NOT need revenue.
const awareness = {
  entityId: 'c2', name: 'Brand Reach', channel: 'META', objective: 'OUTCOME_AWARENESS',
  spendMinor: 500_000, revenueMinor: 0, impressions: 200_000, clicks: 1000, ctr: 0.005, frequency: 2.1, currency: 'EGP',
};
// A measured conversion campaign → scoreable, no gap.
const measured = {
  entityId: 'c3', name: 'PMax Warm', channel: 'GOOGLE', objective: 'OUTCOME_SALES',
  spendMinor: 200_000, revenueMinor: 960_000, roas: 4.8, impressions: 40_000, clicks: 800, ctr: 0.02, frequency: 1.4, currency: 'EGP',
};

beforeEach(() => {
  h.campaigns = [conversionNoRevenue, awareness, measured];
  h.verdicts = [{ id: 'c1', verdict: 'KILL' }, { id: 'c3', verdict: 'SCALE' }];
  h.gatewayResult = { success: true, output: { insight: 'Portfolio is stable.' } };
  h.gatewayThrows = false;
  h.verdictsThrow = false;
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

  it.each([
    ['mixed', [{ ...conversionNoRevenue, currency: 'EGP' }, { ...awareness, currency: 'USD' }]],
    ['unknown', [{ ...conversionNoRevenue, currency: 'EGP' }, { ...awareness, currency: null }]],
  ])('enrichCampaigns omits the spend-ranked slice for %s currency', (_label, rows) => {
    expect(enrichCampaigns(rows, {})).toEqual([]);
  });

  it.each(['EGP', 'USD', 'SAR'])('preserves spend ranking for homogeneous %s', (currency) => {
    const rows = enrichCampaigns([
      { ...awareness, currency }, { ...conversionNoRevenue, currency },
    ], {});
    expect(rows.map((r) => r.entityId)).toEqual(['c1', 'c2']);
  });
});

describe('PortfolioAnalysisService — mixed-currency AI grounding', () => {
  it('omits campaign detail while preserving verdict counts and the revenue tracking gap', async () => {
    h.campaigns = [
      { ...conversionNoRevenue, currency: 'EGP' },
      { ...measured, currency: 'USD' },
    ];
    h.verdicts = [{ id: 'c1', verdict: 'KILL' }, { id: 'c3', verdict: 'SCALE' }];

    const out = await runPortfolioAnalysis('ws1');
    expect(out.revenueNeeded).toEqual([{ entityId: 'c1', name: 'Ramadan Cold' }]);
    const prompt = execute.mock.calls[0][0].input.user;
    expect(prompt).toContain('currency population is MIXED');
    expect(prompt).toContain('KILL 1');
    expect(prompt).toContain('SCALE 1');
    expect(prompt).toContain('Campaigns whose ROAS cannot be scored (no revenue measured): 1');
    expect(prompt).not.toContain('"Ramadan Cold"');
    expect(prompt).not.toContain('"PMax Warm"');
  });
});

// ============================================================
// R8 / I29 — a verdict OUTAGE narrates nothing, rather than narrating calm
// ------------------------------------------------------------
// This service used to `.catch(() => ({ verdicts: [] }))` around its verdict
// read. Its whole job is to narrate the deterministic verdicts, so an empty set
// produced a prompt describing a portfolio with no KILLs, no SCALEs and nothing
// to act on — a confident all-clear written over an outage, then stored on the
// LoopRun as the Overview's AI Insight.
// ============================================================
describe('R8 · verdicts unavailable', () => {
  it('narrates NOTHING when the verdicts could not be computed', async () => {
    h.verdictsThrow = true;
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });

    expect(out).toBeNull();                    // the contract's "nothing honest to say"
    expect(execute).not.toHaveBeenCalled();    // the model is never asked
    expect(loopRunUpdate).not.toHaveBeenCalled(); // and no insight is stored
  });

  it('still fails its caller SOFTLY — a sweep is never brought down by this', async () => {
    h.verdictsThrow = true;
    await expect(runPortfolioAnalysis('ws1', { loopRunId: 'run1' })).resolves.toBeNull();
  });

  it('an account that genuinely has NO verdicts is still narrated — the two differ', async () => {
    // Verdicts computed fine and came back empty. Real campaigns with real spend
    // remain worth describing; only the failure case is silent.
    h.verdicts = [];
    const out = await runPortfolioAnalysis('ws1', { loopRunId: 'run1' });
    expect(out?.insight).toBe('Portfolio is stable.');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('CONSUMES the sweep evaluation rather than computing its own', async () => {
    const evaluation = { workspaceId: 'ws1', annotated: null, gatedOut: [], campaigns: [], tree: null, status: 'OK' };
    await runPortfolioAnalysis('ws1', { loopRunId: 'run1', evaluation });
    const [, opts] = getConnectorVerdicts.mock.calls[0];
    expect(opts).toEqual({ evaluation });
  });
});
