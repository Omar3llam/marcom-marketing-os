// ============================================================
// Artifact Approval Service Tests
// ============================================================
// Unit tests for approval workflow operations.
//
// Tests:
//   - createApprovalRequest
//   - approveArtifact
//   - rejectArtifact
//   - requestRevision
//   - getPendingApprovals
//   - getApprovalStatus
//   - artifactRequiresApproval
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger BEFORE any imports (avoids config dependency)
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Prisma BEFORE imports
const mockApprovals = new Map();
let idCounter = 1;

vi.mock('@prisma/client', () => ({
  PrismaClient: function() {
    return {
      artifactApproval: {
        create: vi.fn(async ({ data }) => {
          const approval = {
            id: `approval_${idCounter++}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockApprovals.set(approval.id, approval);
          return approval;
        }),

        update: vi.fn(async ({ where, data, include }) => {
          const approval = mockApprovals.get(where.id);
          if (!approval) throw new Error('Approval not found');
          Object.assign(approval, data, { updatedAt: new Date() });

          if (include?.artifact) {
            approval.artifact = { id: approval.artifactId };
          }

          return approval;
        }),

        findUnique: vi.fn(async ({ where, include }) => {
          const approval = where.id
            ? mockApprovals.get(where.id)
            : Array.from(mockApprovals.values()).find(a => a.artifactId === where.artifactId);

          if (!approval) return null;

          if (include?.artifact) {
            return {
              ...approval,
              artifact: {
                id: approval.artifactId,
                type: 'hook',
                capability: 'GENERATE_HOOKS',
                nodeId: 'node_1',
                executionId: 'exec_1',
              },
            };
          }

          return approval;
        }),

        findMany: vi.fn(async ({ where, include, orderBy }) => {
          let approvals = Array.from(mockApprovals.values());

          if (where.workspaceId) {
            approvals = approvals.filter(a => a.workspaceId === where.workspaceId);
          }
          if (where.status) {
            approvals = approvals.filter(a => a.status === where.status);
          }

          if (include?.artifact) {
            approvals = approvals.map(a => ({
              ...a,
              artifact: {
                id: a.artifactId,
                type: 'hook',
                capability: 'GENERATE_HOOKS',
                provider: 'CLAUDE',
                nodeId: 'node_1',
                nodeType: 'GENERATE_HOOK_VARIANTS',
                executionId: 'exec_1',
                createdAt: a.createdAt,
                content: 'Test hook content',
                metadata: {},
              },
            }));
          }

          if (orderBy?.createdAt === 'asc') {
            approvals.sort((a, b) => a.createdAt - b.createdAt);
          }

          return approvals;
        }),

        findFirst: vi.fn(async () => {
          return Array.from(mockApprovals.values())[0] || null;
        }),
      },
    };
  },
}));

// Now import service
import {
  createApprovalRequest,
  approveArtifact,
  rejectArtifact,
  requestRevision,
  getPendingApprovals,
  getApprovalStatus,
  artifactRequiresApproval,
  APPROVAL_STATUS,
  APPROVAL_REQUIRED,
} from './index.js';

describe('Artifact Approval Service', () => {
  beforeEach(() => {
    mockApprovals.clear();
    idCounter = 1;
  });

  describe('artifactRequiresApproval', () => {
    it('should return true for hook artifacts', () => {
      expect(artifactRequiresApproval('hook')).toBe(true);
    });

    it('should return true for caption artifacts', () => {
      expect(artifactRequiresApproval('caption')).toBe(true);
    });

    it('should return true for angle artifacts', () => {
      expect(artifactRequiresApproval('angle')).toBe(true);
    });

    it('should return false for visual_brief artifacts', () => {
      expect(artifactRequiresApproval('visual_brief')).toBe(false);
    });

    it('should return false for audience_hypothesis artifacts', () => {
      expect(artifactRequiresApproval('audience_hypothesis')).toBe(false);
    });

    it('should return false for unknown artifact types', () => {
      expect(artifactRequiresApproval('unknown')).toBe(false);
    });
  });

  describe('createApprovalRequest', () => {
    it('should create pending approval request', async () => {
      const artifactId = 'artifact_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const approval = await createApprovalRequest(artifactId, workspaceId);

      expect(approval).toBeDefined();
      expect(approval.artifactId).toBe(artifactId);
      expect(approval.workspaceId).toBe(workspaceId);
      expect(approval.status).toBe(APPROVAL_STATUS.PENDING);
      expect(approval.reviewerId).toBeUndefined();
      expect(approval.feedback).toBeUndefined();
    });
  });

  describe('approveArtifact', () => {
    it('should approve artifact with feedback', async () => {
      const artifactId = 'artifact_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const initialApproval = await createApprovalRequest(artifactId, workspaceId);

      const reviewerId = 'user_456';
      const feedback = 'Looks good, approved!';

      const approval = await approveArtifact(initialApproval.id, reviewerId, feedback);

      expect(approval.status).toBe(APPROVAL_STATUS.APPROVED);
      expect(approval.reviewerId).toBe(reviewerId);
      expect(approval.feedback).toBe(feedback);
      expect(approval.approvedAt).toBeInstanceOf(Date);
    });

    it('should approve artifact without feedback', async () => {
      const artifactId = 'artifact_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const initialApproval = await createApprovalRequest(artifactId, workspaceId);

      const reviewerId = 'user_456';

      const approval = await approveArtifact(initialApproval.id, reviewerId);

      expect(approval.status).toBe(APPROVAL_STATUS.APPROVED);
      expect(approval.reviewerId).toBe(reviewerId);
      expect(approval.feedback).toBeNull();
    });
  });

  describe('rejectArtifact', () => {
    it('should reject artifact with reason', async () => {
      const artifactId = 'artifact_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const initialApproval = await createApprovalRequest(artifactId, workspaceId);

      const reviewerId = 'user_456';
      const reason = 'Off-brand tone, needs revision';

      const approval = await rejectArtifact(initialApproval.id, reviewerId, reason);

      expect(approval.status).toBe(APPROVAL_STATUS.REJECTED);
      expect(approval.reviewerId).toBe(reviewerId);
      expect(approval.feedback).toBe(reason);
      expect(approval.rejectedAt).toBeInstanceOf(Date);
    });
  });

  describe('requestRevision', () => {
    it('should request revision with feedback', async () => {
      const artifactId = 'artifact_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const initialApproval = await createApprovalRequest(artifactId, workspaceId);

      const reviewerId = 'user_456';
      const feedback = 'Good start, but make it more urgent';

      const approval = await requestRevision(initialApproval.id, reviewerId, feedback);

      expect(approval.status).toBe(APPROVAL_STATUS.REVISION_REQUESTED);
      expect(approval.reviewerId).toBe(reviewerId);
      expect(approval.feedback).toBe(feedback);
    });
  });

  describe('getPendingApprovals', () => {
    it('should retrieve pending approvals for workspace', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      await createApprovalRequest('artifact_1', workspaceId);
      await createApprovalRequest('artifact_2', workspaceId);
      await createApprovalRequest('artifact_3', workspaceId);

      const approvals = await getPendingApprovals(workspaceId);

      expect(approvals.length).toBe(3);
      expect(approvals[0].artifact).toBeDefined();
      expect(approvals[0].artifact.content).toBeDefined();
    });

    it('should filter by workspace', async () => {
      const workspaceId1 = '00000000-0000-0000-0000-000000000001';
      const workspaceId2 = '00000000-0000-0000-0000-000000000002';

      await createApprovalRequest('artifact_1', workspaceId1);
      await createApprovalRequest('artifact_2', workspaceId2);

      const approvals = await getPendingApprovals(workspaceId1);

      expect(approvals.length).toBe(1);
      expect(approvals[0].workspaceId).toBe(workspaceId1);
    });

    it('should only return pending approvals', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const approval1 = await createApprovalRequest('artifact_1', workspaceId);
      await createApprovalRequest('artifact_2', workspaceId);

      // Approve one
      await approveArtifact(approval1.id, 'user_456');

      const approvals = await getPendingApprovals(workspaceId);

      expect(approvals.length).toBe(1);
      expect(approvals[0].artifactId).toBe('artifact_2');
    });

    it('should return oldest first (FIFO)', async () => {
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      const approval1 = await createApprovalRequest('artifact_1', workspaceId);
      const approval2 = await createApprovalRequest('artifact_2', workspaceId);

      const approvals = await getPendingApprovals(workspaceId);

      expect(approvals[0].id).toBe(approval1.id);
      expect(approvals[1].id).toBe(approval2.id);
    });
  });

  describe('getApprovalStatus', () => {
    it('should retrieve approval status by artifactId', async () => {
      const artifactId = 'artifact_123';
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      await createApprovalRequest(artifactId, workspaceId);

      const approval = await getApprovalStatus(artifactId);

      expect(approval).toBeDefined();
      expect(approval.artifactId).toBe(artifactId);
      expect(approval.status).toBe(APPROVAL_STATUS.PENDING);
      expect(approval.artifact).toBeDefined();
    });

    it('should return null if no approval exists', async () => {
      const approval = await getApprovalStatus('nonexistent_artifact');

      expect(approval).toBeNull();
    });
  });
});
