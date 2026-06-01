// ============================================================
// Scoring Engine Tests — PR #42
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateDecayFactor,
  calculateConfidence,
  calculateProviderScore,
  calculateAllProviderScores,
  CONSTANTS,
} from './scoringEngine.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const TEST_REVIEWER_ID = '00000000-0000-0000-0000-000000000002';

describe('scoringEngine', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({
      where:  { id: TEST_WORKSPACE_ID },
      update: {},
      create: { id: TEST_WORKSPACE_ID, name: 'Test Workspace' },
    });
  });

  afterAll(async () => {
    // Delete child records first (no cascade configured on ExecutionRequest → Workspace)
    await prisma.approvalDecision.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } });
    await prisma.artifactApproval.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } });
    await prisma.artifact.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } });
    await prisma.executionRequest.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } });
    await prisma.workspace.delete({ where: { id: TEST_WORKSPACE_ID } });
    await prisma.$disconnect();
  });

  describe('calculateDecayFactor', () => {
    it('should return 1.0 for 0 days ago', () => {
      expect(calculateDecayFactor(0)).toBe(1.0);
    });

    it('should return ~0.5 for 30 days ago (half-life)', () => {
      const decay = calculateDecayFactor(30);
      expect(decay).toBeCloseTo(0.5, 1); // Within 0.1
    });

    it('should return ~0.25 for 60 days ago', () => {
      const decay = calculateDecayFactor(60);
      expect(decay).toBeCloseTo(0.25, 1);
    });

    it('should be monotonically decreasing', () => {
      const decay0 = calculateDecayFactor(0);
      const decay10 = calculateDecayFactor(10);
      const decay20 = calculateDecayFactor(20);
      const decay30 = calculateDecayFactor(30);

      expect(decay0).toBeGreaterThan(decay10);
      expect(decay10).toBeGreaterThan(decay20);
      expect(decay20).toBeGreaterThan(decay30);
    });

    it('should throw error for negative days', () => {
      expect(() => calculateDecayFactor(-1)).toThrow('Invalid daysAgo');
    });

    it('should be deterministic (same input → same output)', () => {
      const result1 = calculateDecayFactor(15);
      const result2 = calculateDecayFactor(15);
      expect(result1).toBe(result2);
    });
  });

  describe('calculateConfidence', () => {
    it('should return 0.0 for sample sizes below MIN_SAMPLE_SIZE', () => {
      expect(calculateConfidence(0)).toBe(0.0);
      expect(calculateConfidence(5)).toBe(0.0);
      expect(calculateConfidence(9)).toBe(0.0);
    });

    it('should return >0 for sample sizes at or above MIN_SAMPLE_SIZE', () => {
      expect(calculateConfidence(10)).toBeGreaterThan(0);
      expect(calculateConfidence(20)).toBeGreaterThan(0);
    });

    it('should return 1.0 for sample size of 100', () => {
      expect(calculateConfidence(100)).toBeCloseTo(1.0, 2);
    });

    it('should cap at 1.0 for large sample sizes', () => {
      expect(calculateConfidence(1000)).toBe(1.0);
      expect(calculateConfidence(10000)).toBe(1.0);
    });

    it('should be monotonically increasing', () => {
      const c10 = calculateConfidence(10);
      const c50 = calculateConfidence(50);
      const c100 = calculateConfidence(100);

      expect(c50).toBeGreaterThan(c10);
      expect(c100).toBeGreaterThan(c50);
    });

    it('should be deterministic', () => {
      const result1 = calculateConfidence(50);
      const result2 = calculateConfidence(50);
      expect(result1).toBe(result2);
    });
  });

  describe('calculateProviderScore', () => {
    beforeEach(async () => {
      // Clean up test data
      await prisma.approvalDecision.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
      await prisma.artifactApproval.deleteMany({
        where: { id: { startsWith: 'test-approval-' } },
      });
      await prisma.artifact.deleteMany({
        where: { id: { startsWith: 'test-artifact-' } },
      });
      await prisma.executionRequest.deleteMany({
        where: { id: { startsWith: 'test-exec-' } },
      });
      await prisma.providerPerformanceMetrics.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
    });

    afterEach(async () => {
      // Clean up test data
      await prisma.approvalDecision.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
      await prisma.artifactApproval.deleteMany({
        where: { id: { startsWith: 'test-approval-' } },
      });
      await prisma.artifact.deleteMany({
        where: { id: { startsWith: 'test-artifact-' } },
      });
      await prisma.executionRequest.deleteMany({
        where: { id: { startsWith: 'test-exec-' } },
      });
      await prisma.providerPerformanceMetrics.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
    });

    it('should return zero score for insufficient sample size', async () => {
      // Create only 5 decisions (below MIN_SAMPLE_SIZE of 10)
      const now = new Date();
      const timestamp = Date.now();
      const executionId = `test-exec-${timestamp}`;
      const workspaceId = TEST_WORKSPACE_ID;

      // Need to create execution request first (for foreign key)
      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          status: 'COMPLETED',
          idempotencyKey: `test-idem-${timestamp}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      // Create 5 decisions (below MIN_SAMPLE_SIZE of 10)
      for (let i = 0; i < 5; i++) {
        const artifactId = `test-artifact-${timestamp}-${i}`;
        const approvalId = `test-approval-${timestamp}-${i}`;

        // Create Artifact first
        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId,
            nodeId: `node-${i}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-1',
          },
        });

        // Create ArtifactApproval
        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision: 'APPROVED',
          },
        });

        // Create ApprovalDecision
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-${timestamp}-${i}`,
            approvalId,
            artifactId,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-1',
            decision: 'APPROVED',
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: now,
          },
        });
      }

      const result = await calculateProviderScore('test-provider-1', 'GENERATE_HOOKS');

      expect(result.score).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.sampleSize).toBe(5);
    });

    it('should calculate score with sufficient approval data', async () => {
      const now = new Date();
      const timestamp = Date.now();
      const executionId = `test-exec-${timestamp}`;
      const workspaceId = TEST_WORKSPACE_ID;

      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          status: 'COMPLETED',
          idempotencyKey: `test-idem-${timestamp}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      // Create 15 decisions (10 approved, 5 rejected)
      const decisions = [
        ...Array.from({ length: 10 }, (_, i) => ({
          decision: 'APPROVED',
          index: i,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          decision: 'REJECTED',
          index: 10 + i,
        })),
      ];

      for (const { decision, index } of decisions) {
        const artifactId = `test-artifact-approved-${timestamp}-${index}`;
        const approvalId = `test-approval-approved-${timestamp}-${index}`;

        // Create Artifact
        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId,
            nodeId: `node-${index}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-2',
          },
        });

        // Create ArtifactApproval
        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision,
          },
        });

        // Create ApprovalDecision
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-approved-${timestamp}-${index}`,
            approvalId,
            artifactId,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-2',
            decision,
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: now,
          },
        });
      }

      const result = await calculateProviderScore('test-provider-2', 'GENERATE_HOOKS');

      expect(result.score).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.sampleSize).toBe(15);
      expect(result.breakdown.approvalRate).toBeGreaterThan(0);
      expect(result.breakdown.costEfficiency).toBeGreaterThan(0);
    });

    it('should apply recency weighting (recent data weighs more)', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const timestamp = Date.now();
      const executionId = `test-exec-${timestamp}`;
      const workspaceId = TEST_WORKSPACE_ID;

      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          status: 'COMPLETED',
          idempotencyKey: `test-idem-${timestamp}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      // Create 10 old REJECTED decisions
      for (let i = 0; i < 10; i++) {
        const artifactId = `test-artifact-old-${timestamp}-${i}`;
        const approvalId = `test-approval-old-${timestamp}-${i}`;

        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId,
            nodeId: `node-old-${i}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-3',
          },
        });

        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision: 'REJECTED',
          },
        });

        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-old-${timestamp}-${i}`,
            approvalId,
            artifactId,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-3',
            decision: 'REJECTED',
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: oldDate,
          },
        });
      }

      // Create 10 recent APPROVED decisions
      for (let i = 0; i < 10; i++) {
        const artifactId = `test-artifact-new-${timestamp}-${i}`;
        const approvalId = `test-approval-new-${timestamp}-${i}`;

        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId,
            nodeId: `node-new-${i}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-3',
          },
        });

        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision: 'APPROVED',
          },
        });

        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-new-${timestamp}-${i}`,
            approvalId,
            artifactId,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-3',
            decision: 'APPROVED',
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: now,
          },
        });
      }

      const result = await calculateProviderScore('test-provider-3', 'GENERATE_HOOKS');

      // Recent approvals should outweigh old rejections due to decay
      // Approval rate should be >50% even though raw count is 50/50
      expect(result.breakdown.approvalRate).toBeGreaterThan(50);
    });

    it('should be deterministic (same data → same score)', async () => {
      const now = new Date();
      const timestamp = Date.now();
      const executionId = `test-exec-${timestamp}`;
      const workspaceId = TEST_WORKSPACE_ID;

      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          status: 'COMPLETED',
          idempotencyKey: `test-idem-${timestamp}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 15; i++) {
        const artifactId = `test-artifact-${timestamp}-${i}`;
        const approvalId = `test-approval-${timestamp}-${i}`;

        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId,
            nodeId: `node-${i}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-4',
          },
        });

        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision: 'APPROVED',
          },
        });

        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-${timestamp}-${i}`,
            approvalId,
            artifactId,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-4',
            decision: 'APPROVED',
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: now,
          },
        });
      }

      const result1 = await calculateProviderScore('test-provider-4', 'GENERATE_HOOKS');
      const result2 = await calculateProviderScore('test-provider-4', 'GENERATE_HOOKS');

      expect(result1.score).toBe(result2.score);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.sampleSize).toBe(result2.sampleSize);
    });
  });

  describe('calculateAllProviderScores', () => {
    beforeEach(async () => {
      await prisma.approvalDecision.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
      await prisma.artifactApproval.deleteMany({
        where: { id: { startsWith: 'test-approval-' } },
      });
      await prisma.artifact.deleteMany({
        where: { id: { startsWith: 'test-artifact-' } },
      });
      await prisma.executionRequest.deleteMany({
        where: { id: { startsWith: 'test-exec-' } },
      });
    });

    afterEach(async () => {
      await prisma.approvalDecision.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
      await prisma.artifactApproval.deleteMany({
        where: { id: { startsWith: 'test-approval-' } },
      });
      await prisma.artifact.deleteMany({
        where: { id: { startsWith: 'test-artifact-' } },
      });
      await prisma.executionRequest.deleteMany({
        where: { id: { startsWith: 'test-exec-' } },
      });
    });

    it('should return scores for all providers with data', async () => {
      const now = new Date();
      const workspaceId = TEST_WORKSPACE_ID;
      const timestamp = Date.now();

      // Create data for two providers
      for (const provider of ['test-provider-a', 'test-provider-b']) {
        const executionId = `test-exec-${provider}-${timestamp}`;

        await prisma.executionRequest.create({
          data: {
            id: executionId,
            workspaceId,
            status: 'COMPLETED',
            idempotencyKey: `test-idem-${timestamp}-${provider}-${Math.random()}`,
            actionType: 'GENERATE_HOOKS',
            targetId: 'test-target-id',
          },
        });

        for (let i = 0; i < 15; i++) {
          const artifactId = `test-artifact-${provider}-${timestamp}-${i}`;
          const approvalId = `test-approval-${provider}-${timestamp}-${i}`;

          await prisma.artifact.create({
            data: {
              id: artifactId,
              workspaceId,
              executionId,
              nodeId: `node-${provider}-${i}`,
              nodeType: 'GENERATION',
              type: 'hook',
              storageKey: `test/artifact/${artifactId}`,
              capability: 'GENERATE_HOOKS',
              provider,
            },
          });

          await prisma.artifactApproval.create({
            data: {
              id: approvalId,
              artifactId,
              workspaceId,
              status: 'COMPLETED',
              decision: 'APPROVED',
            },
          });

          await prisma.approvalDecision.create({
            data: {
              id: `test-decision-${provider}-${timestamp}-${i}`,
              approvalId,
              artifactId,
              executionId,
              workspaceId,
              capability: 'GENERATE_HOOKS',
              provider,
              decision: 'APPROVED',
              reviewerId: TEST_REVIEWER_ID,
              reviewedAt: now,
            },
          });
        }
      }

      const results = await calculateAllProviderScores('GENERATE_HOOKS');

      expect(results).toHaveLength(2);
      expect(results[0].provider).toBeTruthy();
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should sort by score descending', async () => {
      const now = new Date();
      const workspaceId = TEST_WORKSPACE_ID;
      const timestamp = Date.now();

      // Provider A: high approval rate
      const execA = `test-exec-a-${timestamp}`;
      await prisma.executionRequest.create({
        data: {
          id: execA,
          workspaceId,
          status: 'COMPLETED',
          idempotencyKey: `test-idem-${timestamp}-a-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 15; i++) {
        const artifactId = `test-artifact-high-${timestamp}-${i}`;
        const approvalId = `test-approval-high-${timestamp}-${i}`;

        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId: execA,
            nodeId: `node-high-${i}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-high',
          },
        });

        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision: 'APPROVED',
          },
        });

        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-high-${timestamp}-${i}`,
            approvalId,
            artifactId,
            executionId: execA,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-high',
            decision: 'APPROVED',
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: now,
          },
        });
      }

      // Provider B: low approval rate
      const execB = `test-exec-b-${timestamp}`;
      await prisma.executionRequest.create({
        data: {
          id: execB,
          workspaceId,
          status: 'COMPLETED',
          idempotencyKey: `test-idem-${timestamp}-b-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 10; i++) {
        const artifactId = `test-artifact-low-${timestamp}-${i}`;
        const approvalId = `test-approval-low-${timestamp}-${i}`;

        const decision = i < 5 ? 'APPROVED' : 'REJECTED';

        await prisma.artifact.create({
          data: {
            id: artifactId,
            workspaceId,
            executionId: execB,
            nodeId: `node-low-${i}`,
            nodeType: 'GENERATION',
            type: 'hook',
            storageKey: `test/artifact/${artifactId}`,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-low',
          },
        });

        await prisma.artifactApproval.create({
          data: {
            id: approvalId,
            artifactId,
            workspaceId,
            status: 'COMPLETED',
            decision,
          },
        });

        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-low-${timestamp}-${i}`,
            approvalId,
            artifactId,
            executionId: execB,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-low',
            decision,
            reviewerId: TEST_REVIEWER_ID,
            reviewedAt: now,
          },
        });
      }

      const results = await calculateAllProviderScores('GENERATE_HOOKS');

      // High performer should be first
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  describe('CONSTANTS', () => {
    it('should export expected constants', () => {
      expect(CONSTANTS.DECAY_LAMBDA).toBe(0.023);
      expect(CONSTANTS.MIN_SAMPLE_SIZE).toBe(10);
      expect(CONSTANTS.CONFIDENCE_THRESHOLD).toBe(0.6);
      expect(CONSTANTS.METRIC_WEIGHTS).toBeDefined();
      expect(CONSTANTS.METRIC_WEIGHTS.approvalRate).toBe(0.35);
    });

    it('should have metric weights that sum to 1.0', () => {
      const sum = Object.values(CONSTANTS.METRIC_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    });
  });
});
