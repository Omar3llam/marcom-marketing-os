// ============================================================
// captionExecutor — GENERATE_ANGLE_VARIANTS reaches the gateway
// ------------------------------------------------------------
// The map named CAPABILITY.GENERATE_ANGLE, which is not in the enum, so it
// evaluated to `undefined` and every angle node failed the unknown-nodeType
// guard before the gateway was ever called.
//
// This was live, not dormant: recommendationMappings TEST_NEW_ANGLE builds a
// two-node plan (GENERATE_AUDIENCE_HYPOTHESES → GENERATE_ANGLE_VARIANTS), and
// NodeExecutorRegistry routes the second node here. The first node succeeded
// and the second failed on every such execution.
//
// The fix points it at GENERATE_STRATEGY, which the registry already implements
// AS angle generation (claudeProvider.generateAngleVariants is its method).
// These tests pin that the capability is a real enum member and that the whole
// node path works — not merely that the map changed.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.hoisted(() => vi.fn());

vi.mock('../../ai-gateway/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execute };
});
vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeCaptionGeneration } from './captionExecutor.js';
import { NODE_TYPE } from '../../execution-planner/index.js';
import { CAPABILITY } from '../../ai-gateway/providerTypes.js';
import { getProviderForCapability, getMethodForProvider } from '../../ai-gateway/providerRegistry.js';
import { CAPABILITY_FALLBACK, PROVIDER } from '../../ai-gateway/providerTypes.js';

// The shape BOTH providers return for angle generation.
const ANGLES = [
  { angle: 'Price-led', rationale: 'Cheapest in category' },
  { angle: 'Status-led', rationale: 'Aspirational buyer' },
];

const ok = () => ({
  success: true,
  output: { angles: ANGLES, count: ANGLES.length },
  artifacts: ANGLES.map((a, i) => ({ type: 'angle', id: `angle_${i}`, content: a.angle })),
  metadata: { provider: 'CLAUDE', model: 'claude-sonnet-4-5', tokens: 33, latency: 5 },
});

const runAngle = (ctx = {}) =>
  executeCaptionGeneration('n1', NODE_TYPE.GENERATE_ANGLE_VARIANTS, { diagnosis: 'LOW_CTR', ...ctx });

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(ok());
});

describe('the capability it resolves to', () => {
  // The bug in one assertion: the old value was not an enum member at all.
  it('GENERATE_STRATEGY is a real CAPABILITY, and GENERATE_ANGLE never was', () => {
    expect(CAPABILITY.GENERATE_STRATEGY).toBe('GENERATE_STRATEGY');
    expect(CAPABILITY.GENERATE_ANGLE).toBeUndefined();
  });

  it('an angle node calls the gateway with GENERATE_STRATEGY', async () => {
    await runAngle();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].capability).toBe(CAPABILITY.GENERATE_STRATEGY);
  });

  // The precise regression: an undefined capability made the executor return
  // before any gateway call.
  it('does not return early on an unknown nodeType', async () => {
    const res = await runAngle();

    expect(res.success).toBe(true);
    expect(res.output?.error).toBeUndefined();
    expect(execute).toHaveBeenCalled();
  });

  it('an audience node is untouched by the change', async () => {
    await executeCaptionGeneration('n1', NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES, { diagnosis: 'LOW_CTR' });
    expect(execute.mock.calls[0][0].capability).toBe(CAPABILITY.GENERATE_AUDIENCE);
  });

  // A genuinely unmapped node type must still be rejected — the guard is
  // correct, it was the map that was wrong.
  it('still rejects a node type it does not own', async () => {
    const res = await executeCaptionGeneration('n1', NODE_TYPE.CALCULATE_OPTIMAL_BUDGET, {});

    expect(res.success).toBe(false);
    expect(res.output.error).toMatch(/Unknown nodeType/);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('GENERATE_STRATEGY is fully wired — no new registry entries needed', () => {
  // The reason this is a one-line fix and not a new enum value.
  it('resolves to a primary provider and method', () => {
    const reg = getProviderForCapability(CAPABILITY.GENERATE_STRATEGY);
    expect(reg.provider).toBe(PROVIDER.CLAUDE);
    expect(typeof reg.method).toBe('function');
  });

  it('has a cross-provider fallback that is actually implemented', () => {
    const fallback = CAPABILITY_FALLBACK[CAPABILITY.GENERATE_STRATEGY];
    expect(fallback).toBe(PROVIDER.OPENAI);
    expect(typeof getMethodForProvider(fallback, CAPABILITY.GENERATE_STRATEGY)?.method).toBe('function');
  });
});

describe('the output survives the executor', () => {
  // Both providers parse angles as an ARRAY and reject anything else with
  // INVALID_RESPONSE, so the executor must not reshape it.
  it('passes the angles array through untouched', async () => {
    const res = await runAngle();

    expect(Array.isArray(res.output.angles)).toBe(true);
    expect(res.output.angles).toEqual(ANGLES);
    expect(res.output.count).toBe(2);
  });

  it('forwards the angle artifacts with a version', async () => {
    const res = await runAngle();

    expect(res.artifacts).toHaveLength(2);
    expect(res.artifacts[0]).toMatchObject({ type: 'angle', content: 'Price-led', version: 1 });
  });

  it('reports the capability it used in its metadata', async () => {
    const res = await runAngle();
    expect(res.metadata.capability).toBe(CAPABILITY.GENERATE_STRATEGY);
  });

  it('surfaces a provider failure instead of pretending it succeeded', async () => {
    execute.mockResolvedValue({
      success: false,
      error: { type: 'INVALID_RESPONSE', message: 'Failed to parse angle variants response' },
      metadata: {},
    });

    const res = await runAngle();
    expect(res.success).toBe(false);
    expect(res.output.error).toMatch(/angle variants/);
  });

  it('still forwards workspaceId for cost attribution', async () => {
    await runAngle({ workspaceId: 'ws-1' });
    expect(execute.mock.calls[0][0].workspaceId).toBe('ws-1');
  });
});
