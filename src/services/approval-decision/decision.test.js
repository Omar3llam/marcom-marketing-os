// ============================================================
// Approval Decision Engine Tests — PR #30
// ============================================================
// Unit tests for decision execution service.
//
// TESTS:
//   - executeDecision (APPROVED)
//   - executeDecision (REJECTED)
//   - executeDecision (REQUEST_REVISION)
//   - executeDecision (REGENERATE)
//   - executeDecision (ESCALATE)
//   - executeBatchDecision
//   - getPendingApprovals
//   - Decision validation
//   - Idempotency (already decided)
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
const mockApprovals = new Map();
const mockArtifacts = new Map();
let approvalIdCounter = 1;
let artifactIdCounter = 1;

vi.mock('@prisma/client', () => ({
  PrismaClient: function() {
    return {
      artifactApproval: {
        // R9 — getApprovalByArtifact resolves through findFirst scoped to the
        // workspace. Predicates are applied only when supplied, so a foreign
        // workspaceId matches nothing instead of being silently dropped.
        findFirst: vi.fn(async ({ where, include }) => {
          const approval = Array.from(mockApprovals.values()).find(a =>
            (!where.id || a.id === where.id) &&
            (!where.artifactId || a.artifactId === where.artifactId) &&
            (!where.workspaceId || a.workspaceId === where.workspaceId)
          );
          if (!approval) return null;

          if (include?.artifact) {
            return { ...approval, artifact: mockArtifacts.get(approval.artifactId) };
          }
          return approval;
        }),

        findUnique: vi.fn(async ({ where, include }) => {
          const approval = mockApprovals.get(where.id || where.artifactId);
          if (!approval) return null;

          if (include?.artifact) {
            return {
              ...approval,
              artifact: mockArtifacts.get(approval.artifactId),
            };
          }
          return approval;
        }),

        findMany: vi.fn(async ({ where, include, orderBy }) => {
          // Get unique approval records (filter out duplicate entries from indexing)
          const uniqueApprovals = new Map();
          for (const [key, approval] of mockApprovals) {
            if (!key.startsWith('artifact_')) {
              uniqueApprovals.set(approval.id, approval);
            }
          }

          let approvals = Array.from(uniqueApprovals.values());

          if (where.workspaceId) {
            approvals = approvals.filter(a => a.workspaceId === where.workspaceId);
          }

          if (where.status) {
            approvals = approvals.filter(a => a.status === where.status);
          }

          if (where.decision) {
            approvals = approvals.filter(a => a.decision === where.decision);
          }

          if (where.escalatedTo) {
            approvals = approvals.filter(a => a.escalatedTo === where.escalatedTo);
          }

          if (where.artifact?.executionId) {
            approvals = approvals.filter(a => {
              const artifact = mockArtifacts.get(a.artifactId);
              return artifact && artifact.executionId === where.artifact.executionId;
            });
          }

          if (where.artifact?.type) {
            approvals = approvals.filter(a => {
              const artifact = mockArtifacts.get(a.artifactId);
              return artifact && artifact.type === where.artifact.type;
            });
          }

          if (include?.artifact) {
            approvals = approvals.map(a => ({
              ...a,
              artifact: mockArtifacts.get(a.artifactId),
            }));
          }

          if (orderBy?.createdAt === 'asc') {
            approvals.sort((a, b) => a.createdAt - b.createdAt);
          }

          return approvals;
        }),

        update: vi.fn(async ({ where, data }) => {
          const approval = mockApprovals.get(where.id);
          if (!approval) throw new Error('Approval not found');
          Object.assign(approval, data);
          return approval;
        }),

        // R11 (I64/I69) — executeDecision now writes through updateMany so the
        // workspace and the PENDING precondition are enforced atomically in the
        // WHERE. Honour every predicate so a foreign or already-decided row
        // reports `count: 0`, exactly as Postgres would.
        updateMany: vi.fn(async ({ where = {}, data }) => {
          // The fixture indexes each approval under BOTH its id and its
          // artifactId (so findUnique can resolve either way), so the values()
          // iterator yields the same object twice. Dedupe by identity —
          // otherwise every single-row update reports count 2 and the service
          // correctly concludes something else already moved the row.
          const matched = [...new Set(mockApprovals.values())].filter(a =>
            (!where.id || a.id === where.id) &&
            (!where.workspaceId || a.workspaceId === where.workspaceId) &&
            (!where.status || a.status === where.status)
          );
          for (const a of matched) Object.assign(a, data);
          return { count: matched.length };
        }),

        count: vi.fn(async ({ where }) => {
          let approvals = Array.from(mockApprovals.values());

          if (where?.status) {
            approvals = approvals.filter(a => a.status === where.status);
          }

          if (where?.decision) {
            approvals = approvals.filter(a => a.decision === where.decision);
          }

          return approvals.length;
        }),
      },
    };
  },
}));

// Import service AFTER mocks
import {
  executeDecision,
  executeBatchDecision,
  getPendingApprovals,
  getApprovalByArtifact,
  healthCheck,
  DECISION_TYPE,
  APPROVAL_STATUS,
} from './index.js';

describe('Approval Decision Engine', () => {
  beforeEach(() => {
    mockApprovals.clear();
    mockArtifacts.clear();
    approvalIdCounter = 1;
    artifactIdCounter = 1;
  });

  // Helper to create test artifact + approval
  function createTestApproval(workspaceId = '00000000-0000-0000-0000-000000000001', options = {}) {
    const artifactId = `artifact_${artifactIdCounter++}`;
    const approvalId = `approval_${approvalIdCounter++}`;

    const artifact = {
      id: artifactId,
      workspaceId,
      executionId: options.executionId || 'exec_test',
      nodeId: options.nodeId || 'node_1',
      nodeType: 'GENERATE_HOOK_VARIANTS',
      type: 'hook',
      storageKey: 'test/key',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
      createdAt: new Date(),
    };

    const approval = {
      id: approvalId,
      artifactId,
      workspaceId,
      status: APPROVAL_STATUS.PENDING,
      decision: null,
      reviewerId: null,
      feedback: null,
      decisionMetadata: null,
      escalatedTo: null,
      escalatedAt: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockArtifacts.set(artifactId, artifact);
    mockApprovals.set(approvalId, approval);

    // Also index by artifactId for findUnique lookups
    mockApprovals.set(artifactId, approval);

    return { approval, artifact };
  }

  describe('executeDecision', () => {
    describe('APPROVED decision', () => {
      it('should mark approval as APPROVED with timestamp', async () => {
        const { approval } = createTestApproval();
        const reviewerId = 'user_123';

        const result = await executeDecision(
          approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.APPROVED,
          { reviewerId, feedback: 'Looks great!' }
        );

        expect(result.status).toBe(APPROVAL_STATUS.COMPLETED);
        expect(result.decision).toBe(DECISION_TYPE.APPROVED);
        expect(result.reviewerId).toBe(reviewerId);
        expect(result.feedback).toBe('Looks great!');
        expect(result.approvedAt).toBeInstanceOf(Date);
        expect(result.rejectedAt).toBeNull();
      });

      it('should accept optional decisionMetadata', async () => {
        const { approval } = createTestApproval();

        const result = await executeDecision(
          approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.APPROVED,
          {
            reviewerId: 'user_123',
            decisionMetadata: { publishTarget: 'META', scheduledAt: '2026-05-26T10:00:00Z' },
          }
        );

        expect(result.decisionMetadata).toEqual({
          publishTarget: 'META',
          scheduledAt: '2026-05-26T10:00:00Z',
        });
      });
    });

    describe('REJECTED decision', () => {
      it('should mark approval as REJECTED with reason', async () => {
        const { approval } = createTestApproval();

        const result = await executeDecision(
          approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.REJECTED,
          {
            reviewerId: 'user_456',
            feedback: 'Off-brand tone',
            decisionMetadata: { rejectionReason: 'Tone does not match brand voice' },
          }
        );

        expect(result.status).toBe(APPROVAL_STATUS.COMPLETED);
        expect(result.decision).toBe(DECISION_TYPE.REJECTED);
        expect(result.rejectedAt).toBeInstanceOf(Date);
        expect(result.approvedAt).toBeNull();
        expect(result.decisionMetadata.rejectionReason).toBe('Tone does not match brand voice');
      });

      it('should require rejectionReason in metadata', async () => {
        const { approval } = createTestApproval();

        await expect(
          executeDecision(approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.REJECTED, {
            reviewerId: 'user_456',
          })
        ).rejects.toThrow('Decision REJECTED requires metadata');
      });
    });

    describe('REQUEST_REVISION decision', () => {
      it('should keep status PENDING with revision instructions', async () => {
        const { approval } = createTestApproval();

        const result = await executeDecision(
          approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.REQUEST_REVISION,
          {
            reviewerId: 'user_789',
            feedback: 'Needs changes',
            decisionMetadata: {
              revisionInstructions: 'Make the tone more casual and add emoji',
              targetFields: ['tone', 'style'],
            },
          }
        );

        expect(result.status).toBe(APPROVAL_STATUS.PENDING);
        expect(result.decision).toBe(DECISION_TYPE.REQUEST_REVISION);
        expect(result.decisionMetadata.revisionInstructions).toBe('Make the tone more casual and add emoji');
        expect(result.decisionMetadata.targetFields).toEqual(['tone', 'style']);
      });

      it('should require revisionInstructions in metadata', async () => {
        const { approval } = createTestApproval();

        await expect(
          executeDecision(approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.REQUEST_REVISION, {
            reviewerId: 'user_789',
          })
        ).rejects.toThrow('Decision REQUEST_REVISION requires metadata');
      });
    });

    describe('REGENERATE decision', () => {
      it('should mark as COMPLETED with regeneration hint', async () => {
        const { approval } = createTestApproval();

        const result = await executeDecision(
          approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.REGENERATE,
          {
            reviewerId: 'user_abc',
            feedback: 'Try again with different approach',
            decisionMetadata: {
              regenerationHint: 'Focus on emotional appeal rather than features',
              preserveContext: true,
            },
          }
        );

        expect(result.status).toBe(APPROVAL_STATUS.COMPLETED);
        expect(result.decision).toBe(DECISION_TYPE.REGENERATE);
        expect(result.decisionMetadata.regenerationHint).toBe('Focus on emotional appeal rather than features');
      });
    });

    describe('ESCALATE decision', () => {
      it('should keep PENDING status and set escalation metadata', async () => {
        const { approval } = createTestApproval();

        const result = await executeDecision(
          approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.ESCALATE,
          {
            reviewerId: 'user_def',
            feedback: 'Escalating to senior reviewer',
            decisionMetadata: {
              escalationReason: 'Compliance review required',
              escalatedTo: 'user_senior',
              urgency: 'high',
            },
          }
        );

        expect(result.status).toBe(APPROVAL_STATUS.PENDING);
        expect(result.decision).toBe(DECISION_TYPE.ESCALATE);
        expect(result.escalatedTo).toBe('user_senior');
        expect(result.escalatedAt).toBeInstanceOf(Date);
        expect(result.decisionMetadata.escalationReason).toBe('Compliance review required');
      });

      it('should require escalationReason in metadata', async () => {
        const { approval } = createTestApproval();

        await expect(
          executeDecision(approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.ESCALATE, {
            reviewerId: 'user_def',
          })
        ).rejects.toThrow('Decision ESCALATE requires metadata');
      });
    });

    describe('Validation', () => {
      it('should reject invalid decision type', async () => {
        const { approval } = createTestApproval();

        await expect(
          executeDecision(approval.id, '00000000-0000-0000-0000-000000000001', 'INVALID_DECISION', { reviewerId: 'user_123' })
        ).rejects.toThrow('Invalid decision type');
      });

      it('should reject decision on already completed approval', async () => {
        const { approval } = createTestApproval();

        // First decision
        await executeDecision(approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.APPROVED, { reviewerId: 'user_123' });

        // Second decision should fail
        await expect(
          executeDecision(approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.REJECTED, { reviewerId: 'user_456' })
        ).rejects.toThrow('already completed');
      });

      it('should reject if approval not found', async () => {
        await expect(
          executeDecision('nonexistent_approval', '00000000-0000-0000-0000-000000000001', DECISION_TYPE.APPROVED, { reviewerId: 'user_123' })
        ).rejects.toThrow('not found');
      });
    });
  });

  describe('executeBatchDecision', () => {
    it('should execute decision on multiple approvals', async () => {
      const approval1 = createTestApproval();
      const approval2 = createTestApproval();
      const approval3 = createTestApproval();

      const results = await executeBatchDecision(
        [approval1.approval.id, approval2.approval.id, approval3.approval.id],
        '00000000-0000-0000-0000-000000000001',
        DECISION_TYPE.APPROVED,
        { reviewerId: 'user_batch' }
      );

      expect(results.successful).toHaveLength(3);
      expect(results.failed).toHaveLength(0);
    });

    it('should handle partial failures gracefully', async () => {
      const approval1 = createTestApproval();
      const approval2 = createTestApproval();

      // Complete one approval first
      await executeDecision(approval1.approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.APPROVED, { reviewerId: 'user_123' });

      const results = await executeBatchDecision(
        [approval1.approval.id, approval2.approval.id],
        '00000000-0000-0000-0000-000000000001',
        DECISION_TYPE.APPROVED,
        { reviewerId: 'user_batch' }
      );

      expect(results.successful).toHaveLength(1);
      expect(results.failed).toHaveLength(1);
      expect(results.failed[0].approvalId).toBe(approval1.approval.id);
    });
  });

  describe('getPendingApprovals', () => {
    it('should retrieve pending approvals for workspace', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      createTestApproval(workspaceId);
      createTestApproval(workspaceId);
      createTestApproval('00000000-0000-0000-0000-000000000002'); // Different workspace

      const pending = await getPendingApprovals(workspaceId);

      expect(pending).toHaveLength(2);
    });

    it('should filter by artifact type', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const approval1 = createTestApproval(workspaceId);
      mockArtifacts.get(approval1.artifact.id).type = 'hook';

      const approval2 = createTestApproval(workspaceId);
      mockArtifacts.get(approval2.artifact.id).type = 'caption';

      const pending = await getPendingApprovals(workspaceId, { artifactType: 'hook' });

      expect(pending).toHaveLength(1);
      expect(pending[0].artifact.type).toBe('hook');
    });

    it('should not return completed approvals', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const approval1 = createTestApproval(workspaceId);
      const approval2 = createTestApproval(workspaceId);

      // Complete one
      await executeDecision(approval1.approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.APPROVED, { reviewerId: 'user_123' });

      const pending = await getPendingApprovals(workspaceId);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(approval2.approval.id);
    });

    it('should return approvals in FIFO order', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const approval1 = createTestApproval(workspaceId);
      await new Promise(resolve => setTimeout(resolve, 10));
      const approval2 = createTestApproval(workspaceId);

      const pending = await getPendingApprovals(workspaceId);

      expect(pending[0].id).toBe(approval1.approval.id);
      expect(pending[1].id).toBe(approval2.approval.id);
    });
  });

  describe('getApprovalByArtifact', () => {
    it('should retrieve approval by artifact ID', async () => {
      const { approval, artifact } = createTestApproval();

      const result = await getApprovalByArtifact(artifact.id, '00000000-0000-0000-0000-000000000001');

      expect(result).toBeDefined();
      expect(result.id).toBe(approval.id);
      expect(result.artifactId).toBe(artifact.id);
    });

    it('should return null if no approval exists', async () => {
      const result = await getApprovalByArtifact('nonexistent_artifact', '00000000-0000-0000-0000-000000000001');

      expect(result).toBeNull();
    });

    // ── R9 (I40) · the returned row INCLUDES the whole artifact ───────────
    it('does not return an approval belonging to another workspace', async () => {
      const { artifact } = createTestApproval('00000000-0000-0000-0000-000000000001');

      expect(await getApprovalByArtifact(artifact.id, '00000000-0000-0000-0000-000000000002')).toBeNull();
      expect(await getApprovalByArtifact(artifact.id, '00000000-0000-0000-0000-000000000001')).not.toBeNull();
    });

    it('requires a workspaceId', async () => {
      await expect(getApprovalByArtifact('artifact_1')).rejects.toThrow(/workspaceId required/);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status with counts', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      createTestApproval(workspaceId);
      createTestApproval(workspaceId);

      const approval3 = createTestApproval(workspaceId);
      await executeDecision(
        approval3.approval.id, '00000000-0000-0000-0000-000000000001', DECISION_TYPE.ESCALATE,
        {
          reviewerId: 'user_123',
          decisionMetadata: { escalationReason: 'Test escalation', escalatedTo: 'user_senior' },
        }
      );

      const health = await healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.pendingApprovals).toBeGreaterThanOrEqual(2);
      expect(health.escalatedApprovals).toBeGreaterThanOrEqual(1);
      expect(health.timestamp).toBeDefined();
    });
  });
});
