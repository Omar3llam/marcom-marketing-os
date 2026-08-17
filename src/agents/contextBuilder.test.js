// ============================================================
// R7 — the AI memory boundary reads the canonical spine, or says nothing
// ------------------------------------------------------------
// Two modules put "what Lumi decided before" in front of a model, and both used
// to read the legacy DecisionMemory table. R7 moved one and removed the other,
// for the same underlying reason: the table had two incompatible field shapes
// and the readers were written against the one that does not exist.
//
//   orchestrator     workspace-scoped read → REPOINTED to Decision.
//                    The query was valid, so it genuinely returned rows.
//   contextBuilder   campaign-scoped read → REMOVED.
//                    It projected columns the table does not have, so it could
//                    only ever reject; the honest-null branch was the only
//                    branch that ever ran, on every campaign, for months.
//
// What this file pins:
//   • the orchestrator still distinguishes "no decisions" from "could not read"
//   • its prompt payload did not widen when the source got richer
//   • its read is WORKSPACE-scoped — the identity trap that would silently
//     return nothing if someone entity-scoped it
//   • contextBuilder renders campaign state and makes no memory claim at all
//
// (Deliberately no vi.resetModules() anywhere in this file: it segfaults the
// forks pool.)
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const decisionFindMany = vi.fn();
const userFindUnique = vi.fn().mockResolvedValue(null);

// ONE prisma mock, shared by both modules under test. `decision` — not
// `decisionMemory`: if the orchestrator ever reaches for the retired table
// again, the property is simply absent and the call throws.
//
// R9 — campaignState exposes findFirst ONLY. Both readers used to call
// findUnique({ where: { campaignId } }), which real Prisma rejects (campaignId
// is not a unique selector on its own) — the mock accepted it and hid that.
// Omitting findUnique means any regression to the invalid, workspace-blind call
// throws here instead of passing.
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    campaignState: { findFirst: (...a) => findFirst(...a) },
    decision:      { findMany:  (...a) => decisionFindMany(...a) },
    user:          { findUnique: (...a) => userFindUnique(...a) },
  },
}));

const runClaudeAgent = vi.fn();
vi.mock('./ClaudeAgent.js', () => ({ runClaudeAgent: (...a) => runClaudeAgent(...a) }));
vi.mock('./ChatGPTAgent.js', () => ({ runChatGPTAgent: vi.fn() }));

const { buildCampaignContext, renderContextPrompt, getRenderedContext } =
  await import('./contextBuilder.js');
const { runOrchestration, MEMORY_UNAVAILABLE, promptDecisions } = await import('./orchestrator.js');

const STATE = {
  stage: 'SCALING',
  healthScore: 0.72,
  lastAnalysis: new Date('2026-08-01T00:00:00.000Z'),
  workspaceId: 'ws1',
};

/** A canonical Decision row, as RECENT_DECISION_SELECT returns one. */
const DECISION = {
  id: 'dec-1',
  entityId: '11111111-1111-1111-1111-111111111111',
  entityLevel: 'CAMPAIGN',
  verdict: 'SCALE',
  status: 'PROPOSED',
  diagnosis: 'ROAS held above target for three days.',
  rootCause: 'HIGH_ROAS',
  confidence: 0.82,
  resolution: null,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
};

const okState = () => findFirst.mockResolvedValue(STATE);

beforeEach(() => {
  findFirst.mockReset();
  decisionFindMany.mockReset();
});

// ── A. contextBuilder makes no memory claim ─────────────────────────────────

describe('A · contextBuilder states campaign state, and nothing about history', () => {
  it('builds context without reading any decision source', async () => {
    okState();
    const ctx = await buildCampaignContext('c1', 'ws1');

    expect(ctx).toEqual({ state: STATE });
    // The removed read is the point: it must not have been quietly repointed to
    // the canonical table either. This module cannot reach Decision honestly —
    // it keys on a legacy String id, and Decision.entityId is a uuid.
    expect(decisionFindMany).not.toHaveBeenCalled();
  });

  it('the fragment carries no "Recent decisions" section at all', async () => {
    okState();
    const fragment = await getRenderedContext('c1', 'ws1');

    expect(fragment).toContain('Stage:        SCALING');
    expect(fragment).toContain('Health score: 0.72');
    expect(fragment).not.toContain('Recent decisions');
    // Nor the sentence it used to emit on literally every call.
    expect(fragment).not.toContain('decision memory unavailable');
    expect(fragment).not.toContain('no prior decisions on record');
  });

  it('invents no decisions, no counts and no zeroes', async () => {
    okState();
    const fragment = await getRenderedContext('c1', 'ws1');
    expect(fragment).not.toMatch(/\b0 (prior|previous|recent)\b/i);
    expect(fragment).not.toMatch(/\bnone\b/i);
  });

  it('no CampaignState → null, and an empty fragment rather than a heading', async () => {
    findFirst.mockResolvedValue(null);
    expect(await buildCampaignContext('c1', 'ws1')).toBeNull();
    expect(await getRenderedContext('c1', 'ws1')).toBe('');
  });

  it('no campaignId → null without touching the database', async () => {
    expect(await buildCampaignContext(null)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  // ── R9 · the read is workspace-scoped ────────────────────────────────────
  it('scopes the CampaignState read to the workspace, not to campaignId alone', async () => {
    okState();
    await buildCampaignContext('c1', 'ws1');

    expect(findFirst).toHaveBeenCalledTimes(1);
    const { where } = findFirst.mock.calls[0][0];
    // BOTH halves of @@unique([campaignId, workspaceId]). campaignId is a
    // platform-supplied String, so it is not globally unique: two workspaces
    // running the same ad account share it.
    expect(where).toEqual({ campaignId: 'c1', workspaceId: 'ws1' });
  });

  it('no workspaceId → null without touching the database (never a global lookup)', async () => {
    // Fails closed. Prisma reads an absent `where` field as "no filter", so
    // passing it through would have restored exactly the workspace-blind read
    // this change removes — the lookup must not happen at all.
    expect(await buildCampaignContext('c1')).toBeNull();
    expect(await buildCampaignContext('c1', undefined)).toBeNull();
    expect(await getRenderedContext('c1')).toBe('');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('renderContextPrompt(null) is empty, not a heading with nothing under it', () => {
    expect(renderContextPrompt(null)).toBe('');
  });
});

// ── B. the prompt projection ────────────────────────────────────────────────

describe('B · promptDecisions narrows the canonical row to what a model uses', () => {
  it('drops the fields that exist only for the sidebar', () => {
    const [row] = promptDecisions([DECISION]);
    expect(Object.keys(row).sort())
      .toEqual(['confidence', 'decidedAt', 'diagnosis', 'resolution', 'rootCause', 'verdict']);
    // Identity columns are for the surface that renders links, not for a model.
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('entityId');
    expect(row).not.toHaveProperty('entityLevel');
  });

  it('states the engine\'s own verdict and reasoning verbatim', () => {
    const [row] = promptDecisions([DECISION]);
    expect(row.verdict).toBe('SCALE');
    expect(row.diagnosis).toBe('ROAS held above target for three days.');
    expect(row.rootCause).toBe('HIGH_ROAS');
    expect(row.decidedAt).toBe(DECISION.createdAt);
  });

  it('an unresolved decision stays unresolved — never a neutral-looking value', () => {
    expect(promptDecisions([DECISION])[0].resolution).toBeNull();
    expect(promptDecisions([{ ...DECISION, resolution: 'IMPROVED' }])[0].resolution).toBe('IMPROVED');
  });

  it('null in → null out, so the caller\'s "could not read" sentinel survives', () => {
    expect(promptDecisions(null)).toBeNull();
    expect(promptDecisions(undefined)).toBeNull();
    expect(promptDecisions([])).toEqual([]);
  });
});

// ── C. orchestration ────────────────────────────────────────────────────────

describe('C · orchestration reads canonical decisions, and stays honest about failure', () => {
  const CLAUDE_JSON = JSON.stringify({
    verdict: 'HOLD', rootCause: 'OTHER', diagnosis: 'Steady.',
    levelVerdicts: [], actionPlan: { action: 'none', expectedImpact: 'none' },
    confidence: 60, riskLevel: 'Low', evidenceCount: 3, financialImpact: 'EGP 0',
  });

  beforeEach(() => {
    runClaudeAgent.mockReset().mockResolvedValue({ text: CLAUDE_JSON });
    userFindUnique.mockReset().mockResolvedValue(null);
  });

  it('reads the DECISION table, scoped to the workspace', async () => {
    okState();
    decisionFindMany.mockResolvedValue([DECISION]);

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });

    expect(decisionFindMany).toHaveBeenCalledTimes(1);
    const args = decisionFindMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe('ws1');
    // THE IDENTITY TRAP. campaignId is a legacy String; Decision.entityId is a
    // uuid. Filtering one by the other returns nothing, silently — so this read
    // must not carry an entity predicate at all.
    expect(args.where).not.toHaveProperty('entityId');
    expect(JSON.stringify(args.where)).not.toContain('c1');
  });

  // ── R9 · the orchestrator's own CampaignState read ───────────────────────
  it('reads CampaignState scoped to the workspace, via a valid selector', async () => {
    okState();
    decisionFindMany.mockResolvedValue([]);

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).toEqual({ campaignId: 'c1', workspaceId: 'ws1' });
  });

  it('refuses to orchestrate without a workspaceId', async () => {
    // Not cosmetic: `where: { campaignId, workspaceId: undefined }` is a LEGAL
    // Prisma query that silently drops the workspace predicate. Throwing is what
    // keeps the scope from evaporating when a caller forgets it.
    await expect(runOrchestration({ campaignId: 'c1' })).rejects.toThrow(/workspaceId required/);
    expect(findFirst).not.toHaveBeenCalled();
    expect(runClaudeAgent).not.toHaveBeenCalled();
  });

  it('hands the workspace to the agent, so its context block is scoped too', async () => {
    okState();
    decisionFindMany.mockResolvedValue([]);

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });

    expect(runClaudeAgent.mock.calls[0][0].workspaceId).toBe('ws1');
  });

  it('puts the engine\'s real verdicts in the prompt', async () => {
    okState();
    decisionFindMany.mockResolvedValue([DECISION]);

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });
    const { task } = runClaudeAgent.mock.calls[0][0];

    expect(task).toContain('RECENT DECISION MEMORY:');

    // Scope the payload assertions to the memory block. The prompt's own JSON
    // SCHEMA mentions "entityId" (levelVerdicts[].entityId), so asserting over
    // the whole task would fail against the response contract rather than the
    // decision payload — which is what it is actually about.
    const block = task.slice(
      task.indexOf('RECENT DECISION MEMORY:'),
      task.indexOf('BRAND CONTEXT LOCK:'),
    );
    expect(block).toContain('"verdict": "SCALE"');
    expect(block).toContain('"rootCause": "HIGH_ROAS"');
    // …and not the identity columns the canonical read also selects.
    expect(block).not.toContain('"entityId"');
    expect(block).not.toContain('dec-1');
  });

  it('still runs the analysis when the decision read rejects', async () => {
    okState();
    decisionFindMany.mockRejectedValue(new Error('db down'));

    await expect(runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' })).resolves.toBeTruthy();
    expect(runClaudeAgent).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit unavailable marker downstream — never a fabricated []', async () => {
    okState();
    decisionFindMany.mockRejectedValue(new Error('db down'));

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });
    const { task } = runClaudeAgent.mock.calls[0][0];

    expect(task).toContain(MEMORY_UNAVAILABLE);
    // The coercion that must never come back: `?? []` puts an empty array under
    // a heading the role prompt tells the model to reason from — turning our
    // outage into a statement about the account.
    expect(task).not.toMatch(/RECENT DECISION MEMORY:\s*\[\]/);
  });

  it('a genuinely empty history renders [] — a real fact about the workspace', async () => {
    okState();
    decisionFindMany.mockResolvedValue([]);

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });
    const { task } = runClaudeAgent.mock.calls[0][0];

    expect(task).toMatch(/RECENT DECISION MEMORY:\s*\[\]/);
    expect(task).not.toContain(MEMORY_UNAVAILABLE);
  });

  // The one absence that SHOULD still stop everything. Without a CampaignState
  // there is no campaign to analyse, and continuing would mean inventing one.
  it('a missing CampaignState still throws — that absence is not decoration', async () => {
    findFirst.mockResolvedValue(null);
    decisionFindMany.mockResolvedValue([]);

    await expect(runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' }))
      .rejects.toThrow(/campaignState c1 not found/);
    expect(runClaudeAgent).not.toHaveBeenCalled();
  });
});
