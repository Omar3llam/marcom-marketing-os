// ============================================================
// TEST_NEW_ANGLE — the whole plan executes
// ------------------------------------------------------------
// The unit fix lives in captionExecutor's capability map, but the bug was only
// ever visible from here: recommendationMappings turns a TEST_NEW_ANGLE
// recommendation into a two-node plan
//
//   GENERATE_AUDIENCE_HYPOTHESES → GENERATE_ANGLE_VARIANTS
//
// and NodeExecutorRegistry routes the second node to captionExecutor. With the
// capability resolving to undefined, node 1 succeeded and node 2 failed the
// unknown-nodeType guard on all three orchestrator retries — every time anyone
// ran "test a new angle".
//
// Nothing here mocks the planner, the registry or the graph: only the AI
// gateway is stubbed, so the plan → executor → capability chain is real.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.hoisted(() => vi.fn());

vi.mock('../ai-gateway/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execute };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeExecutionPlan } from './RuntimeOrchestrator.js';
import { buildExecutionPlan, NODE_TYPE } from '../execution-planner/index.js';
import { REC_TYPE, PRIORITY } from '../recommendation-engine/index.js';
import { CAPABILITY } from '../ai-gateway/providerTypes.js';

// Each capability's real output shape, so the executors parse rather than
// pass an empty object through.
const OUTPUT_BY_CAPABILITY = {
  [CAPABILITY.GENERATE_AUDIENCE]: {
    hypotheses: [{ audience: 'Urban 25-34', rationale: 'Highest CTR cohort' }],
    count: 1,
  },
  [CAPABILITY.GENERATE_STRATEGY]: {
    angles: [{ angle: 'Price-led', rationale: 'Cheapest in category' }],
    count: 1,
  },
};

const plan = () =>
  buildExecutionPlan({
    diagnosis: 'AUDIENCE_MISMATCH',
    recommendations: [{ type: REC_TYPE.TEST_NEW_ANGLE, priority: PRIORITY.MEDIUM, rationale: 'Test angle' }],
  });

const node = (result, type) => result.executedNodes.find((n) => n.nodeType === type);

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockImplementation(async ({ capability }) => ({
    success: true,
    output: OUTPUT_BY_CAPABILITY[capability] ?? {},
    artifacts: [],
    metadata: { provider: 'CLAUDE', model: 'claude-sonnet-4-5', tokens: 30, latency: 5 },
  }));
});

describe('the plan the recommendation actually produces', () => {
  it('is the two-node angle chain', () => {
    const p = plan();
    expect(p.graph.nodes).toEqual([
      NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES,
      NODE_TYPE.GENERATE_ANGLE_VARIANTS,
    ]);
  });
});

describe('executing it', () => {
  it('BOTH nodes succeed', async () => {
    const result = await executeExecutionPlan(plan(), { workspaceId: 'ws-1' });

    expect(node(result, NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES).status).toBe('SUCCESS');
    expect(node(result, NODE_TYPE.GENERATE_ANGLE_VARIANTS).status).toBe('SUCCESS');
  });

  // The exact string the bug produced.
  it('the second node no longer reports "Unknown nodeType"', async () => {
    const result = await executeExecutionPlan(plan(), {});

    const angle = node(result, NODE_TYPE.GENERATE_ANGLE_VARIANTS);
    expect(JSON.stringify(angle.output)).not.toMatch(/Unknown nodeType/);
  });

  it('reaches the gateway once per node, with the right capability each time', async () => {
    await executeExecutionPlan(plan(), {});

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([a]) => a.capability)).toEqual([
      CAPABILITY.GENERATE_AUDIENCE,
      CAPABILITY.GENERATE_STRATEGY,
    ]);
  });

  // A failing node burned all three orchestrator retries before giving up.
  it('the angle node succeeds on the first attempt — no retry storm', async () => {
    const result = await executeExecutionPlan(plan(), {});
    expect(node(result, NODE_TYPE.GENERATE_ANGLE_VARIANTS).attempts).toBe(1);
  });

  it('returns the angles the provider produced', async () => {
    const result = await executeExecutionPlan(plan(), {});

    const angle = node(result, NODE_TYPE.GENERATE_ANGLE_VARIANTS);
    expect(Array.isArray(angle.output.angles)).toBe(true);
    expect(angle.output.angles[0].angle).toBe('Price-led');
  });

  it('nothing is skipped for a failed dependency', async () => {
    const result = await executeExecutionPlan(plan(), {});
    expect(result.executedNodes.map((n) => n.status)).not.toContain('SKIPPED');
  });
});
