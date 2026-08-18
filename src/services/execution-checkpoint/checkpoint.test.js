// ============================================================
// Execution Checkpoint Service Tests — PR #29
// ============================================================
// Unit tests for checkpoint CRUD operations.
//
// TESTS:
//   - createCheckpoint
//   - getLatestCheckpoint
//   - markCheckpointResumed
//   - getPausedExecutions
//   - updateCheckpointStatus
//   - healthCheck
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

// Mock Prisma
const mockCheckpoints = new Map();
let idCounter = 1;

vi.mock('@prisma/client', () => ({
  PrismaClient: function() {
    return {
      executionCheckpoint: {
        create: vi.fn(async ({ data }) => {
          const checkpoint = {
            id: `checkpoint_${idCounter++}`,
            ...data,
            createdAt: new Date(),
          };
          mockCheckpoints.set(checkpoint.id, checkpoint);
          return checkpoint;
        }),

        findUnique: vi.fn(async ({ where }) => {
          return mockCheckpoints.get(where.id) || null;
        }),

        // R9 — every supplied predicate is applied, including workspaceId and
        // id. getCheckpointById/getLatestCheckpoint are now workspace-scoped;
        // a mock that ignored workspaceId would let an unscoped query pass.
        findFirst: vi.fn(async ({ where, orderBy }) => {
          const checkpoints = Array.from(mockCheckpoints.values()).filter(cp =>
            (!where.id || cp.id === where.id) &&
            (!where.executionId || cp.executionId === where.executionId) &&
            (!where.workspaceId || cp.workspaceId === where.workspaceId)
          );

          if (checkpoints.length === 0) return null;

          if (orderBy?.createdAt === 'desc') {
            return checkpoints.sort((a, b) => b.createdAt - a.createdAt)[0];
          }

          return checkpoints[0];
        }),

        findMany: vi.fn(async ({ where, include, orderBy }) => {
          let checkpoints = Array.from(mockCheckpoints.values());

          if (where.workspaceId) {
            checkpoints = checkpoints.filter(cp => cp.workspaceId === where.workspaceId);
          }

          if (where.status) {
            checkpoints = checkpoints.filter(cp => cp.status === where.status);
          }

          if (where.resumedAt === null) {
            checkpoints = checkpoints.filter(cp => !cp.resumedAt);
          }

          if (include?.execution) {
            checkpoints = checkpoints.map(cp => ({
              ...cp,
              execution: {
                id: cp.executionId,
                actionType: 'test_action',
                targetId: 'test_target',
                status: 'EXECUTING',
                createdAt: cp.createdAt,
              },
            }));
          }

          if (orderBy?.createdAt === 'asc') {
            checkpoints.sort((a, b) => a.createdAt - b.createdAt);
          }

          return checkpoints;
        }),

        update: vi.fn(async ({ where, data }) => {
          const checkpoint = mockCheckpoints.get(where.id);
          if (!checkpoint) throw new Error('Checkpoint not found');
          Object.assign(checkpoint, data);
          return checkpoint;
        }),

        // R11 (I64) — markCheckpointResumed writes through a workspace-scoped
        // updateMany. Honour every predicate so a foreign workspace reports
        // count 0 and the service refuses rather than resuming it.
        updateMany: vi.fn(async ({ where = {}, data }) => {
          const matched = [...new Set(mockCheckpoints.values())].filter(cp =>
            (!where.id          || cp.id          === where.id) &&
            (!where.workspaceId || cp.workspaceId === where.workspaceId));
          for (const cp of matched) Object.assign(cp, data);
          return { count: matched.length };
        }),

        count: vi.fn(async () => mockCheckpoints.size),
      },
    };
  },
}));

// Import service AFTER mocks
import {
  createCheckpoint,
  getLatestCheckpoint,
  getCheckpointById,
  markCheckpointResumed,
  getPausedExecutions,
  updateCheckpointStatus,
  healthCheck,
  CHECKPOINT_STATUS,
  PAUSE_REASONS,
} from './index.js';

describe('Execution Checkpoint Service', () => {
  beforeEach(() => {
    mockCheckpoints.clear();
    idCounter = 1;
  });

  describe('createCheckpoint', () => {
    it('should create checkpoint with PAUSED_FOR_APPROVAL status', async () => {
      const executionId = 'exec_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';
      const nodeId = 'node_1';
      const serializedState = { test: 'state' };

      const checkpoint = await createCheckpoint(
        executionId,
        workspaceId,
        nodeId,
        serializedState
      );

      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toMatch(/^checkpoint_/);
      expect(checkpoint.executionId).toBe(executionId);
      expect(checkpoint.workspaceId).toBe(workspaceId);
      expect(checkpoint.nodeId).toBe(nodeId);
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.PAUSED_FOR_APPROVAL);
      expect(checkpoint.serializedState).toEqual(serializedState);
      expect(checkpoint.pausedReason).toBe(PAUSE_REASONS.AWAITING_ARTIFACT_APPROVAL);
    });

    it('should create checkpoint with custom pause reason', async () => {
      const checkpoint = await createCheckpoint(
        'exec_123',
        '00000000-0000-0000-0000-000000000001',
        'node_1',
        { test: 'state' },
        PAUSE_REASONS.MANUAL_PAUSE
      );

      expect(checkpoint.pausedReason).toBe(PAUSE_REASONS.MANUAL_PAUSE);
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should retrieve latest checkpoint for execution', async () => {
      const executionId = 'exec_456';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      // Create multiple checkpoints
      await createCheckpoint(executionId, workspaceId, 'node_1', { step: 1 });
      await new Promise(resolve => setTimeout(resolve, 10)); // ensure different timestamps
      await createCheckpoint(executionId, workspaceId, 'node_2', { step: 2 });

      const latest = await getLatestCheckpoint(executionId, workspaceId);

      expect(latest).toBeDefined();
      expect(latest.nodeId).toBe('node_2');
      expect(latest.serializedState.step).toBe(2);
    });

    it('should return null if no checkpoint exists', async () => {
      const checkpoint = await getLatestCheckpoint('nonexistent_exec', '00000000-0000-0000-0000-000000000001');

      expect(checkpoint).toBeNull();
    });

    // ── R9 (I40) · the scope is part of the resolver, not the caller ────────
    it('does not return a checkpoint belonging to another workspace', async () => {
      const executionId = 'exec_cross_ws';
      const owner = '00000000-0000-0000-0000-000000000001';
      const other = '00000000-0000-0000-0000-000000000002';

      await createCheckpoint(executionId, owner, 'node_1', { step: 1 });

      // The id is real; the workspace is not this caller's. Resumable execution
      // state must simply not exist here.
      expect(await getLatestCheckpoint(executionId, other)).toBeNull();
      expect(await getLatestCheckpoint(executionId, owner)).not.toBeNull();
    });

    it('requires a workspaceId rather than defaulting to a global lookup', async () => {
      await expect(getLatestCheckpoint('exec_456')).rejects.toThrow(/workspaceId required/);
    });
  });

  describe('getCheckpointById — R9 workspace scope', () => {
    it('does not resolve a checkpoint id from another workspace', async () => {
      const owner = '00000000-0000-0000-0000-000000000001';
      const other = '00000000-0000-0000-0000-000000000002';
      const created = await createCheckpoint('exec_by_id', owner, 'node_1', { step: 1 });

      expect(await getCheckpointById(created.id, other)).toBeNull();
      expect(await getCheckpointById(created.id, owner)).not.toBeNull();
    });

    it('requires a workspaceId', async () => {
      await expect(getCheckpointById('checkpoint_1')).rejects.toThrow(/workspaceId required/);
    });
  });

  describe('markCheckpointResumed', () => {
    it('should mark checkpoint as RESUMED with timestamp', async () => {
      const executionId = 'exec_789';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const created = await createCheckpoint(executionId, workspaceId, 'node_1', {});
      expect(created.status).toBe(CHECKPOINT_STATUS.PAUSED_FOR_APPROVAL);
      expect(created.resumedAt).toBeUndefined();

      const resumed = await markCheckpointResumed(created.id, '00000000-0000-0000-0000-000000000001');

      expect(resumed.status).toBe(CHECKPOINT_STATUS.RESUMED);
      expect(resumed.resumedAt).toBeInstanceOf(Date);
    });
  });

  describe('getPausedExecutions', () => {
    it('should retrieve all paused executions for workspace', async () => {
      const workspace1 = '00000000-0000-0000-0000-000000000001';
      const workspace2 = '00000000-0000-0000-0000-000000000002';

      await createCheckpoint('exec_1', workspace1, 'node_1', {});
      await createCheckpoint('exec_2', workspace1, 'node_1', {});
      await createCheckpoint('exec_3', workspace2, 'node_1', {});

      const paused = await getPausedExecutions(workspace1);

      expect(paused).toHaveLength(2);
      expect(paused[0].execution).toBeDefined();
      expect(paused[1].execution).toBeDefined();
    });

    it('should not return resumed executions', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const cp1 = await createCheckpoint('exec_1', workspaceId, 'node_1', {});
      await createCheckpoint('exec_2', workspaceId, 'node_1', {});

      // Resume one
      await markCheckpointResumed(cp1.id, '00000000-0000-0000-0000-000000000001');

      const paused = await getPausedExecutions(workspaceId);

      expect(paused).toHaveLength(1);
      expect(paused[0].executionId).toBe('exec_2');
    });

    it('should return executions in FIFO order (oldest first)', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const cp1 = await createCheckpoint('exec_1', workspaceId, 'node_1', {});
      await new Promise(resolve => setTimeout(resolve, 10));
      const cp2 = await createCheckpoint('exec_2', workspaceId, 'node_1', {});

      const paused = await getPausedExecutions(workspaceId);

      expect(paused[0].id).toBe(cp1.id);
      expect(paused[1].id).toBe(cp2.id);
    });
  });

  describe('updateCheckpointStatus', () => {
    it('should update checkpoint status', async () => {
      const executionId = 'exec_update_test';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const created = await createCheckpoint(executionId, workspaceId, 'node_1', {});
      expect(created.status).toBe(CHECKPOINT_STATUS.PAUSED_FOR_APPROVAL);

      const updated = await updateCheckpointStatus(created.id, CHECKPOINT_STATUS.RESUMING);

      expect(updated.status).toBe(CHECKPOINT_STATUS.RESUMING);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when DB is accessible', async () => {
      const health = await healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.checkpointCount).toBeGreaterThanOrEqual(0);
      expect(health.timestamp).toBeDefined();
    });
  });
});
