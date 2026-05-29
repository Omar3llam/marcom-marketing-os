// ============================================================
// Scoring Engine Tests — PR #42
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateDecayFactor,
  calculateConfidence,
  calculateProviderScore,
  calculateAllProviderScores,
  CONSTANTS,
} from './scoringEngine.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('scoringEngine', () => {
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
      await prisma.providerPerformanceMetrics.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
    });

    afterEach(async () => {
      // Clean up test data
      await prisma.approvalDecision.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
      await prisma.providerPerformanceMetrics.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
    });

    it('should return zero score for insufficient sample size', async () => {
      // Create only 5 decisions (below MIN_SAMPLE_SIZE of 10)
      const now = new Date();
      const executionId = `test-exec-${Date.now()}`;
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      // Need to create execution request first (for foreign key)
      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          capability: 'GENERATE_HOOKS',
          provider: 'test-provider-1',
          status: 'COMPLETED',
          requestedAt: now,
          idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 5; i++) {
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-${Date.now()}-${i}`,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-1',
            decision: 'APPROVED',
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
      const executionId = `test-exec-${Date.now()}`;
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          capability: 'GENERATE_HOOKS',
          provider: 'test-provider-2',
          status: 'COMPLETED',
          requestedAt: now,
          idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      // Create 15 decisions (10 approved, 5 rejected) using createMany
      const timestamp = Date.now();
      const approvedDecisions = Array.from({ length: 10 }, (_, i) => ({
        id: `test-decision-approved-${timestamp}-${i}`,
        executionId,
        workspaceId,
        capability: 'GENERATE_HOOKS',
        provider: 'test-provider-2',
        decision: 'APPROVED',
        reviewedAt: now,
        executionCost: 0.05,
      }));

      const rejectedDecisions = Array.from({ length: 5 }, (_, i) => ({
        id: `test-decision-rejected-${timestamp}-${i}`,
        executionId,
        workspaceId,
        capability: 'GENERATE_HOOKS',
        provider: 'test-provider-2',
        decision: 'REJECTED',
        reviewedAt: now,
        executionCost: 0.05,
      }));

      await prisma.approvalDecision.createMany({
        data: [...approvedDecisions, ...rejectedDecisions],
      });

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
      const executionId = `test-exec-${Date.now()}`;
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          capability: 'GENERATE_HOOKS',
          provider: 'test-provider-3',
          status: 'COMPLETED',
          requestedAt: now,
          idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      // Create 10 old REJECTED decisions
      for (let i = 0; i < 10; i++) {
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-old-${Date.now()}-${i}`,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-3',
            decision: 'REJECTED',
            reviewedAt: oldDate,
            executionCost: 0.05,
          },
        });
      }

      // Create 10 recent APPROVED decisions
      for (let i = 0; i < 10; i++) {
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-new-${Date.now()}-${i}`,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-3',
            decision: 'APPROVED',
            reviewedAt: now,
            executionCost: 0.05,
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
      const executionId = `test-exec-${Date.now()}`;
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      await prisma.executionRequest.create({
        data: {
          id: executionId,
          workspaceId,
          capability: 'GENERATE_HOOKS',
          provider: 'test-provider-4',
          status: 'COMPLETED',
          requestedAt: now,
          idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 15; i++) {
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-${Date.now()}-${i}`,
            executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-4',
            decision: 'APPROVED',
            reviewedAt: now,
            executionCost: 0.05,
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
    });

    afterEach(async () => {
      await prisma.approvalDecision.deleteMany({
        where: { provider: { startsWith: 'test-' } },
      });
    });

    it('should return scores for all providers with data', async () => {
      const now = new Date();
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      // Create data for two providers
      for (const provider of ['test-provider-a', 'test-provider-b']) {
        const executionId = `test-exec-${provider}-${Date.now()}`;

        await prisma.executionRequest.create({
          data: {
            id: executionId,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider,
            status: 'COMPLETED',
            requestedAt: now,
            idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
            actionType: 'GENERATE_HOOKS',
            targetId: 'test-target-id',
          },
        });

        for (let i = 0; i < 15; i++) {
          await prisma.approvalDecision.create({
            data: {
              id: `test-decision-${provider}-${Date.now()}-${i}`,
              executionId,
              workspaceId,
              capability: 'GENERATE_HOOKS',
              provider,
              decision: 'APPROVED',
              reviewedAt: now,
              executionCost: 0.05,
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
      const workspaceId = '00000000-0000-0000-0000-000000000001';

      // Provider A: high approval rate
      const execA = `test-exec-a-${Date.now()}`;
      await prisma.executionRequest.create({
        data: {
          id: execA,
          workspaceId,
          capability: 'GENERATE_HOOKS',
          provider: 'test-provider-high',
          status: 'COMPLETED',
          requestedAt: now,
          idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 15; i++) {
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-high-${Date.now()}-${i}`,
            executionId: execA,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-high',
            decision: 'APPROVED',
            reviewedAt: now,
            executionCost: 0.05,
          },
        });
      }

      // Provider B: low approval rate
      const execB = `test-exec-b-${Date.now()}`;
      await prisma.executionRequest.create({
        data: {
          id: execB,
          workspaceId,
          capability: 'GENERATE_HOOKS',
          provider: 'test-provider-low',
          status: 'COMPLETED',
          requestedAt: now,
          idempotencyKey: `test-idem-${Date.now()}-${Math.random()}`,
          actionType: 'GENERATE_HOOKS',
          targetId: 'test-target-id',
        },
      });

      for (let i = 0; i < 10; i++) {
        await prisma.approvalDecision.create({
          data: {
            id: `test-decision-low-${Date.now()}-${i}`,
            executionId: execB,
            workspaceId,
            capability: 'GENERATE_HOOKS',
            provider: 'test-provider-low',
            decision: i < 5 ? 'APPROVED' : 'REJECTED',
            reviewedAt: now,
            executionCost: 0.05,
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
