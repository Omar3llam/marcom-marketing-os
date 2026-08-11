// ============================================================
// contextBuilder — the AI memory boundary is honest about itself
// ------------------------------------------------------------
// This module builds the only per-campaign memory fragment that reaches a
// model. It reads two legacy substrates — CampaignState and the legacy
// DecisionMemory table — whose shared origin (the CSV upload service) was
// deleted with the upload route in PR #164. What survives writes to them
// (temporalObserver → Actions in EXECUTED_SUCCESS) needs an Action producer
// that no longer exists outside the rollback route's closed loop.
//
// The defect that state produced was NOT "the prompt is empty". It was that a
// FAILED READ and a GENUINELY QUIET CAMPAIGN arrived at the model as the same
// sentence: "(no prior decisions on record)". One is a fact about the campaign;
// the other is a fact about us, reported as a fact about the campaign.
//
// These tests pin the three-state contract and, just as importantly, pin that
// the existing prompt is byte-for-byte unchanged when the substrate DOES answer
// — a fix to an honesty bug must not quietly become a prompt rewrite.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const findMany = vi.fn();

const userFindUnique = vi.fn().mockResolvedValue(null);

// ONE prisma mock, shared by both modules under test. The orchestrator block at
// the bottom drives the same two functions the contextBuilder blocks do — which
// is the point: the failure mode being pinned is the same read failing in two
// callers. (Deliberately no vi.resetModules() anywhere in this file: it
// segfaults the forks pool.)
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    campaignState:  { findUnique: (...a) => findUnique(...a) },
    decisionMemory: { findMany:   (...a) => findMany(...a) },
    user:           { findUnique: (...a) => userFindUnique(...a) },
  },
}));

const runClaudeAgent = vi.fn();
vi.mock('./ClaudeAgent.js', () => ({ runClaudeAgent: (...a) => runClaudeAgent(...a) }));
vi.mock('./ChatGPTAgent.js', () => ({ runChatGPTAgent: vi.fn() }));

const { buildCampaignContext, renderContextPrompt, getRenderedContext } =
  await import('./contextBuilder.js');
const { runOrchestration, MEMORY_UNAVAILABLE } = await import('./orchestrator.js');

const STATE = {
  stage: 'SCALING',
  healthScore: 0.72,
  lastAnalysis: new Date('2026-08-01T00:00:00.000Z'),
  workspaceId: 'ws1',
};

const MEMORY_ROW = {
  actionType: 'meta.scale_budget',
  decisionRationale: 'Doubled daily budget after 3 days of >3x ROAS',
  resultStatus: 'sustained_lift',
  deltaCtr: 0.0042,
  deltaRoas: 0.85,
  impactDurationHrs: 24,
  isSustainable: true,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
};

// findMany is given a resolved/rejected value per test; the .catch lives in the
// module under test, so a rejection here is exactly the production failure mode.
const okState = () => findUnique.mockResolvedValue(STATE);

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
});

// ── A. The substrate could not be read ──────────────────────────────────────
describe('A · an unreadable memory substrate is an explicit absence', () => {
  it('a failed memory read yields null, NOT an empty array', async () => {
    okState();
    findMany.mockRejectedValue(new Error('relation "decision_memory" does not exist'));

    const ctx = await buildCampaignContext('c1');

    expect(ctx).not.toBeNull();          // the campaign state still resolved
    expect(ctx.recent).toBeNull();       // ← the whole point: null, not []
    expect(ctx.recent).not.toEqual([]);
  });

  it('the prompt says the history could not be read — it does not claim there is none', async () => {
    okState();
    findMany.mockRejectedValue(new Error('db down'));

    const prompt = await getRenderedContext('c1');

    expect(prompt).toContain('decision memory unavailable');
    // The specific fabrication this fix exists to prevent: asserting to the
    // model that this campaign has no history, on the strength of OUR failure.
    expect(prompt).not.toContain('no prior decisions on record');
  });

  it('invents no decisions, no counts, and no zeroes', async () => {
    okState();
    findMany.mockRejectedValue(new Error('db down'));

    const prompt = await getRenderedContext('c1');

    // No fabricated history rows: the numbered "1. <action> → ..." shape.
    expect(prompt).not.toMatch(/^\s+\d+\.\s/m);
    // No invented deltas or sustain verdicts.
    expect(prompt).not.toMatch(/ΔCTR|ΔROAS/);
    expect(prompt).not.toMatch(/sustained|regressed|pending/);
    // No fabricated tally standing in for absent memory.
    expect(prompt).not.toMatch(/\b0 (prior|previous|recent)\b/i);
  });

  it('a memory failure does not cost the caller the campaign context it CAN have', async () => {
    okState();
    findMany.mockRejectedValue(new Error('db down'));

    const prompt = await getRenderedContext('c1');

    // Stage/health/sweep come from CampaignState and are unaffected — the read
    // that failed was only ever decoration on top of them.
    expect(prompt).toContain('Stage:        SCALING');
    expect(prompt).toContain('Health score: 0.72');
  });

  // The distinction, stated as a single assertion: the two states must not
  // render the same fragment. This is the regression that matters.
  it('an unreadable substrate and a quiet campaign do NOT render the same prompt', async () => {
    okState();
    findMany.mockRejectedValue(new Error('db down'));
    const unavailable = await getRenderedContext('c1');

    okState();
    findMany.mockResolvedValue([]);
    const quiet = await getRenderedContext('c1');

    expect(unavailable).not.toBe(quiet);
  });
});

// ── B. The substrate answered — nothing about the contract may move ─────────
describe('B · a readable substrate renders exactly the prompt it always did', () => {
  it('an empty result still reads "(no prior decisions on record)"', async () => {
    okState();
    findMany.mockResolvedValue([]);

    const prompt = await getRenderedContext('c1');

    // Unchanged: [] IS a fact about the campaign, and stating it is correct.
    expect(prompt).toContain('(no prior decisions on record)');
    expect(prompt).not.toContain('unavailable');
  });

  it('real history renders unchanged, in the established format', async () => {
    okState();
    findMany.mockResolvedValue([MEMORY_ROW]);

    const prompt = await getRenderedContext('c1');

    expect(prompt).toContain('1. meta.scale_budget → sustained (ΔCTR +0.0042, ΔROAS +0.85)');
    expect(prompt).toContain('"Doubled daily budget after 3 days of >3x ROAS"');
    expect(prompt).not.toContain('unavailable');
  });

  // The full fragment, pinned. If the honesty fix had shifted a heading, a
  // label or the section rules, this is what would catch it.
  it('the whole fragment is byte-for-byte the established contract', async () => {
    okState();
    findMany.mockResolvedValue([MEMORY_ROW]);

    expect(await getRenderedContext('c1')).toBe([
      '── CAMPAIGN CONTEXT ──────────────────────────',
      'Stage:        SCALING',
      'Health score: 0.72',
      'Last sweep:   2026-08-01T00:00:00.000Z',
      'Recent decisions (most recent first, capped at 3):',
      '  1. meta.scale_budget → sustained (ΔCTR +0.0042, ΔROAS +0.85) — "Doubled daily budget after 3 days of >3x ROAS"',
      '──────────────────────────────────────────────',
    ].join('\n'));
  });

  it('a null deltaCtr/deltaRoas stays "n/a" — never a fabricated 0', async () => {
    okState();
    findMany.mockResolvedValue([{ ...MEMORY_ROW, deltaCtr: null, deltaRoas: null, isSustainable: null }]);

    const prompt = await getRenderedContext('c1');

    expect(prompt).toContain('(ΔCTR n/a, ΔROAS n/a)');
    expect(prompt).not.toContain('ΔCTR +0.0000');
    expect(prompt).toContain('→ pending'); // unknown sustain ≠ regressed
  });
});

// ── The pre-existing absence, unchanged ─────────────────────────────────────
describe('no CampaignState at all → no fragment, as before', () => {
  it('returns null, and the rendered fragment is empty rather than invented', async () => {
    findUnique.mockResolvedValue(null);
    findMany.mockResolvedValue([]);

    expect(await buildCampaignContext('c1')).toBeNull();
    // An empty string adds nothing to the prompt — the caller's documented
    // fallback. Silence is the honest state; a "CAMPAIGN CONTEXT" heading over
    // no context would be the dishonest one.
    expect(await getRenderedContext('c1')).toBe('');
  });

  it('no campaignId → null without touching the database', async () => {
    expect(await buildCampaignContext(null)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('renderContextPrompt(null) is empty, not a heading with nothing under it', () => {
    expect(renderContextPrompt(null)).toBe('');
  });
});

// ── C. The orchestrator survives the same absence ───────────────────────────
// Same legacy table, second caller. Here the read sat inside a Promise.all, so
// a rejection failed the whole gather and the Claude call never happened — an
// analysis lost to a decoration. Memory colours the diagnosis; CampaignState IS
// the thing being diagnosed, and only the second is a precondition.
describe('C · orchestration is not lost to an unreadable memory table', () => {
  const CLAUDE_JSON = JSON.stringify({
    verdict: 'HOLD', rootCause: 'OTHER', diagnosis: 'Steady.',
    levelVerdicts: [], actionPlan: { action: 'none', expectedImpact: 'none' },
    confidence: 60, riskLevel: 'Low', evidenceCount: 3, financialImpact: 'EGP 0',
  });

  beforeEach(() => {
    runClaudeAgent.mockReset().mockResolvedValue({ text: CLAUDE_JSON });
    userFindUnique.mockReset().mockResolvedValue(null);
  });

  it('still runs the analysis when the memory read rejects', async () => {
    okState();
    findMany.mockRejectedValue(new Error('relation "decision_memory" does not exist'));

    await expect(runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' })).resolves.toBeTruthy();
    expect(runClaudeAgent).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit unavailable marker downstream — never a fabricated []', async () => {
    okState();
    findMany.mockRejectedValue(new Error('db down'));

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });
    const { task } = runClaudeAgent.mock.calls[0][0];

    expect(task).toContain('RECENT DECISION MEMORY:');
    expect(task).toContain(MEMORY_UNAVAILABLE);
    // The coercion this PR removed: `decisionMemory ?? []` put an empty array
    // under a heading the role prompt tells the model to reason from.
    expect(task).not.toMatch(/RECENT DECISION MEMORY:\s*\[\]/);
  });

  it('a genuinely empty memory list still renders [] — unchanged', async () => {
    okState();
    findMany.mockResolvedValue([]);

    await runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' });
    const { task } = runClaudeAgent.mock.calls[0][0];

    expect(task).toMatch(/RECENT DECISION MEMORY:\s*\[\]/);
    expect(task).not.toContain(MEMORY_UNAVAILABLE);
  });

  // The one absence that SHOULD still stop everything. Without a CampaignState
  // there is no campaign to analyse, and continuing would mean inventing one.
  it('a missing CampaignState still throws — that absence is not decoration', async () => {
    findUnique.mockResolvedValue(null);
    findMany.mockResolvedValue([]);

    await expect(runOrchestration({ campaignId: 'c1', workspaceId: 'ws1' }))
      .rejects.toThrow(/campaignState c1 not found/);
    expect(runClaudeAgent).not.toHaveBeenCalled();
  });
});
