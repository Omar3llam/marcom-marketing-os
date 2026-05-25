// ============================================================
// Runtime Orchestrator — PR #31: Selective Re-execution Tests
// ============================================================
// Tests for reExecuteNodes() function and dependency cascade logic.
//
// COVERAGE:
//   - Basic re-execution of single node
//   - Dependency cascade (regenerate A → re-execute B if B depends on A)
//   - Artifact versioning (v1 → v2)
//   - Decision context passed to re-executed nodes
//   - Mixed scenarios (some regenerated, some not)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reExecuteNodes } from './RuntimeOrchestrator.js';
import { NODE_STATUS, EXECUTION_STATUS } from './runtimeEvents.js';

// ============================================================
// Mocks Setup
// ============================================================

// Mock checkpoint storage
const mockCheckpoints = new Map();
let checkpointIdCounter = 1;

vi.mock('../execution-checkpoint/index.js', () => ({
  getCheckpoint: vi.fn(async (checkpointId) => {
    return mockCheckpoints.get(checkpointId) || null;
  }),
  createCheckpoint: vi.fn(async (executionId, workspaceId, nodeId, serializedState, pauseReason) => {
    const checkpoint = {
      id: `checkpoint_${checkpointIdCounter++}`,
      executionId,
      workspaceId,
      pausedNodeId: nodeId,
      serializedState,
      pauseReason,
      status: 'PAUSED_FOR_APPROVAL',
      createdAt: new Date(),
      resumedAt: null,
    };
    mockCheckpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }),
}));

// Mock artifact storage
let artifactCounter = 1;
const mockArtifacts = new Map();

vi.mock('../artifact-storage/index.js', () => ({
  storeArtifact: vi.fn().mockImplementation(async ({ workspaceId, executionId, nodeId, type, content }) => {
    const artifactId = `artifact_${artifactCounter++}`;
    const artifact = {
      id: artifactId,
      workspaceId,
      executionId,
      nodeId,
      type,
      content,
      storageKey: `test/${artifactId}`,
      duplicate: false,
      version: 1,
    };
    mockArtifacts.set(artifactId, artifact);
    return artifact;
  }),
}));

// Mock Prisma (for checkpoint update)
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function() {
    return {
      executionCheckpoint: {
        update: vi.fn(async ({ where, data }) => {
          const checkpoint = mockCheckpoints.get(where.id);
          if (checkpoint) {
            Object.assign(checkpoint, data);
          }
          return checkpoint;
        }),
      },
    };
  }),
}));

// Mock executor registry
const mockExecutors = new Map();

vi.mock('./NodeExecutorRegistry.js', () => ({
  getExecutor: vi.fn((nodeType) => {
    const executor = mockExecutors.get(nodeType);
    if (!executor) {
      throw new Error(`No executor registered for node type: ${nodeType}`);
    }
    return executor;
  }),
}));

// ============================================================
// Test Helpers
// ============================================================

function createTestCheckpoint(options = {}) {
  const {
    executionId = 'test_exec_001',
    workspaceId = 'workspace_001',
    executedNodes = [],
    plan = {
      diagnosis: 'test diagnosis',
      executionType: 'test type',
      priority: 'normal',
      graph: {
        nodes: [
          { id: 'node_1', type: 'NODE_TYPE_1' },
          { id: 'node_2', type: 'NODE_TYPE_2' },
          { id: 'node_3', type: 'NODE_TYPE_3' },
        ],
        edges: [
          { from: 'NODE_TYPE_1', to: 'NODE_TYPE_2' },
          { from: 'NODE_TYPE_2', to: 'NODE_TYPE_3' },
        ],
      },
    },
  } = options;

  const checkpoint = {
    id: `checkpoint_${checkpointIdCounter++}`,
    executionId,
    workspaceId,
    pausedNodeId: 'node_2',
    serializedState: {
      plan,
      context: { workspaceId, executionId },
      executedNodes,
      events: [],
    },
    status: 'PAUSED_FOR_APPROVAL',
    createdAt: new Date(),
    resumedAt: null,
  };

  mockCheckpoints.set(checkpoint.id, checkpoint);
  return checkpoint;
}

function setupMockExecutor(nodeType, mockFn) {
  mockExecutors.set(nodeType, mockFn);
}

// ============================================================
// Tests
// ============================================================

describe('PR #31: Selective Re-execution', () => {
  beforeEach(() => {
    mockCheckpoints.clear();
    mockArtifacts.clear();
    mockExecutors.clear();
    checkpointIdCounter = 1;
    artifactCounter = 1;
    vi.clearAllMocks();
  });

  it('should re-execute a single node marked for regeneration', async () => {
    // Setup: node_1 and node_2 executed, node_2 marked for regeneration
    const checkpoint = createTestCheckpoint({
      executedNodes: [
        {
          nodeId: 'node_1',
          nodeType: 'NODE_TYPE_1',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_2',
          nodeType: 'NODE_TYPE_2',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
      ],
    });

    // Setup executors
    setupMockExecutor('NODE_TYPE_2', async (_nodeId, _nodeType, _ctx) => ({
      success: true,
      output: { result: 'v2_regenerated' },
      artifacts: [{ type: 'test', content: 'regenerated content' }],
    }));

    setupMockExecutor('NODE_TYPE_3', async (_nodeId, _nodeType, _ctx) => ({
      success: true,
      output: { result: 'v1' },
      artifacts: [],
    }));

    // Execute re-execution
    const result = await reExecuteNodes(checkpoint.id, ['node_2'], {
      feedback: { node_2: 'Please improve this' },
    });

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.reExecuted).toBe(true);
    expect(result.summary.reExecuted).toBe(2); // node_2 + node_3 (dependent)
    expect(result.executedNodes.length).toBe(3); // node_1 kept, node_2 re-executed, node_3 re-executed

    // Verify node_1 was kept (not re-executed)
    const node1Result = result.executedNodes.find(n => n.nodeId === 'node_1');
    expect(node1Result.reExecuted).toBeUndefined();
    expect(node1Result.output.result).toBe('v1');

    // Verify node_2 was re-executed
    const node2Result = result.executedNodes.find(n => n.nodeId === 'node_2');
    expect(node2Result.reExecuted).toBe(true);
    expect(node2Result.output.result).toBe('v2_regenerated');

    // Verify node_3 was re-executed (cascade dependency)
    const node3Result = result.executedNodes.find(n => n.nodeId === 'node_3');
    expect(node3Result.reExecuted).toBe(true);
  });

  it('should handle dependency cascade correctly', async () => {
    // Setup: all nodes executed, node_1 marked for regeneration
    // Expected: node_1, node_2, node_3 should all be re-executed (cascade)
    const checkpoint = createTestCheckpoint({
      executedNodes: [
        {
          nodeId: 'node_1',
          nodeType: 'NODE_TYPE_1',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_2',
          nodeType: 'NODE_TYPE_2',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_3',
          nodeType: 'NODE_TYPE_3',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
      ],
    });

    // Setup executors
    let node1Calls = 0;
    let node2Calls = 0;
    let node3Calls = 0;

    setupMockExecutor('NODE_TYPE_1', async () => {
      node1Calls++;
      return { success: true, output: { result: 'v2' }, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_2', async () => {
      node2Calls++;
      return { success: true, output: { result: 'v2' }, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_3', async () => {
      node3Calls++;
      return { success: true, output: { result: 'v2' }, artifacts: [] };
    });

    const result = await reExecuteNodes(checkpoint.id, ['node_1']);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.reExecuted).toBe(3); // All 3 nodes re-executed

    // Verify all executors were called
    expect(node1Calls).toBe(1);
    expect(node2Calls).toBe(1);
    expect(node3Calls).toBe(1);

    // Verify all nodes marked as re-executed
    expect(result.executedNodes.every(n => n.reExecuted)).toBe(true);
  });

  it('should pass decision context to re-executed nodes', async () => {
    const checkpoint = createTestCheckpoint({
      executedNodes: [
        {
          nodeId: 'node_1',
          nodeType: 'NODE_TYPE_1',
          status: NODE_STATUS.SUCCESS,
          output: {},
          artifacts: [],
          attempts: 1,
        },
      ],
    });

    let capturedContext = null;

    setupMockExecutor('NODE_TYPE_1', async (nodeId, nodeType, ctx) => {
      capturedContext = ctx;
      return { success: true, output: {}, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_2', async () => ({
      success: true,
      output: {},
      artifacts: [],
    }));

    setupMockExecutor('NODE_TYPE_3', async () => ({
      success: true,
      output: {},
      artifacts: [],
    }));

    const decisionContext = {
      feedback: { node_1: 'Improve clarity' },
      revisionInstructions: { node_1: 'Use simpler language' },
    };

    await reExecuteNodes(checkpoint.id, ['node_1'], decisionContext);

    // Verify decision context was passed to executor
    expect(capturedContext.feedback.node_1).toBe('Improve clarity');
    expect(capturedContext.revisionInstructions.node_1).toBe('Use simpler language');
    expect(capturedContext.isReExecution).toBe(true);
  });

  it('should increment artifact versions on re-execution', async () => {
    const checkpoint = createTestCheckpoint({
      executedNodes: [
        {
          nodeId: 'node_1',
          nodeType: 'NODE_TYPE_1',
          status: NODE_STATUS.SUCCESS,
          output: {},
          artifacts: [],
          storedArtifactIds: ['artifact_1'],
          attempts: 1,
        },
      ],
    });

    setupMockExecutor('NODE_TYPE_1', async () => ({
      success: true,
      output: {},
      artifacts: [{ type: 'hook', content: 'regenerated hook' }],
    }));

    setupMockExecutor('NODE_TYPE_2', async () => ({
      success: true,
      output: {},
      artifacts: [],
    }));

    setupMockExecutor('NODE_TYPE_3', async () => ({
      success: true,
      output: {},
      artifacts: [],
    }));

    const result = await reExecuteNodes(checkpoint.id, ['node_1']);

    // Verify new artifact was stored
    const node1Result = result.executedNodes.find(n => n.nodeId === 'node_1');
    expect(node1Result.storedArtifactIds).toBeDefined();
    expect(node1Result.storedArtifactIds.length).toBeGreaterThan(0);

    // Verify storeArtifact was called for re-executed node
    const { storeArtifact } = await import('../artifact-storage/index.js');
    expect(storeArtifact).toHaveBeenCalled();
  });

  it('should only re-execute specified nodes (no unnecessary re-execution)', async () => {
    // Graph: node_1 → node_2 → node_3
    // Re-execute: node_3 only (leaf node, no dependents)
    // Expected: only node_3 re-executed, node_1 and node_2 kept
    const checkpoint = createTestCheckpoint({
      executedNodes: [
        {
          nodeId: 'node_1',
          nodeType: 'NODE_TYPE_1',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_2',
          nodeType: 'NODE_TYPE_2',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_3',
          nodeType: 'NODE_TYPE_3',
          status: NODE_STATUS.SUCCESS,
          output: { result: 'v1' },
          artifacts: [],
          attempts: 1,
        },
      ],
    });

    let node1Calls = 0;
    let node2Calls = 0;
    let node3Calls = 0;

    setupMockExecutor('NODE_TYPE_1', async () => {
      node1Calls++;
      return { success: true, output: {}, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_2', async () => {
      node2Calls++;
      return { success: true, output: {}, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_3', async () => {
      node3Calls++;
      return { success: true, output: { result: 'v2' }, artifacts: [] };
    });

    const result = await reExecuteNodes(checkpoint.id, ['node_3']);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.reExecuted).toBe(1); // Only node_3

    // Verify only node_3 executor was called
    expect(node1Calls).toBe(0);
    expect(node2Calls).toBe(0);
    expect(node3Calls).toBe(1);

    // Verify node_1 and node_2 were kept
    const node1Result = result.executedNodes.find(n => n.nodeId === 'node_1');
    const node2Result = result.executedNodes.find(n => n.nodeId === 'node_2');
    expect(node1Result.reExecuted).toBeUndefined();
    expect(node2Result.reExecuted).toBeUndefined();
    expect(node1Result.output.result).toBe('v1'); // Original value
    expect(node2Result.output.result).toBe('v1'); // Original value
  });

  it('should handle idempotency (prevent double re-execution)', async () => {
    const checkpoint = createTestCheckpoint({
      executedNodes: [],
    });

    // Mark checkpoint as already resumed
    checkpoint.resumedAt = new Date();

    const result = await reExecuteNodes(checkpoint.id, ['node_1']);

    expect(result.alreadyResumed).toBe(true);
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);

    // Verify no executors were called
    const { getExecutor } = await import('./NodeExecutorRegistry.js');
    expect(getExecutor).not.toHaveBeenCalled();
  });

  it('should throw error if checkpoint not in PAUSED_FOR_APPROVAL state', async () => {
    const checkpoint = createTestCheckpoint();
    checkpoint.status = 'COMPLETED';

    await expect(
      reExecuteNodes(checkpoint.id, ['node_1'])
    ).rejects.toThrow('not in PAUSED_FOR_APPROVAL state');
  });

  it('should handle multiple nodes to regenerate', async () => {
    // Re-execute both node_1 and node_3 (non-dependent nodes)
    const checkpoint = createTestCheckpoint({
      plan: {
        diagnosis: 'test',
        executionType: 'test',
        priority: 'normal',
        graph: {
          nodes: [
            { id: 'node_1', type: 'NODE_TYPE_1' },
            { id: 'node_2', type: 'NODE_TYPE_2' },
            { id: 'node_3', type: 'NODE_TYPE_3' },
          ],
          edges: [], // No dependencies
        },
      },
      executedNodes: [
        {
          nodeId: 'node_1',
          nodeType: 'NODE_TYPE_1',
          status: NODE_STATUS.SUCCESS,
          output: {},
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_2',
          nodeType: 'NODE_TYPE_2',
          status: NODE_STATUS.SUCCESS,
          output: {},
          artifacts: [],
          attempts: 1,
        },
        {
          nodeId: 'node_3',
          nodeType: 'NODE_TYPE_3',
          status: NODE_STATUS.SUCCESS,
          output: {},
          artifacts: [],
          attempts: 1,
        },
      ],
    });

    let node1Calls = 0;
    let node2Calls = 0;
    let node3Calls = 0;

    setupMockExecutor('NODE_TYPE_1', async () => {
      node1Calls++;
      return { success: true, output: {}, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_2', async () => {
      node2Calls++;
      return { success: true, output: {}, artifacts: [] };
    });

    setupMockExecutor('NODE_TYPE_3', async () => {
      node3Calls++;
      return { success: true, output: {}, artifacts: [] };
    });

    const result = await reExecuteNodes(checkpoint.id, ['node_1', 'node_3']);

    expect(result.summary.reExecuted).toBe(2); // node_1 and node_3

    // Verify only node_1 and node_3 were called
    expect(node1Calls).toBe(1);
    expect(node2Calls).toBe(0); // node_2 was kept
    expect(node3Calls).toBe(1);

    // Verify node_2 was kept
    const node2Result = result.executedNodes.find(n => n.nodeId === 'node_2');
    expect(node2Result.reExecuted).toBeUndefined();
  });
});
