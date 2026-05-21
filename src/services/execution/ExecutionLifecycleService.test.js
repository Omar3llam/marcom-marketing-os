// ============================================================
// ExecutionLifecycleService Tests
// Phase 11B Task 3: Validate central transition authority
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import ExecutionLifecycleService from './ExecutionLifecycleService.js';
import { ExecutionStatus, IllegalTransitionError, TransitionActor } from '@marcom/runtime-contracts';
import { ConcurrencyError } from '../../utils/occHelpers.js';

// Mock prisma client
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    executionTransition: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock SSE registry so broadcast calls are observable + injectable.
vi.mock('../../lib/sseRegistry.js', () => ({
  broadcastWorkspaceEvent: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import { broadcastWorkspaceEvent } from '../../lib/sseRegistry.js';

describe('ExecutionLifecycleService', () => {
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExecutionLifecycleService();
  });

  describe('transition()', () => {
    it('should successfully transition PENDING → QUEUED', async () => {
      const executionId = 'exec-123';
      const currentVersion = 0;

      // Mock findUnique (current state)
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: currentVersion,
        correlationId: 'corr-123',
        updatedAt: new Date(),
      });

      // Mock updateMany (OCC write)
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      // Mock findUnique (updated state)
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion + 1,
        correlationId: 'corr-123',
        updatedAt: new Date(),
      });

      const result = await service.transition({
        executionId,
        newStatus: ExecutionStatus.QUEUED,
        expectedVersion: currentVersion,
        actor: TransitionActor.API,
        correlationId: 'corr-123',
      });

      expect(result.status).toBe(ExecutionStatus.QUEUED);
      expect(result.version).toBe(currentVersion + 1);
      expect(prisma.executionRequest.updateMany).toHaveBeenCalledWith({
        where: {
          id: executionId,
          version: currentVersion,
        },
        data: expect.objectContaining({
          status: ExecutionStatus.QUEUED,
          version: { increment: 1 },
        }),
      });
    });

    it('should successfully transition QUEUED → EXECUTING', async () => {
      const executionId = 'exec-456';
      const currentVersion = 1;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion,
        correlationId: 'corr-456',
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion + 1,
        correlationId: 'corr-456',
        activeStep: 'meta-api-call',
        updatedAt: new Date(),
      });

      const result = await service.transition({
        executionId,
        newStatus: ExecutionStatus.EXECUTING,
        expectedVersion: currentVersion,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-456',
        metadata: {
          activeStep: 'meta-api-call',
        },
      });

      expect(result.status).toBe(ExecutionStatus.EXECUTING);
      expect(result.activeStep).toBe('meta-api-call');
    });

    it('should successfully transition EXECUTING → EXECUTED_SUCCESS', async () => {
      const executionId = 'exec-789';
      const currentVersion = 2;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-789',
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: currentVersion + 1,
        correlationId: 'corr-789',
        response: { success: true, campaignId: 'camp-123' },
        updatedAt: new Date(),
      });

      const result = await service.transition({
        executionId,
        newStatus: ExecutionStatus.EXECUTED_SUCCESS,
        expectedVersion: currentVersion,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-789',
        metadata: {
          response: { success: true, campaignId: 'camp-123' },
        },
      });

      expect(result.status).toBe(ExecutionStatus.EXECUTED_SUCCESS);
      expect(result.response).toEqual({ success: true, campaignId: 'camp-123' });
    });

    it('should reject illegal transition PENDING → EXECUTING', async () => {
      const executionId = 'exec-illegal';
      const currentVersion = 0;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: currentVersion,
        correlationId: 'corr-illegal',
        updatedAt: new Date(),
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion: currentVersion,
          actor: TransitionActor.API,
          correlationId: 'corr-illegal',
        })
      ).rejects.toThrow(IllegalTransitionError);

      // Verify OCC write was NOT attempted
      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('should reject transition from terminal state EXECUTED_SUCCESS', async () => {
      const executionId = 'exec-terminal';
      const currentVersion = 5;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: currentVersion,
        correlationId: 'corr-terminal',
        updatedAt: new Date(),
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.PENDING,
          expectedVersion: currentVersion,
          actor: TransitionActor.API,
          correlationId: 'corr-terminal',
        })
      ).rejects.toThrow('Terminal states are immutable');

      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('should throw ConcurrencyError on version mismatch', async () => {
      const executionId = 'exec-race';
      const expectedVersion = 3;
      const actualVersion = 5;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: expectedVersion,
        correlationId: 'corr-race',
        updatedAt: new Date(),
      });

      // Mock updateMany returning 0 (version mismatch)
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 0 });

      // Mock findUnique returning current version
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        version: actualVersion,
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion,
          actor: TransitionActor.WORKER,
          correlationId: 'corr-race',
        })
      ).rejects.toThrow(ConcurrencyError);
    });

    it('should throw error if execution not found', async () => {
      const executionId = 'nonexistent';

      prisma.executionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.QUEUED,
          expectedVersion: 0,
          actor: TransitionActor.API,
          correlationId: 'corr-404',
        })
      ).rejects.toThrow('ExecutionRequest nonexistent not found');
    });

    it('should reject request missing required fields', async () => {
      await expect(
        service.transition({
          executionId: 'exec-invalid',
          // Missing: newStatus, expectedVersion, actor
          correlationId: 'corr-invalid',
        })
      ).rejects.toThrow('TransitionRequest missing required field');
    });
  });

  describe('timeout()', () => {
    it('should timeout EXECUTING execution', async () => {
      const executionId = 'exec-timeout';
      const currentVersion = 2;

      // Mock execution that has timed out
      const oldDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-timeout',
        updatedAt: oldDate,
      });

      // Mock transition success
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-timeout',
        updatedAt: oldDate,
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.TIMED_OUT,
        version: currentVersion + 1,
        correlationId: 'corr-timeout',
        updatedAt: new Date(),
      });

      const result = await service.timeout(executionId, 'corr-timeout');

      expect(result.status).toBe(ExecutionStatus.TIMED_OUT);
    });

    it('should not timeout execution that has not exceeded threshold', async () => {
      const executionId = 'exec-fresh';

      // Mock execution updated recently (not timed out)
      const recentDate = new Date(Date.now() - 30 * 1000); // 30 seconds ago
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: 2,
        correlationId: 'corr-fresh',
        updatedAt: recentDate,
      });

      const result = await service.timeout(executionId, 'corr-fresh');

      // Should return execution unchanged
      expect(result.status).toBe(ExecutionStatus.EXECUTING);
      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('should reject timeout on terminal state', async () => {
      const executionId = 'exec-completed';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: 5,
        correlationId: 'corr-completed',
        updatedAt: new Date(),
      });

      await expect(
        service.timeout(executionId, 'corr-completed')
      ).rejects.toThrow('Cannot timeout execution');
    });
  });

  describe('cancel()', () => {
    it('should cancel PENDING execution', async () => {
      const executionId = 'exec-cancel-pending';
      const userId = 'user-123';
      const currentVersion = 0;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: currentVersion,
        correlationId: 'corr-cancel',
        updatedAt: new Date(),
      });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: currentVersion,
        correlationId: 'corr-cancel',
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.CANCELLED,
        version: currentVersion + 1,
        correlationId: 'corr-cancel',
        updatedAt: new Date(),
      });

      const result = await service.cancel(executionId, userId, 'corr-cancel');

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
    });

    it('should cancel EXECUTING execution', async () => {
      const executionId = 'exec-cancel-executing';
      const userId = 'user-456';
      const currentVersion = 2;

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-cancel-exec',
        updatedAt: new Date(),
      });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-cancel-exec',
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.CANCELLED,
        version: currentVersion + 1,
        correlationId: 'corr-cancel-exec',
        updatedAt: new Date(),
      });

      const result = await service.cancel(executionId, userId, 'corr-cancel-exec');

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
    });

    it('should reject cancellation of terminal state', async () => {
      const executionId = 'exec-cancel-terminal';
      const userId = 'user-789';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: 5,
        correlationId: 'corr-cancel-terminal',
        updatedAt: new Date(),
      });

      await expect(
        service.cancel(executionId, userId, 'corr-cancel-terminal')
      ).rejects.toThrow('Cannot cancel execution');
    });
  });

  describe('getExecutionState()', () => {
    it('should return reconciliation payload', async () => {
      const executionId = 'exec-reconcile';
      const recentDate = new Date(Date.now() - 30000); // 30 seconds ago (not stale)

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: 3,
        updatedAt: recentDate,
        correlationId: 'corr-reconcile',
        activeStep: 'meta-api-call',
        retryMetadata: {
          attempt: 1,
          maxAttempts: 3,
          nextRetryAt: '2026-05-20T10:05:00Z',
        },
      });

      const payload = await service.getExecutionState(executionId);

      // Verify core payload structure
      expect(payload).toMatchObject({
        executionId,
        status: ExecutionStatus.EXECUTING,
        version: 3,
        updatedAt: recentDate.toISOString(),
        correlationId: 'corr-reconcile',
        activeStep: 'meta-api-call',
        retryMetadata: {
          attempt: 1,
          maxAttempts: 3,
          nextRetryAt: '2026-05-20T10:05:00Z',
        },
        isTerminal: false,
        canResume: true, // Non-terminal, not stale
        isStale: false,  // Recently updated (30s < 2min timeout)
      });

      // Verify new timestamp fields exist
      expect(payload.lastTransitionAt).toBeDefined();
      expect(payload.serverNow).toBeDefined();
    });

    it('should throw error if execution not found', async () => {
      const executionId = 'nonexistent';

      prisma.executionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.getExecutionState(executionId)
      ).rejects.toThrow('ExecutionRequest nonexistent not found');
    });
  });

  describe('healthCheck()', () => {
    it('should return healthy status when database is accessible', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await service.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.service).toBe('ExecutionLifecycleService');
    });

    it('should return unhealthy status on database error', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Database connection failed'));

      const result = await service.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('ExecutionTransition Audit Log (Task 7)', () => {
    it('should create audit log record on successful transition', async () => {
      const executionId = 'exec-audit-123';
      const currentVersion = 1;
      const workspaceId = 'workspace-abc';

      // Mock current state
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion,
        correlationId: 'corr-123',
        workspaceId,
        updatedAt: new Date(),
      });

      // Mock OCC write success
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      // Mock updated state
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion + 1,
        correlationId: 'corr-123',
        workspaceId,
        updatedAt: new Date(),
      });

      // Mock audit log creation
      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-123',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.QUEUED,
        toStatus: ExecutionStatus.EXECUTING,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-123',
        reason: null,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        metadata: null,
        createdAt: new Date(),
      });

      await service.transition({
        executionId,
        newStatus: ExecutionStatus.EXECUTING,
        expectedVersion: currentVersion,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-123',
      });

      // Verify audit log was created
      expect(prisma.executionTransition.create).toHaveBeenCalledWith({
        data: {
          executionId,
          workspaceId,
          fromStatus: ExecutionStatus.QUEUED,
          toStatus: ExecutionStatus.EXECUTING,
          actor: TransitionActor.WORKER,
          correlationId: 'corr-123',
          reason: null,
          previousVersion: currentVersion,
          newVersion: currentVersion + 1,
          metadata: null,
        },
      });
    });

    it('should include reason in audit log when provided', async () => {
      const executionId = 'exec-reason-456';
      const currentVersion = 2;
      const workspaceId = 'workspace-xyz';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-456',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: currentVersion + 1,
        correlationId: 'corr-456',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-456',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.EXECUTING,
        toStatus: ExecutionStatus.EXECUTED_SUCCESS,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-456',
        reason: 'meta_api_success',
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        metadata: { campaignId: 'camp-123' },
        createdAt: new Date(),
      });

      await service.transition({
        executionId,
        newStatus: ExecutionStatus.EXECUTED_SUCCESS,
        expectedVersion: currentVersion,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-456',
        metadata: {
          reason: 'meta_api_success',
          auditMetadata: { campaignId: 'camp-123' },
        },
      });

      expect(prisma.executionTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: 'meta_api_success',
          metadata: { campaignId: 'camp-123' },
        }),
      });
    });

    it('should not fail transition if audit log creation fails', async () => {
      const executionId = 'exec-resilient-789';
      const currentVersion = 0;
      const workspaceId = 'workspace-resilient';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: currentVersion,
        correlationId: 'corr-789',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion + 1,
        correlationId: 'corr-789',
        workspaceId,
        updatedAt: new Date(),
      });

      // Mock audit log creation failure
      prisma.executionTransition.create.mockRejectedValue(
        new Error('Database write failed')
      );

      // Transition should still succeed despite audit log failure
      const result = await service.transition({
        executionId,
        newStatus: ExecutionStatus.QUEUED,
        expectedVersion: currentVersion,
        actor: TransitionActor.API,
        correlationId: 'corr-789',
      });

      expect(result.status).toBe(ExecutionStatus.QUEUED);
      expect(result.version).toBe(currentVersion + 1);
    });

    it('should create audit log for timeout transition', async () => {
      const executionId = 'exec-timeout-audit';
      const currentVersion = 2;
      const workspaceId = 'workspace-timeout';

      // Mock execution that has timed out
      const oldDate = new Date(Date.now() - 5 * 60 * 1000);
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-timeout',
        workspaceId,
        updatedAt: oldDate,
      });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-timeout',
        workspaceId,
        updatedAt: oldDate,
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.TIMED_OUT,
        version: currentVersion + 1,
        correlationId: 'corr-timeout',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-timeout',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.EXECUTING,
        toStatus: ExecutionStatus.TIMED_OUT,
        actor: TransitionActor.TIMEOUT_HANDLER,
        correlationId: 'corr-timeout',
        reason: null,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        metadata: null,
        createdAt: new Date(),
      });

      await service.timeout(executionId, 'corr-timeout');

      expect(prisma.executionTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor: TransitionActor.TIMEOUT_HANDLER,
          fromStatus: ExecutionStatus.EXECUTING,
          toStatus: ExecutionStatus.TIMED_OUT,
        }),
      });
    });

    it('should create audit log for cancellation', async () => {
      const executionId = 'exec-cancel-audit';
      const userId = 'user-123';
      const currentVersion = 1;
      const workspaceId = 'workspace-cancel';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion,
        correlationId: 'corr-cancel',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion,
        correlationId: 'corr-cancel',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.CANCELLED,
        version: currentVersion + 1,
        correlationId: 'corr-cancel',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-cancel',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.QUEUED,
        toStatus: ExecutionStatus.CANCELLED,
        actor: TransitionActor.USER,
        correlationId: 'corr-cancel',
        reason: null,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        metadata: null,
        createdAt: new Date(),
      });

      await service.cancel(executionId, userId, 'corr-cancel');

      expect(prisma.executionTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor: TransitionActor.USER,
          fromStatus: ExecutionStatus.QUEUED,
          toStatus: ExecutionStatus.CANCELLED,
        }),
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // Phase 11C Task 2 — SSE broadcast on successful transitions
  // ────────────────────────────────────────────────────────────
  describe('SSE broadcast', () => {
    const baseExecution = {
      id: 'exec-sse-1',
      workspaceId: 'workspace-A',
      actionType: 'PAUSE_ADSET',
      targetId: 'adset-1',
      status: ExecutionStatus.PENDING,
      version: 0,
      correlationId: 'corr-sse',
      updatedAt: new Date('2026-05-20T10:00:00.000Z'),
    };

    it('should broadcast execution.transition event to workspace on success', async () => {
      prisma.executionRequest.findUnique.mockResolvedValueOnce(baseExecution);
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        ...baseExecution,
        status: ExecutionStatus.QUEUED,
        version: 1,
        updatedAt: new Date('2026-05-20T10:00:01.000Z'),
      });
      prisma.executionTransition.create.mockResolvedValue({ id: 'tr-1' });

      await service.transition({
        executionId: baseExecution.id,
        newStatus: ExecutionStatus.QUEUED,
        expectedVersion: 0,
        actor: TransitionActor.API,
        correlationId: 'corr-sse',
      });

      expect(broadcastWorkspaceEvent).toHaveBeenCalledTimes(1);
      const [workspaceId, event] = broadcastWorkspaceEvent.mock.calls[0];
      expect(workspaceId).toBe('workspace-A');
      expect(event).toMatchObject({
        type: 'execution.transition',
        eventType: 'execution.transition',
        executionId: baseExecution.id,
        correlationId: 'corr-sse',
        actor: TransitionActor.API,
        transition: { from: ExecutionStatus.PENDING, to: ExecutionStatus.QUEUED },
        version: { from: 0, to: 1 },
        execution: {
          id: baseExecution.id,
          actionType: 'PAUSE_ADSET',
          targetId: 'adset-1',
          status: ExecutionStatus.QUEUED,
          version: 1,
          correlationId: 'corr-sse',
        },
      });
    });

    it('should NOT broadcast when OCC fails (concurrency violation)', async () => {
      prisma.executionRequest.findUnique.mockResolvedValueOnce(baseExecution);
      // updateMany returns 0 → updateWithOCC throws ConcurrencyError
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 0 });
      // getCurrentVersion lookup for the error payload
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: baseExecution.id,
        version: 5,
      });

      await expect(
        service.transition({
          executionId: baseExecution.id,
          newStatus: ExecutionStatus.QUEUED,
          expectedVersion: 0,
          actor: TransitionActor.API,
          correlationId: 'corr-sse',
        }),
      ).rejects.toThrow(ConcurrencyError);

      expect(broadcastWorkspaceEvent).not.toHaveBeenCalled();
    });

    it('should NOT broadcast when transition is illegal (rejected before OCC)', async () => {
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        ...baseExecution,
        status: ExecutionStatus.PENDING,
      });

      await expect(
        service.transition({
          executionId: baseExecution.id,
          // Illegal: PENDING → EXECUTING skips QUEUED
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion: 0,
          actor: TransitionActor.API,
          correlationId: 'corr-sse',
        }),
      ).rejects.toThrow(IllegalTransitionError);

      expect(broadcastWorkspaceEvent).not.toHaveBeenCalled();
      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('should NOT fail the transition when broadcast throws', async () => {
      prisma.executionRequest.findUnique.mockResolvedValueOnce(baseExecution);
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        ...baseExecution,
        status: ExecutionStatus.QUEUED,
        version: 1,
      });
      prisma.executionTransition.create.mockResolvedValue({ id: 'tr-2' });

      // Make broadcast blow up — transition should still succeed
      broadcastWorkspaceEvent.mockImplementationOnce(() => {
        throw new Error('SSE channel offline');
      });

      const result = await service.transition({
        executionId: baseExecution.id,
        newStatus: ExecutionStatus.QUEUED,
        expectedVersion: 0,
        actor: TransitionActor.API,
        correlationId: 'corr-sse',
      });

      expect(result.status).toBe(ExecutionStatus.QUEUED);
      expect(result.version).toBe(1);
      expect(broadcastWorkspaceEvent).toHaveBeenCalledTimes(1);
    });
  });
});
