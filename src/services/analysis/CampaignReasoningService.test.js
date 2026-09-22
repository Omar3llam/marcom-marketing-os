// ============================================================
// CampaignReasoningService — server-side signal rebuild + gateway call + sweep
// ------------------------------------------------------------
// Asserts: the gateway input is re-derived from SERVER data (verdict/rationale/
// ctr%/spend-share/impact), not trusted from the caller; unknown campaign →
// NOT_FOUND (isolation); AI failure → AI_FAILED. And the sweep pre-generation:
// top-N by impact, per-campaign failures never stop the batch, fresh unchanged
// rows are skipped, topN=0 is a kill switch. Uses the REAL computeAccountHealth;
// mocks the DB-backed readers + the gateway.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { evaluateConnectorVerdicts } = vi.hoisted(() => ({ evaluateConnectorVerdicts: vi.fn() }));
const { getConnectorVerdicts } = vi.hoisted(() => ({ getConnectorVerdicts: vi.fn() }));
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

// R13-D / B2: the reasoning context takes its campaigns from the ONE canonical
// evaluation (R8) — the same rows the verdicts it explains were computed from —
// rather than reading the population a second time beside them.
vi.mock('../verdict-engine/index.js', () => ({ getConnectorVerdicts, evaluateConnectorVerdicts }));
vi.mock('../ai-gateway/index.js', () => ({ execute, CAPABILITY: { EXPLAIN_VERDICT: 'EXPLAIN_VERDICT' } }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn().mockResolvedValue({ objective: 'roas' }) },
    campaignReasoning: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prisma.js';
import { generateCampaignReasoning, generateReasoningForSweep, buildReasoningInput } from './CampaignReasoningService.js';

const CAMPAIGNS = [
  { entityId: 'c1', name: 'Eid Sale', channel: 'META', objective: 'OUTCOME_SALES', spendMinor: 80000, ctr: 0.0042, frequency: 4.1, roas: 0.6, currency: 'EGP' },
  { entityId: 'c2', name: 'Reach', channel: 'META', objective: null, spendMinor: 20000, ctr: 0.02, frequency: 1, roas: 3, currency: 'EGP' },
];
const VERDICTS = {
  verdicts: [
    { id: 'c1', verdict: 'KILL', rationale: 'frequency 4.1 exceeds saturation threshold 3.0', spendMinor: 80000, roas: 0.6 },
    { id: 'c2', verdict: 'SCALE', rationale: 'strong ROAS', spendMinor: 20000, roas: 3 },
  ],
  gatedOut: [], account: null, status: 'OK',
};

beforeEach(() => {
  vi.clearAllMocks();
  evaluateConnectorVerdicts.mockResolvedValue({ workspaceId: 'ws-1', campaigns: CAMPAIGNS, gatedOut: [], status: 'OK' });
  getConnectorVerdicts.mockResolvedValue(VERDICTS);
  execute.mockResolvedValue({ success: true, output: { reasoning: 'Frequency is too high; refresh the creative.' } });
  prisma.campaignReasoning.findMany.mockResolvedValue([]);
  prisma.campaignReasoning.upsert.mockResolvedValue({});
});

describe('generateCampaignReasoning (on-demand)', () => {
  it('NO_WORKSPACE when workspaceId is missing', async () => {
    expect(await generateCampaignReasoning({ entityId: 'c1' })).toEqual({ status: 'NO_WORKSPACE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when the campaign is not in this workspace (isolation guard)', async () => {
    const out = await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'not-mine' });
    expect(out).toEqual({ status: 'NOT_FOUND' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rebuilds the gateway input from SERVER data, not the caller', async () => {
    await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'c1', dialect: 'egy' });
    expect(execute).toHaveBeenCalledTimes(1);
    const { capability, input, workspaceId } = execute.mock.calls[0][0];
    expect(capability).toBe('EXPLAIN_VERDICT');
    expect(workspaceId).toBe('ws1');
    expect(input.verdict).toBe('KILL');                    // from the verdict engine
    expect(input.rationale).toContain('frequency 4.1');    // deterministic rationale
    expect(input.ctrPct).toBeCloseTo(0.42, 5);             // 0.0042 fraction → 0.42%
    expect(input.spendSharePct).toBeCloseTo(80, 5);        // 80000 / 100000
    expect(input.impactScore).toBe(10);                    // KILL, dominant share, roas<1
    expect(input.accountObjective).toBe('roas');           // promoted Workspace column
    expect(input.dialect).toBe('egy');                     // the only caller-supplied field
  });

  it('AI_FAILED when the gateway returns unsuccessful', async () => {
    execute.mockResolvedValue({ success: false, error: { message: 'rate limited' } });
    const out = await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'c1' });
    expect(out).toEqual({ status: 'AI_FAILED' });
  });

  it('AI_FAILED when the gateway returns an empty reasoning', async () => {
    execute.mockResolvedValue({ success: true, output: {} });
    const out = await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'c1' });
    expect(out.status).toBe('AI_FAILED');
  });

  it('OK returns the reasoning text on success', async () => {
    const out = await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'c1' });
    expect(out).toEqual({ status: 'OK', reasoning: 'Frequency is too high; refresh the creative.' });
  });

  it.each([
    ['mixed', [{ ...CAMPAIGNS[0], currency: 'EGP' }, { ...CAMPAIGNS[1], currency: 'USD' }]],
    ['unknown', [{ ...CAMPAIGNS[0], currency: 'EGP' }, { ...CAMPAIGNS[1], currency: null }]],
  ])('%s currency withholds spend share and spend-derived impact', async (_label, campaigns) => {
    evaluateConnectorVerdicts.mockResolvedValue({ workspaceId: 'ws-1', campaigns, gatedOut: [], status: 'OK' });
    await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'c1' });
    const input = execute.mock.calls[0][0].input;
    expect(input.spendSharePct).toBeNull();
    expect(input.impactScore).toBeNull();
    // Independent evidence still grounds the explanation.
    expect(input.verdict).toBe('KILL');
    expect(input.ctrPct).toBeCloseTo(0.42, 5);
    expect(input.frequency).toBe(4.1);
  });
});

describe('buildReasoningInput (pure)', () => {
  it('maps server data → prompt input (ctr fraction→%, spend share, verdict, dialect)', () => {
    const input = buildReasoningInput({
      campaign: CAMPAIGNS[0],
      verdictMap: { c1: { verdict: 'KILL', rationale: 'freq' } },
      health: { campaigns: [{ entityId: 'c1', impactScore: 9, verdict: 'KILL' }] },
      accountSpendMinor: 100000,
      accountObjective: 'roas',
      dialect: 'gulf',
    });
    expect(input.verdict).toBe('KILL');
    expect(input.ctrPct).toBeCloseTo(0.42, 5);
    expect(input.spendSharePct).toBeCloseTo(80, 5);
    expect(input.impactScore).toBe(9);
    expect(input.accountObjective).toBe('roas');
    expect(input.dialect).toBe('gulf');
  });

  it('renders missing signals as null (never a fabricated 0), dialect defaults null', () => {
    const input = buildReasoningInput({
      campaign: { entityId: 'x', name: 'X', channel: 'META', ctr: null, frequency: null, roas: null, spendMinor: null },
      verdictMap: {}, health: null, accountSpendMinor: 0,
    });
    expect(input.verdict).toBeNull();
    expect(input.ctrPct).toBeNull();
    expect(input.spendSharePct).toBeNull();
    expect(input.impactScore).toBeNull();
    expect(input.dialect).toBeNull();
  });
});

describe('generateReasoningForSweep (pre-generate + persist)', () => {
  it('generates + upserts reasoning for the top campaigns by impact (highest first)', async () => {
    const out = await generateReasoningForSweep({ workspaceId: 'ws1', loopRunId: 'run-1' });
    expect(out).toEqual({ attempted: 2, generated: 2, skipped: 0 });
    expect(prisma.campaignReasoning.upsert).toHaveBeenCalledTimes(2);

    const first = prisma.campaignReasoning.upsert.mock.calls[0][0];
    expect(first.where.workspaceId_entityId).toEqual({ workspaceId: 'ws1', entityId: 'c1' }); // impact 10
    expect(first.create.verdict).toBe('KILL');
    expect(first.create.sweepId).toBe('run-1');
    expect(first.create.reasoning).toBeTruthy();
  });

  it('English only — the sweep never sends a dialect', async () => {
    await generateReasoningForSweep({ workspaceId: 'ws1' });
    for (const call of execute.mock.calls) expect(call[0].input.dialect).toBeNull();
  });

  it('a per-campaign gateway failure never stops the batch', async () => {
    execute
      .mockResolvedValueOnce({ success: true, output: { reasoning: 'ok' } })       // c1
      .mockResolvedValueOnce({ success: false, error: { type: 'PROVIDER_ERROR' } }); // c2
    const out = await generateReasoningForSweep({ workspaceId: 'ws1' });
    expect(out).toEqual({ attempted: 2, generated: 1, skipped: 0 });
    expect(prisma.campaignReasoning.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips a fresh row on the same verdict (no re-billing an LLM call)', async () => {
    const now = Date.now();
    prisma.campaignReasoning.findMany.mockResolvedValue([
      { entityId: 'c1', verdict: 'KILL', generatedAt: new Date(now) },
    ]);
    const out = await generateReasoningForSweep({ workspaceId: 'ws1', now });
    expect(out).toEqual({ attempted: 2, generated: 1, skipped: 1 });
    expect(execute).toHaveBeenCalledTimes(1); // only the un-skipped campaign
    expect(prisma.campaignReasoning.upsert.mock.calls[0][0].where.workspaceId_entityId.entityId).toBe('c2');
  });

  it('regenerates when the stored verdict no longer matches (freshness ≠ correctness)', async () => {
    const now = Date.now();
    prisma.campaignReasoning.findMany.mockResolvedValue([
      { entityId: 'c1', verdict: 'WATCH', generatedAt: new Date(now) }, // was WATCH, now KILL
    ]);
    const out = await generateReasoningForSweep({ workspaceId: 'ws1', now });
    expect(out).toEqual({ attempted: 2, generated: 2, skipped: 0 });
  });

  it('caps at topN campaigns', async () => {
    const out = await generateReasoningForSweep({ workspaceId: 'ws1', topN: 1 });
    expect(out).toEqual({ attempted: 1, generated: 1, skipped: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('topN <= 0 is a kill switch (no reads, no calls)', async () => {
    const out = await generateReasoningForSweep({ workspaceId: 'ws1', topN: 0 });
    expect(out).toEqual({ attempted: 0, generated: 0, skipped: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('no connector data → no work (honest zero, never fabricated rows)', async () => {
    evaluateConnectorVerdicts.mockResolvedValue({ workspaceId: 'ws-1', campaigns: [], gatedOut: [], status: 'NO_CAMPAIGNS' });
    const out = await generateReasoningForSweep({ workspaceId: 'ws1' });
    expect(out).toEqual({ attempted: 0, generated: 0, skipped: 0 });
    expect(prisma.campaignReasoning.upsert).not.toHaveBeenCalled();
  });

  it('does not invent a top-impact ordering when currencies are mixed', async () => {
    evaluateConnectorVerdicts.mockResolvedValue({
      workspaceId: 'ws-1',
      campaigns: [{ ...CAMPAIGNS[0], currency: 'EGP' }, { ...CAMPAIGNS[1], currency: 'USD' }],
      gatedOut: [],
      status: 'OK',
    });
    const out = await generateReasoningForSweep({ workspaceId: 'ws1' });
    expect(out).toEqual({ attempted: 0, generated: 0, skipped: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('missing workspaceId → no work', async () => {
    expect(await generateReasoningForSweep({})).toEqual({ attempted: 0, generated: 0, skipped: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});

// ============================================================
// R8 — the sweep's reasoning explains the sweep's verdicts
// ------------------------------------------------------------
// This service used to compute its own verdicts, moments after the sweep had
// persisted a set of its own. Two reads, two instants: the prose under "Lumi's
// Read" could describe a verdict the stored Decision no longer held, and the
// drill-down would then explain a call the agenda was not making.
// ============================================================
describe('R8 · reasoning consumes the sweep evaluation', () => {
  it('threads the evaluation through instead of computing its own', async () => {
    const evaluation = { workspaceId: 'ws1', annotated: null, tree: null, campaigns: [], gatedOut: [], status: 'OK' };
    await generateReasoningForSweep({ workspaceId: 'ws1', loopRunId: 'run1', evaluation });
    const [, opts] = getConnectorVerdicts.mock.calls[0];
    expect(opts).toEqual({ evaluation });
  });

  it('the ON-DEMAND entry point makes ONE evaluation and threads it', async () => {
    // R13-D / B2 moved who OWNS that single evaluation, not how many there are.
    // This service now needs the canonical CAMPAIGNS as well as the verdicts,
    // and both come off one evaluation — so it creates it explicitly and hands
    // it on, where before it let getConnectorVerdicts make one internally.
    //
    // Stricter than the assertion it replaces: identity is checked, so a second
    // evaluation created for the verdict call would fail here even though the
    // call counts still looked right.
    await generateCampaignReasoning({ workspaceId: 'ws1', entityId: 'c1' });

    expect(evaluateConnectorVerdicts).toHaveBeenCalledTimes(1);
    expect(getConnectorVerdicts).toHaveBeenCalledTimes(1);
    const [, opts] = getConnectorVerdicts.mock.calls[0];
    expect(opts.evaluation).toBe(await evaluateConnectorVerdicts.mock.results[0].value);
  });
});
