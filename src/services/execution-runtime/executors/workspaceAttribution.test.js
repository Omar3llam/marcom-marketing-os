// ============================================================
// Executors — workspaceId reaches the AI gateway
// ------------------------------------------------------------
// `execute({ workspaceId })` is optional by contract, so omitting it failed
// silently: every execution-runtime AI call (copy, caption, visual brief) hit
// the gateway unattributed, while the three route/service call sites passed it.
// The data was already there — RuntimeOrchestrator hands the SAME `context`
// object to every executor and gates artifact storage on context.workspaceId —
// the executors just never forwarded it.
//
// Unattributed spend is not a cosmetic gap: costs that cannot be assigned to a
// workspace either vanish from a per-workspace total or get spread across
// workspaces that did not incur them. Both are fabrications.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.hoisted(() => vi.fn());

vi.mock('../../ai-gateway/index.js', async (importOriginal) => {
  // CAPABILITY / ERROR_TYPE are real enums the executors map node types against;
  // only `execute` is replaced.
  const actual = await importOriginal();
  return { ...actual, execute };
});
vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeCopyGeneration } from './copyExecutor.js';
import { executeCaptionGeneration } from './captionExecutor.js';
import { executeVisualBrief } from './visualBriefExecutor.js';
import { NODE_TYPE } from '../../execution-planner/index.js';

const ok = (output) => ({
  success: true,
  output,
  artifacts: [],
  metadata: { provider: 'CLAUDE', model: 'claude-sonnet-4-5', tokens: 33, inputTokens: 11, outputTokens: 22, latency: 5 },
});

// Each executor reads a different output shape; give each one something valid
// so the assertions are about attribution, not about downstream parsing.
const OUTPUT = {
  hooks: [{ hook: 'h', rationale: 'r' }],
  captions: [{ caption: 'c', rationale: 'r' }],
  visualBrief: { concept: 'c', composition: 'x', mood: 'm' },
  concept: 'c',
};

// The file names do not match the node types they serve: copyExecutor owns
// BOTH hook and caption variants, while captionExecutor owns audience
// hypotheses and angle variants. Each case below uses a node type its executor
// actually maps — an unmapped one returns early and never calls the gateway,
// which would make these tests pass for the wrong reason.
const CASES = [
  ['copyExecutor', (ctx) => executeCopyGeneration('n1', NODE_TYPE.GENERATE_HOOK_VARIANTS, ctx)],
  ['captionExecutor', (ctx) => executeCaptionGeneration('n1', NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES, ctx)],
  ['visualBriefExecutor', (ctx) => executeVisualBrief('n1', NODE_TYPE.GENERATE_VISUAL_BRIEF, ctx)],
];

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(ok(OUTPUT));
});

describe.each(CASES)('%s — workspace attribution', (_name, run) => {
  it('forwards workspaceId from the orchestrator context', async () => {
    await run({ diagnosis: 'LOW_CTR', workspaceId: 'ws-1' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ workspaceId: 'ws-1' });
  });

  // The gateway treats workspaceId as optional (it drives intelligent routing
  // and the plan-aware override, both of which degrade to the static registry).
  // A context without one must still execute.
  it('passes undefined — never crashes — when the context has no workspaceId', async () => {
    const res = await run({ diagnosis: 'LOW_CTR' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].workspaceId).toBeUndefined();
    expect(res.success).toBe(true);
  });

  // Attribution must never be invented. An empty context is "no workspace",
  // not a default one.
  it('does not substitute a placeholder workspace', async () => {
    await run({ diagnosis: 'LOW_CTR' });

    const arg = execute.mock.calls[0][0];
    expect(arg.workspaceId).not.toBe('');
    expect(arg.workspaceId).not.toBe('unknown');
  });

  // The forward is additive: the PR #32/#33 decision context still travels.
  it('still forwards the decision context alongside it', async () => {
    await run({
      diagnosis: 'LOW_CTR',
      workspaceId: 'ws-1',
      isReExecution: true,
      feedback: { n1: 'tighten the hook' },
      severity: { n1: 'HIGH' },
    });

    expect(execute.mock.calls[0][0]).toMatchObject({
      workspaceId: 'ws-1',
      isReExecution: true,
      feedback: 'tighten the hook',
      severity: 'HIGH',
    });
  });
});
