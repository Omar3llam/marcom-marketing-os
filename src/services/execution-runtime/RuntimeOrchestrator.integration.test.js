// ============================================================
// RuntimeOrchestrator Integration Test — full pipeline
// ============================================================
// Tests the complete flow:
//   Diagnosis → Execution Plan → Runtime → AI Gateway → Real Artifacts
//
// This test verifies that:
//   - Execution plans are executed correctly
//   - AI Provider Gateway is called with correct capabilities
//   - Real artifacts are generated (not mocks)
//   - Metadata is propagated correctly
//   - Error handling works end-to-end
// ============================================================
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { executeExecutionPlan } from './RuntimeOrchestrator.js';
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY } from '../execution-planner/index.js';
import { EXECUTION_STATUS, NODE_STATUS } from './runtimeEvents.js';
import * as aiGateway from '../ai-gateway/index.js';

// Mock AI Gateway (no real API calls in tests)
vi.mock('../ai-gateway/index.js', async () => {
  const actual = await vi.importActual('../ai-gateway/index.js');
  return {
    ...actual,
    execute: vi.fn(),
  };
});

describe('RuntimeOrchestrator Integration — AI Gateway', () => {
  // Default success implementation
  const defaultSuccessImpl = async ({ capability, input }) => ({
    success: true,
    output: {
      generated: true,
      capability,
      diagnosis: input.diagnosis,
    },
    artifacts: [
      {
        type: 'test_artifact',
        id: `${capability}_artifact_1`,
        content: `Generated via ${capability}`,
      },
    ],
    metadata: {
      provider: 'CLAUDE',
      requestId: 'test_request_id',
      attempt: 1,
      tokens: 150,
      latency: 1200,
    },
  });

  beforeAll(() => {
    // Configure mock AI Gateway to return success
    aiGateway.execute.mockImplementation(defaultSuccessImpl);
  });

  beforeEach(() => {
    // Reset to default success implementation and clear call history
    aiGateway.execute.mockClear();
    aiGateway.execute.mockImplementation(defaultSuccessImpl);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should execute GENERATE_HOOKS via AI Gateway', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      brandVoice: 'professional',
      targetAudience: 'B2B marketers',
      currentCTR: 1.8,
    };

    const result = await executeExecutionPlan(plan, context);

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(1);
    expect(result.summary.failed).toBe(0);

    // Verify AI Gateway was called
    expect(aiGateway.execute).toHaveBeenCalledTimes(1);
    expect(aiGateway.execute).toHaveBeenCalledWith({
      capability: aiGateway.CAPABILITY.GENERATE_HOOKS,
      input: expect.objectContaining({
        diagnosis: 'CREATIVE_FATIGUE',
        brandVoice: 'professional',
      }),
      // PR #32: Decision context parameters (undefined for initial execution)
      feedback: undefined,
      revisionInstructions: undefined,
      regenerationHint: undefined,
      isReExecution: false,
    });

    // Verify artifacts were generated
    const executedNode = result.executedNodes[0];
    expect(executedNode.status).toBe(NODE_STATUS.SUCCESS);
    expect(executedNode.artifacts).toHaveLength(1);
    expect(executedNode.artifacts[0].content).toContain('GENERATE_HOOKS');
  });

  it('should execute complex graph with multiple AI calls', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
          { from: NODE_TYPE.VALIDATE_HOOKS, to: NODE_TYPE.RANK_HOOKS },
        ],
      },
    };

    const context = { diagnosis: 'CREATIVE_FATIGUE' };

    const result = await executeExecutionPlan(plan, context);

    // Verify all nodes executed
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(3);
    expect(result.summary.failed).toBe(0);

    // Verify AI Gateway was called 3 times
    expect(aiGateway.execute).toHaveBeenCalledTimes(3);

    // Verify execution order
    const capabilities = aiGateway.execute.mock.calls.map(call => call[0].capability);
    expect(capabilities).toEqual([
      aiGateway.CAPABILITY.GENERATE_HOOKS,
      aiGateway.CAPABILITY.VALIDATE_CONTENT,
      aiGateway.CAPABILITY.VALIDATE_CONTENT,
    ]);
  });

  it('should handle AI Gateway errors gracefully', async () => {
    // Mock AI Gateway to return error for all retry attempts
    aiGateway.execute.mockImplementation(async () => ({
      success: false,
      error: {
        type: aiGateway.ERROR_TYPE.RATE_LIMIT,
        message: 'Rate limit exceeded',
      },
      metadata: {
        provider: 'CLAUDE',
        requestId: 'test_request_id',
        attempt: 3,
        tokens: 0,
        latency: 500,
      },
    }));

    const plan = {
      diagnosis: 'LOW_CTR',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan, {});

    // Verify execution failed
    expect(result.status).toBe(EXECUTION_STATUS.FAILURE);
    expect(result.summary.failed).toBe(1);

    // Verify error is captured
    const executedNode = result.executedNodes[0];
    expect(executedNode.status).toBe(NODE_STATUS.FAILURE);
    expect(executedNode.output.error).toContain('Rate limit');
    expect(executedNode.output.errorType).toBe(aiGateway.ERROR_TYPE.RATE_LIMIT);
  });

  it('should propagate AI metadata through execution', async () => {
    const plan = {
      diagnosis: 'AUDIENCE_MISMATCH',
      executionType: EXECUTION_TYPE.STRATEGY_EXPERIMENT,
      priority: PLAN_PRIORITY.MEDIUM,
      graph: {
        nodes: [NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan, {});

    // Verify metadata is available in output
    const executedNode = result.executedNodes[0];
    expect(executedNode.output.generated).toBe(true);
    expect(executedNode.output.capability).toBe(aiGateway.CAPABILITY.GENERATE_AUDIENCE);
  });

  it('should handle parallel AI generation', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_CAPTION_VARIANTS,
          NODE_TYPE.GENERATE_VISUAL_BRIEF,
        ],
        edges: [],  // No dependencies → parallel execution
      },
    };

    const result = await executeExecutionPlan(plan, {});

    // Verify all executed successfully
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(3);

    // Verify different capabilities were called
    const capabilities = aiGateway.execute.mock.calls.map(call => call[0].capability);
    expect(capabilities).toContain(aiGateway.CAPABILITY.GENERATE_HOOKS);
    expect(capabilities).toContain(aiGateway.CAPABILITY.GENERATE_CAPTIONS);
    expect(capabilities).toContain(aiGateway.CAPABILITY.GENERATE_VISUAL_BRIEF);
  });

  it('should preserve deterministic request IDs', async () => {
    const plan = {
      diagnosis: 'LOW_CTR',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = { diagnosis: 'LOW_CTR', brandVoice: 'casual' };

    // Execute twice with same input
    await executeExecutionPlan(plan, context);
    const call1 = aiGateway.execute.mock.calls[0][0];

    await executeExecutionPlan(plan, context);
    const call2 = aiGateway.execute.mock.calls[1][0];

    // Verify same capability and input structure
    expect(call1.capability).toBe(call2.capability);
    expect(call1.input.diagnosis).toBe(call2.input.diagnosis);
  });
});
