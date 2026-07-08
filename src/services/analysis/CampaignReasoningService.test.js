// ============================================================
// CampaignReasoningService — server-side signal rebuild + gateway call
// ------------------------------------------------------------
// Asserts: unknown campaign → NOT_FOUND (workspace isolation); the gateway input
// is re-derived from SERVER data (verdict/rationale/ctr%/spend-share/impact), not
// trusted from the caller; AI failure → AI_FAILED; success → reasoning. Uses the
// REAL computeAccountHealth; mocks the DB-backed readers + the gateway.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConnectorCampaigns } = vi.hoisted(() => ({ getConnectorCampaigns: vi.fn() }));
const { getConnectorVerdicts } = vi.hoisted(() => ({ getConnectorVerdicts: vi.fn() }));
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../entity-graph/index.js', () => ({ getConnectorCampaigns }));
vi.mock('../verdict-engine/index.js', () => ({ getConnectorVerdicts }));
vi.mock('../ai-gateway/index.js', () => ({ execute, CAPABILITY: { EXPLAIN_VERDICT: 'EXPLAIN_VERDICT' } }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { workspace: { findUnique: vi.fn().mockResolvedValue({ objective: 'roas' }) } },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateCampaignReasoning } from './CampaignReasoningService.js';

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
  getConnectorCampaigns.mockResolvedValue(CAMPAIGNS);
  getConnectorVerdicts.mockResolvedValue(VERDICTS);
  execute.mockResolvedValue({ success: true, output: { reasoning: 'Frequency is too high; refresh the creative.' } });
});

describe('generateCampaignReasoning', () => {
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
});
