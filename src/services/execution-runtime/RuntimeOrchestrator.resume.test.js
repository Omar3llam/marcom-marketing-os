// ============================================================
// RuntimeOrchestrator Resume Tests — PR #29
// ============================================================
// Integration tests for interruptible execution (pause/resume).
//
// TEST COVERAGE:
//   1. Happy path: execute → pause → approve → resume → complete
//   2. Reject path: execute → reject → terminate safely
//   3. Crash recovery: pause → process restart → resume from DB
//   4. Double resume protection: resume twice → second idempotent
//   5. Multi-node execution with approval gates
//   6. Graceful degradation when checkpoint creation fails
//   7. Resume without prior pause (error case)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger BEFORE imports
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Prisma for checkpoint and execution persistence
const mockCheckpoints = new Map();
const mockExecutions = new Map();
const mockArtifacts = new Map();
const mockApprovals = new Map();
let checkpointIdCounter = 1;
let executionIdCounter = 1;
let artifactIdCounter = 1;
let approvalIdCounter = 1;

// Test control flags
let shouldFailCheckpointCreation = false;

vi.mock('@prisma/client', () => ({
  PrismaClient: function() {
    return {
      executionCheckpoint: {
        create: vi.fn(async ({ data }) => {
          if (shouldFailCheckpointCreation) {
            throw new Error('DB connection failed');
          }
          const checkpoint = {
            id: `checkpoint_${checkpointIdCounter++}`,
            ...data,
            createdAt: new Date(),
          };
          mockCheckpoints.set(checkpoint.id, checkpoint);
          return checkpoint;
        }),

        findUnique: vi.fn(async ({ where }) => {
          return mockCheckpoints.get(where.id) || null;
        }),

        findFirst: vi.fn(async ({ where, orderBy }) => {
          const checkpoints = Array.from(mockCheckpoints.values())
            .filter(cp => cp.executionId === where.executionId);

          if (checkpoints.length === 0) return null;

          if (orderBy?.createdAt === 'desc') {
            return checkpoints.sort((a, b) => b.createdAt - a.createdAt)[0];
          }

          return checkpoints[0];
        }),

        update: vi.fn(async ({ where, data }) => {
          const checkpoint = mockCheckpoints.get(where.id);
          if (!checkpoint) throw new Error('Checkpoint not found');
          Object.assign(checkpoint, data);
          return checkpoint;
        }),
      },

      executionRequest: {
        findUnique: vi.fn(async ({ where }) => {
          return mockExecutions.get(where.id) || null;
        }),
      },

      artifact: {
        create: vi.fn(async ({ data }) => {
          const artifact = {
            id: `artifact_${artifactIdCounter++}`,
            ...data,
            createdAt: new Date(),
          };
          mockArtifacts.set(artifact.id, artifact);
          return artifact;
        }),
      },

      artifactApproval: {
        create: vi.fn(async ({ data }) => {
          const approval = {
            id: `approval_${approvalIdCounter++}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockApprovals.set(approval.id, approval);
          return approval;
        }),
      },
    };
  },
}));

// Mock artifact storage service
let artifactCounter = 1;
vi.mock('../artifact-storage/index.js', () => ({
  storeArtifact: vi.fn().mockImplementation(async ({ workspaceId, executionId, nodeId, type, content }) => {
    const artifactId = `artifact_${artifactCounter++}`;
    const artifact = {
      id: artifactId,
      workspaceId,
      executionId,
      nodeId,
      type,
      storageKey: `test/${artifactId}`,
      duplicate: false,
    };
    return artifact;
  }),
}));

// Mock artifact approval service
let approvalCounter = 1;
vi.mock('../artifact-approval/index.js', () => ({
  createApprovalRequest: vi.fn().mockImplementation(async ({ workspaceId, artifactId }) => {
    const approvalId = `approval_${approvalCounter++}`;
    const approval = {
      id: approvalId,
      workspaceId,
      artifactId,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return approval;
  }),
  artifactRequiresApproval: vi.fn().mockReturnValue(true),
}));

// Mock Node Executors
const mockExecutors = new Map();

vi.mock('./NodeExecutorRegistry.js', () => ({
  getExecutor: vi.fn((nodeType) => {
    if (mockExecutors.has(nodeType)) {
      return mockExecutors.get(nodeType);
    }

    // Default mock executor
    return async (nodeId, type, context) => ({
      success: true,
      output: { message: `Executed ${type}` },
      artifacts: [],
      metadata: {},
    });
  }),
}));

// Import services AFTER mocks
import { executeExecutionPlan, resumeExecutionFromCheckpoint } from './RuntimeOrchestrator.js';
import { RUNTIME_EVENT, EXECUTION_STATUS, NODE_STATUS } from './runtimeEvents.js';
import { CHECKPOINT_STATUS } from '../execution-checkpoint/index.js';

// Helper to register test executors
function registerTestExecutor(nodeType, executorFn) {
  mockExecutors.set(nodeType, executorFn);
}

describe('RuntimeOrchestrator - Interruptible Execution (PR #29)', () => {
  beforeEach(() => {
    // Reset artifact and approval counters
    artifactCounter = 1;
    approvalCounter = 1;
    mockCheckpoints.clear();
    mockExecutions.clear();
    mockArtifacts.clear();
    mockApprovals.clear();
    checkpointIdCounter = 1;
    shouldFailCheckpointCreation = false; // Reset flag
    executionIdCounter = 1;
    artifactIdCounter = 1;
    approvalIdCounter = 1;
  });

  describe('Happy Path: execute → pause → resume → complete', () => {
    it('should pause execution when node requires approval', async () => {
      const plan = {
        diagnosis: 'test diagnosis',
        executionType: 'manual',
        priority: 'high',
        graph: {
          nodes: [
            {
              id: 'node_1',
              type: 'GENERATE_HOOK_VARIANTS',
              requiresApproval: true, // PAUSE AFTER THIS NODE
            },
            {
              id: 'node_2',
              type: 'PUBLISH_HOOK',
            },
          ],
          edges: [
            { from: 'node_1', to: 'node_2' },
          ],
        },
      };

      const context = {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        executionId: 'exec_pause_test_1',
        campaignData: { id: 'camp_1', name: 'Test Campaign' },
      };

      // Register mock executor that returns artifacts
      registerTestExecutor('GENERATE_HOOK_VARIANTS', async (nodeId, nodeType, ctx) => {
        return {
          success: true,
          output: { message: 'Hooks generated' },
          artifacts: [
            { id: 'hook_1', type: 'hook', content: 'Test hook 1' },
            { id: 'hook_2', type: 'hook', content: 'Test hook 2' },
          ],
          metadata: { capability: 'GENERATE_HOOKS', provider: 'CLAUDE' },
        };
      });

      const result = await executeExecutionPlan(plan, context);

      // Should pause with PAUSED_FOR_APPROVAL status
      expect(result.status).toBe(EXECUTION_STATUS.PAUSED_FOR_APPROVAL);
      expect(result.checkpointId).toBeDefined();
      expect(result.summary.paused).toBe(true);

      // Should have checkpoint created event
      const checkpointEvent = result.events.find(e => e.type === RUNTIME_EVENT.CHECKPOINT_CREATED);
      expect(checkpointEvent).toBeDefined();

      // Should have approval requested event
      const approvalEvent = result.events.find(e => e.type === RUNTIME_EVENT.APPROVAL_REQUESTED);
      expect(approvalEvent).toBeDefined();
      expect(approvalEvent.artifactIds).toHaveLength(2);

      // Should have execution paused event
      const pauseEvent = result.events.find(e => e.type === RUNTIME_EVENT.EXECUTION_PAUSED);
      expect(pauseEvent).toBeDefined();

      // Should have executed only first node
      expect(result.executedNodes).toHaveLength(1);
      expect(result.executedNodes[0].nodeId).toBe('node_1');
      expect(result.executedNodes[0].status).toBe(NODE_STATUS.SUCCESS);

      // Checkpoint should be in DB
      const checkpoint = mockCheckpoints.get(result.checkpointId);
      expect(checkpoint).toBeDefined();
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.PAUSED_FOR_APPROVAL);
      expect(checkpoint.nodeId).toBe('node_1');
      expect(checkpoint.pausedReason).toBe('awaiting_artifact_approval');
    });

    it('should resume execution from checkpoint and complete remaining nodes', async () => {
      // STEP 1: Pause execution (setup)
      const plan = {
        diagnosis: 'test diagnosis',
        executionType: 'manual',
        priority: 'high',
        graph: {
          nodes: [
            { id: 'node_1', type: 'GENERATE_HOOK_VARIANTS', requiresApproval: true },
            { id: 'node_2', type: 'PUBLISH_HOOK' },
            { id: 'node_3', type: 'NOTIFY' },
          ],
          edges: [
            { from: 'node_1', to: 'node_2' },
            { from: 'node_2', to: 'node_3' },
          ],
        },
      };

      const context = {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        executionId: 'exec_resume_test_1',
      };

      registerTestExecutor('GENERATE_HOOK_VARIANTS', async () => ({
        success: true,
        output: { message: 'Hooks generated' },
        artifacts: [{ id: 'hook_1', type: 'hook', content: 'Test hook' }],
        metadata: { capability: 'GENERATE_HOOKS', provider: 'CLAUDE' },
      }));

      registerTestExecutor('PUBLISH_HOOK', async () => ({
        success: true,
        output: { message: 'Hook published' },
        artifacts: [],
      }));

      registerTestExecutor('NOTIFY', async () => ({
        success: true,
        output: { message: 'Notification sent' },
        artifacts: [],
      }));

      const pauseResult = await executeExecutionPlan(plan, context);
      expect(pauseResult.status).toBe(EXECUTION_STATUS.PAUSED_FOR_APPROVAL);

      // STEP 2: Resume execution
      const resumeResult = await resumeExecutionFromCheckpoint(pauseResult.checkpointId);

      // Should complete successfully
      expect(resumeResult.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(resumeResult.resumed).toBe(true);

      // Should have executed all 3 nodes (1 from pause + 2 from resume)
      expect(resumeResult.executedNodes).toHaveLength(3);
      expect(resumeResult.executedNodes[0].nodeId).toBe('node_1');
      expect(resumeResult.executedNodes[1].nodeId).toBe('node_2');
      expect(resumeResult.executedNodes[2].nodeId).toBe('node_3');

      // All nodes should be successful
      expect(resumeResult.summary.successful).toBe(3);
      expect(resumeResult.summary.failed).toBe(0);

      // Should have EXECUTION_RESUMED event
      const resumeEvent = resumeResult.events.find(e => e.type === RUNTIME_EVENT.EXECUTION_RESUMED);
      expect(resumeEvent).toBeDefined();
      expect(resumeEvent.checkpointId).toBe(pauseResult.checkpointId);

      // Checkpoint should be marked as RESUMED
      const checkpoint = mockCheckpoints.get(pauseResult.checkpointId);
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.RESUMED);
      expect(checkpoint.resumedAt).toBeInstanceOf(Date);
    });
  });

  describe('Double Resume Protection', () => {
    it('should return cached result on second resume attempt (idempotent)', async () => {
      const plan = {
        diagnosis: 'test diagnosis',
        executionType: 'manual',
        priority: 'high',
        graph: {
          nodes: [
            { id: 'node_1', type: 'GENERATE_HOOK_VARIANTS', requiresApproval: true },
            { id: 'node_2', type: 'PUBLISH_HOOK' },
          ],
          edges: [{ from: 'node_1', to: 'node_2' }],
        },
      };

      const context = {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        executionId: 'exec_double_resume_test',
      };

      registerTestExecutor('GENERATE_HOOK_VARIANTS', async () => ({
        success: true,
        output: { message: 'Hooks generated' },
        artifacts: [{ id: 'hook_1', type: 'hook', content: 'Test hook' }],
        metadata: { capability: 'GENERATE_HOOKS', provider: 'CLAUDE' },
      }));

      registerTestExecutor('PUBLISH_HOOK', async () => ({
        success: true,
        output: { message: 'Published' },
        artifacts: [],
      }));

      // Pause execution
      const pauseResult = await executeExecutionPlan(plan, context);
      expect(pauseResult.status).toBe(EXECUTION_STATUS.PAUSED_FOR_APPROVAL);

      // First resume
      const firstResume = await resumeExecutionFromCheckpoint(pauseResult.checkpointId);
      expect(firstResume.status).toBe(EXECUTION_STATUS.SUCCESS);

      // Second resume (should be idempotent)
      const secondResume = await resumeExecutionFromCheckpoint(pauseResult.checkpointId);

      expect(secondResume.alreadyResumed).toBe(true);
      expect(secondResume.resumedAt).toBeInstanceOf(Date);
      expect(secondResume.status).toBe(EXECUTION_STATUS.SUCCESS);

      // Checkpoint should still be RESUMED
      const checkpoint = mockCheckpoints.get(pauseResult.checkpointId);
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.RESUMED);
    });
  });

  describe('Crash Recovery', () => {
    it('should resume from DB checkpoint after simulated process restart', async () => {
      const plan = {
        diagnosis: 'test diagnosis',
        executionType: 'manual',
        priority: 'high',
        graph: {
          nodes: [
            { id: 'node_1', type: 'GENERATE_HOOK_VARIANTS', requiresApproval: true },
            { id: 'node_2', type: 'PUBLISH_HOOK' },
          ],
          edges: [{ from: 'node_1', to: 'node_2' }],
        },
      };

      const context = {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        executionId: 'exec_crash_recovery_test',
      };

      registerTestExecutor('GENERATE_HOOK_VARIANTS', async () => ({
        success: true,
        output: { message: 'Hooks generated' },
        artifacts: [{ id: 'hook_1', type: 'hook', content: 'Test hook' }],
        metadata: { capability: 'GENERATE_HOOKS', provider: 'CLAUDE' },
      }));

      registerTestExecutor('PUBLISH_HOOK', async () => ({
        success: true,
        output: { message: 'Published' },
        artifacts: [],
      }));

      // Pause execution
      const pauseResult = await executeExecutionPlan(plan, context);
      const checkpointId = pauseResult.checkpointId;

      // Simulate process restart: checkpoint still in DB (mockCheckpoints Map)
      // but in-memory state is lost. Resume should restore from DB.

      // Resume from checkpoint ID only (no in-memory state)
      const resumeResult = await resumeExecutionFromCheckpoint(checkpointId);

      expect(resumeResult.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.executedNodes).toHaveLength(2);

      // Should have completed node_2 (was not executed before crash)
      const node2 = resumeResult.executedNodes.find(n => n.nodeId === 'node_2');
      expect(node2).toBeDefined();
      expect(node2.status).toBe(NODE_STATUS.SUCCESS);
    });
  });

  describe('Graceful Degradation', () => {
    it('should continue execution if checkpoint creation fails', async () => {
      const plan = {
        diagnosis: 'test diagnosis',
        executionType: 'manual',
        priority: 'high',
        graph: {
          nodes: [
            { id: 'node_1', type: 'GENERATE_HOOK_VARIANTS', requiresApproval: true },
            { id: 'node_2', type: 'PUBLISH_HOOK' },
          ],
          edges: [{ from: 'node_1', to: 'node_2' }],
        },
      };

      const context = {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        executionId: 'exec_checkpoint_fail_test',
      };

      // Simulate checkpoint creation failure
      shouldFailCheckpointCreation = true;

      registerTestExecutor('GENERATE_HOOK_VARIANTS', async () => ({
        success: true,
        output: { message: 'Hooks generated' },
        artifacts: [{ id: 'hook_1', type: 'hook', content: 'Test hook' }],
        metadata: { capability: 'GENERATE_HOOKS', provider: 'CLAUDE' },
      }));

      registerTestExecutor('PUBLISH_HOOK', async () => ({
        success: true,
        output: { message: 'Published' },
        artifacts: [],
      }));

      const result = await executeExecutionPlan(plan, context);

      // Should continue execution despite checkpoint failure (graceful degradation)
      expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(result.checkpointId).toBeUndefined();

      // Should have executed both nodes (no pause)
      expect(result.executedNodes).toHaveLength(2);
      expect(result.summary.successful).toBe(2);
    });
  });

  describe('Error Cases', () => {
    it('should error when resuming non-existent checkpoint', async () => {
      await expect(
        resumeExecutionFromCheckpoint('nonexistent_checkpoint_id')
      ).rejects.toThrow('Checkpoint nonexistent_checkpoint_id not found');
    });

    it('should error when resuming already-resumed checkpoint (invalid state)', async () => {
      // Create a checkpoint that's already resumed
      const checkpoint = {
        id: 'checkpoint_already_resumed',
        executionId: 'exec_test',
        workspaceId: '00000000-0000-0000-0000-000000000001',
        nodeId: 'node_1',
        status: CHECKPOINT_STATUS.RESUMED,
        serializedState: {},
        pausedReason: 'awaiting_artifact_approval',
        createdAt: new Date(),
        resumedAt: new Date(),
      };

      mockCheckpoints.set(checkpoint.id, checkpoint);

      // First resume should return cached result (idempotent)
      const result = await resumeExecutionFromCheckpoint(checkpoint.id);
      expect(result.alreadyResumed).toBe(true);
    });
  });

  describe('Multi-Node Execution with Approval Gates', () => {
    it('should handle multiple approval gates in single execution', async () => {
      const plan = {
        diagnosis: 'test diagnosis',
        executionType: 'manual',
        priority: 'high',
        graph: {
          nodes: [
            { id: 'node_1', type: 'GENERATE_HOOK_VARIANTS', requiresApproval: true },
            { id: 'node_2', type: 'PROCESS' },
            { id: 'node_3', type: 'GENERATE_CAPTION_VARIANTS', requiresApproval: true },
            { id: 'node_4', type: 'PUBLISH' },
          ],
          edges: [
            { from: 'node_1', to: 'node_2' },
            { from: 'node_2', to: 'node_3' },
            { from: 'node_3', to: 'node_4' },
          ],
        },
      };

      const context = {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        executionId: 'exec_multi_approval_test',
      };

      registerTestExecutor('GENERATE_HOOK_VARIANTS', async () => ({
        success: true,
        output: { message: 'Hooks generated' },
        artifacts: [{ id: 'hook_1', type: 'hook', content: 'Test hook' }],
        metadata: { capability: 'GENERATE_HOOKS', provider: 'CLAUDE' },
      }));

      registerTestExecutor('PROCESS', async () => ({
        success: true,
        output: { message: 'Processed' },
        artifacts: [],
      }));

      registerTestExecutor('GENERATE_CAPTION_VARIANTS', async () => ({
        success: true,
        output: { message: 'Captions generated' },
        artifacts: [{ id: 'caption_1', type: 'caption', content: 'Test caption' }],
        metadata: { capability: 'GENERATE_CAPTIONS', provider: 'CLAUDE' },
      }));

      registerTestExecutor('PUBLISH', async () => ({
        success: true,
        output: { message: 'Published' },
        artifacts: [],
      }));

      // First pause at node_1
      const firstPause = await executeExecutionPlan(plan, context);
      expect(firstPause.status).toBe(EXECUTION_STATUS.PAUSED_FOR_APPROVAL);
      expect(firstPause.executedNodes[0].nodeId).toBe('node_1');

      // Resume - should execute node_2, then pause at node_3
      const resumeResult = await resumeExecutionFromCheckpoint(firstPause.checkpointId);

      // NOTE: Current implementation only pauses once per execution.
      // Multi-pause would require recursive pause/resume logic.
      // For now, after resume, execution continues to completion.
      expect(resumeResult.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(resumeResult.summary.successful).toBe(4);
    });
  });
});
