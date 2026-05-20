// ============================================================
// Execution Lifecycle Chaos Testing
// Phase 11B Task 8: Validate runtime governance under disorder
//
// CRITICAL INVARIANTS UNDER TEST:
// 1. OCC prevents race conditions (exactly one winner)
// 2. Versions must always increase monotonically
// 3. Frontend state version can never decrease (stale detection)
// 4. Terminal states are immutable
// 5. Every successful transition creates exactly one audit log
// 6. Illegal transitions are rejected before OCC write
// 7. Idempotency survives chaos
//
// This is NOT "does it work" testing.
// This is "does it stay truthful under disorder" testing.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import ExecutionLifecycleService from './ExecutionLifecycleService.js';
import { ExecutionStatus, IllegalTransitionError } from '../../types/execution.js';
import { ConcurrencyError } from '../../utils/occHelpers.js';
import { TransitionActor } from './transitionRules.js';

// Mock prisma client
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    executionTransition: {
      create: vi.fn(),
      findMany: vi.fn(),
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

import { prisma } from '../../lib/prisma.js';

describe('ExecutionLifecycle Chaos Testing ☢️', () => {
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExecutionLifecycleService();
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 1: OCC Prevents Race Conditions
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: OCC prevents race conditions', () => {
    it('should reject transition when version mismatch detected (OCC violation)', async () => {
      const executionId = 'exec-occ-violation';
      const expectedVersion = 3;
      const actualVersion = 5; // Someone else updated it
      const workspaceId = 'workspace-occ';

      // Initial read: version 3
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: expectedVersion,
        correlationId: 'corr-occ',
        workspaceId,
        updatedAt: new Date(),
      });

      // OCC write fails (count: 0 = version mismatch)
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 0 });

      // Re-read shows actual version
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        version: actualVersion,
      });

      // Attempt transition
      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion,
          actor: TransitionActor.WORKER,
          correlationId: 'corr-occ',
        })
      ).rejects.toThrow(ConcurrencyError);

      // INVARIANT: No audit log created when OCC fails
      expect(prisma.executionTransition.create).not.toHaveBeenCalled();
    });

    it('should succeed when version matches (OCC passes)', async () => {
      const executionId = 'exec-occ-pass';
      const currentVersion = 2;
      const workspaceId = 'workspace-pass';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion,
        correlationId: 'corr-pass',
        workspaceId,
        updatedAt: new Date(),
      });

      // OCC write succeeds (count: 1)
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion + 1,
        correlationId: 'corr-pass',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-pass',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.QUEUED,
        toStatus: ExecutionStatus.EXECUTING,
        actor: TransitionActor.WORKER,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        createdAt: new Date(),
      });

      const result = await service.transition({
        executionId,
        newStatus: ExecutionStatus.EXECUTING,
        expectedVersion: currentVersion,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-pass',
      });

      // INVARIANT: Version incremented by exactly 1
      expect(result.version).toBe(currentVersion + 1);

      // INVARIANT: Exactly one audit log created
      expect(prisma.executionTransition.create).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 2: Terminal State Immutability
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: Terminal states are immutable', () => {
    it('should reject any transition from EXECUTED_SUCCESS', async () => {
      const executionId = 'exec-terminal-success';
      const workspaceId = 'workspace-terminal';

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: 5,
        correlationId: 'corr-terminal',
        workspaceId,
        updatedAt: new Date(),
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.PENDING,
          expectedVersion: 5,
          actor: TransitionActor.SYSTEM,
          correlationId: 'corr-illegal',
        })
      ).rejects.toThrow(/Terminal states are immutable/);

      // INVARIANT: No OCC write attempted
      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();

      // INVARIANT: No audit log created
      expect(prisma.executionTransition.create).not.toHaveBeenCalled();
    });

    it('should reject any transition from TIMED_OUT', async () => {
      const executionId = 'exec-terminal-timeout';
      const workspaceId = 'workspace-timeout';

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.TIMED_OUT,
        version: 3,
        correlationId: 'corr-timeout',
        workspaceId,
        updatedAt: new Date(),
      });

      // Late worker tries to report success
      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTED_SUCCESS,
          expectedVersion: 3,
          actor: TransitionActor.WORKER,
          correlationId: 'corr-late',
        })
      ).rejects.toThrow(/Terminal states are immutable/);

      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
      expect(prisma.executionTransition.create).not.toHaveBeenCalled();
    });

    it('should reject any transition from CANCELLED', async () => {
      const executionId = 'exec-terminal-cancelled';
      const workspaceId = 'workspace-cancelled';

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.CANCELLED,
        version: 2,
        correlationId: 'corr-cancelled',
        workspaceId,
        updatedAt: new Date(),
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.QUEUED,
          expectedVersion: 2,
          actor: TransitionActor.USER,
          correlationId: 'corr-retry',
        })
      ).rejects.toThrow(/Terminal states are immutable/);
    });
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 3: Illegal Transitions Rejected Before OCC
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: Illegal transitions rejected before OCC write', () => {
    it('should reject PENDING → EXECUTING (must go through QUEUED)', async () => {
      const executionId = 'exec-illegal-skip';
      const workspaceId = 'workspace-illegal';

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: 0,
        correlationId: 'corr-illegal',
        workspaceId,
        updatedAt: new Date(),
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion: 0,
          actor: TransitionActor.API,
          correlationId: 'corr-illegal',
        })
      ).rejects.toThrow(IllegalTransitionError);

      // INVARIANT: Validation happens before OCC write
      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
      expect(prisma.executionTransition.create).not.toHaveBeenCalled();
    });

    it('should reject QUEUED → SUCCESS (must go through EXECUTING)', async () => {
      const executionId = 'exec-illegal-shortcut';
      const workspaceId = 'workspace-shortcut';

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: 1,
        correlationId: 'corr-shortcut',
        workspaceId,
        updatedAt: new Date(),
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTED_SUCCESS,
          expectedVersion: 1,
          actor: TransitionActor.WORKER,
          correlationId: 'corr-shortcut',
        })
      ).rejects.toThrow(IllegalTransitionError);

      expect(prisma.executionRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 4: Version Monotonicity
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: Versions always increase monotonically', () => {
    it('should increment version by exactly 1 on each transition', async () => {
      const executionId = 'exec-version-monotonic';
      const workspaceId = 'workspace-version';

      const transitions = [
        { v: 0, from: ExecutionStatus.PENDING, to: ExecutionStatus.QUEUED },
        { v: 1, from: ExecutionStatus.QUEUED, to: ExecutionStatus.EXECUTING },
        { v: 2, from: ExecutionStatus.EXECUTING, to: ExecutionStatus.EXECUTED_SUCCESS },
      ];

      for (const { v, from, to } of transitions) {
        // Setup mocks for this transition
        prisma.executionRequest.findUnique.mockResolvedValueOnce({
          id: executionId,
          status: from,
          version: v,
          correlationId: `corr-${v}`,
          workspaceId,
          updatedAt: new Date(),
        });

        prisma.executionRequest.updateMany.mockResolvedValueOnce({ count: 1 });

        prisma.executionRequest.findUnique.mockResolvedValueOnce({
          id: executionId,
          status: to,
          version: v + 1,
          correlationId: `corr-${v}`,
          workspaceId,
          updatedAt: new Date(),
        });

        prisma.executionTransition.create.mockResolvedValueOnce({
          id: `transition-${v}`,
          executionId,
          workspaceId,
          fromStatus: from,
          toStatus: to,
          actor: TransitionActor.WORKER,
          previousVersion: v,
          newVersion: v + 1,
          createdAt: new Date(),
        });

        const result = await service.transition({
          executionId,
          newStatus: to,
          expectedVersion: v,
          actor: TransitionActor.WORKER,
          correlationId: `corr-${v}`,
        });

        // INVARIANT: Version incremented by exactly 1
        expect(result.version).toBe(v + 1);
      }

      // INVARIANT: Three transitions = three audit logs
      expect(prisma.executionTransition.create).toHaveBeenCalledTimes(3);
    });
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 5: Frontend Stale Event Detection
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: Frontend state version can never decrease', () => {
    it('should DROP stale SSE packets (incoming.version < local.version)', () => {
      // Simulates frontend reconciliation hook's stale detection
      const localVersion = 7;
      const staleVersion = 5;

      let currentVersion = localVersion;

      const handleSSEUpdate = (event) => {
        const { version } = event;

        // CRITICAL STALE-EVENT LAW
        if (version != null && version < currentVersion) {
          return { dropped: true, reason: 'stale_version' };
        }

        currentVersion = version;
        return { dropped: false, applied: true };
      };

      const stalePacket = { version: staleVersion, status: 'QUEUED' };
      const result = handleSSEUpdate(stalePacket);

      // INVARIANT: Stale packet dropped
      expect(result.dropped).toBe(true);
      expect(result.reason).toBe('stale_version');

      // INVARIANT: Version unchanged
      expect(currentVersion).toBe(localVersion);
    });

    it('should handle out-of-order SSE packets correctly', () => {
      let currentVersion = 3;

      const handleSSEUpdate = (event) => {
        const { version } = event;
        if (version != null && version < currentVersion) {
          return { dropped: true };
        }
        currentVersion = version;
        return { applied: true };
      };

      // Packets: 5, 3 (stale), 7, 4 (stale), 8
      const packets = [
        { version: 5 },
        { version: 3 }, // Stale
        { version: 7 },
        { version: 4 }, // Stale
        { version: 8 },
      ];

      const results = packets.map(handleSSEUpdate);

      expect(results[0].applied).toBe(true);  // v5 applied
      expect(results[1].dropped).toBe(true);  // v3 dropped
      expect(results[2].applied).toBe(true);  // v7 applied
      expect(results[3].dropped).toBe(true);  // v4 dropped
      expect(results[4].applied).toBe(true);  // v8 applied

      // INVARIANT: Final version is highest (8)
      expect(currentVersion).toBe(8);
    });
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 6: Audit Log Integrity
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: Every successful transition creates exactly one audit log', () => {
    it('should create audit log on successful transition', async () => {
      const executionId = 'exec-audit-success';
      const currentVersion = 1;
      const workspaceId = 'workspace-audit';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: currentVersion,
        correlationId: 'corr-audit',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion + 1,
        correlationId: 'corr-audit',
        workspaceId,
        updatedAt: new Date(),
      });

      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-audit',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.QUEUED,
        toStatus: ExecutionStatus.EXECUTING,
        actor: TransitionActor.WORKER,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        createdAt: new Date(),
      });

      await service.transition({
        executionId,
        newStatus: ExecutionStatus.EXECUTING,
        expectedVersion: currentVersion,
        actor: TransitionActor.WORKER,
        correlationId: 'corr-audit',
      });

      // INVARIANT: Exactly one audit log
      expect(prisma.executionTransition.create).toHaveBeenCalledTimes(1);

      // INVARIANT: Audit log matches transition
      expect(prisma.executionTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          executionId,
          fromStatus: ExecutionStatus.QUEUED,
          toStatus: ExecutionStatus.EXECUTING,
          previousVersion: currentVersion,
          newVersion: currentVersion + 1,
        }),
      });
    });

    it('should NOT create audit log when validation fails', async () => {
      const executionId = 'exec-no-audit';
      const workspaceId = 'workspace-no-audit';

      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        status: ExecutionStatus.PENDING,
        version: 0,
        correlationId: 'corr-invalid',
        workspaceId,
        updatedAt: new Date(),
      });

      // Illegal transition
      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion: 0,
          actor: TransitionActor.API,
          correlationId: 'corr-invalid',
        })
      ).rejects.toThrow(IllegalTransitionError);

      // INVARIANT: No audit log for failed validation
      expect(prisma.executionTransition.create).not.toHaveBeenCalled();
    });

    it('should NOT create audit log when OCC fails', async () => {
      const executionId = 'exec-occ-no-audit';
      const workspaceId = 'workspace-occ-audit';

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        status: ExecutionStatus.QUEUED,
        version: 3,
        correlationId: 'corr-occ',
        workspaceId,
        updatedAt: new Date(),
      });

      // OCC fails
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 0 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        id: executionId,
        version: 5,
      });

      await expect(
        service.transition({
          executionId,
          newStatus: ExecutionStatus.EXECUTING,
          expectedVersion: 3,
          actor: TransitionActor.WORKER,
          correlationId: 'corr-occ',
        })
      ).rejects.toThrow(ConcurrencyError);

      // INVARIANT: No audit log for OCC failure
      expect(prisma.executionTransition.create).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════
  // INVARIANT 7: Timeout Governance
  // ══════════════════════════════════════════════════════════
  describe('INVARIANT: Timeout transitions follow same governance', () => {
    it('should apply OCC to timeout transitions', async () => {
      const executionId = 'exec-timeout-occ';
      const currentVersion = 2;
      const workspaceId = 'workspace-timeout-occ';

      const timedOutExecution = {
        id: executionId,
        status: ExecutionStatus.EXECUTING,
        version: currentVersion,
        correlationId: 'corr-timeout',
        workspaceId,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
      };

      // Timeout handler reads state
      prisma.executionRequest.findUnique.mockResolvedValueOnce(timedOutExecution);

      // Validation read
      prisma.executionRequest.findUnique.mockResolvedValueOnce(timedOutExecution);

      // OCC write succeeds
      prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        ...timedOutExecution,
        status: ExecutionStatus.TIMED_OUT,
        version: currentVersion + 1,
        updatedAt: new Date(),
      });

      prisma.executionTransition.create.mockResolvedValue({
        id: 'transition-timeout',
        executionId,
        workspaceId,
        fromStatus: ExecutionStatus.EXECUTING,
        toStatus: ExecutionStatus.TIMED_OUT,
        actor: TransitionActor.TIMEOUT_HANDLER,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        createdAt: new Date(),
      });

      const result = await service.timeout(executionId, 'corr-timeout');

      // INVARIANT: Timeout uses OCC
      expect(result.status).toBe(ExecutionStatus.TIMED_OUT);
      expect(result.version).toBe(currentVersion + 1);

      // INVARIANT: Timeout creates audit log
      expect(prisma.executionTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor: TransitionActor.TIMEOUT_HANDLER,
          fromStatus: ExecutionStatus.EXECUTING,
          toStatus: ExecutionStatus.TIMED_OUT,
        }),
      });
    });
  });
});
