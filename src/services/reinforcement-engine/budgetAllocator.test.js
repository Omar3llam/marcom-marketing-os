// ============================================================
// Budget Allocator Tests — PR #42
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateRecommendations,
  calculateBudgetAllocation,
  detectOscillation,
  CONSTRAINTS,
} from './budgetAllocator.js';
import { saveSnapshot } from './memoryManager.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('budgetAllocator', () => {
  beforeEach(async () => {
    await prisma.reinforcementSnapshot.deleteMany({
      where: { provider: { startsWith: 'test-' } },
    });
  });

  afterEach(async () => {
    await prisma.reinforcementSnapshot.deleteMany({
      where: { provider: { startsWith: 'test-' } },
    });
  });

  describe('generateRecommendations', () => {
    it('should return empty array when no snapshots exist', async () => {
      const recommendations = await generateRecommendations('NONEXISTENT_CAPABILITY');

      expect(recommendations).toEqual([]);
    });

    it('should return empty array when no snapshots meet confidence threshold', async () => {
      // Create snapshot with low confidence
      await saveSnapshot({
        provider: 'test-provider-1',
        capability: 'GENERATE_HOOKS',
        score: 80,
        confidence: 0.5, // Below default threshold of 0.7
        sampleSize: 50,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const recommendations = await generateRecommendations('GENERATE_HOOKS');

      expect(recommendations).toEqual([]);
    });

    it('should generate recommendations based on scores', async () => {
      // Create high and low performing providers
      await saveSnapshot({
        provider: 'test-provider-high',
        capability: 'GENERATE_HOOKS',
        score: 90,
        confidence: 0.9,
        sampleSize: 150,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      await saveSnapshot({
        provider: 'test-provider-low',
        capability: 'GENERATE_HOOKS',
        score: 60,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const currentWeights = {
        'test-provider-high': 0.5,
        'test-provider-low': 0.5,
      };

      const recommendations = await generateRecommendations('GENERATE_HOOKS', currentWeights);

      expect(recommendations).toHaveLength(2);

      const highRec = recommendations.find(r => r.provider === 'test-provider-high');
      const lowRec = recommendations.find(r => r.provider === 'test-provider-low');

      // High performer should get more weight
      expect(highRec.recommendedWeight).toBeGreaterThan(highRec.currentWeight);
      // Low performer should get less weight
      expect(lowRec.recommendedWeight).toBeLessThan(lowRec.currentWeight);
    });

    it('should respect maxWeightChange constraint', async () => {
      await saveSnapshot({
        provider: 'test-provider-2',
        capability: 'GENERATE_HOOKS',
        score: 95,
        confidence: 0.95,
        sampleSize: 200,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const currentWeights = {
        'test-provider-2': 0.1,
      };

      const recommendations = await generateRecommendations('GENERATE_HOOKS', currentWeights, {
        maxWeightChange: 0.1, // Max 10% change
      });

      const rec = recommendations[0];

      // Change should not exceed maxWeightChange
      expect(Math.abs(rec.scoreChange)).toBeLessThanOrEqual(0.1);
    });

    it('should respect minProviderWeight constraint', async () => {
      await saveSnapshot({
        provider: 'test-provider-3',
        capability: 'GENERATE_HOOKS',
        score: 30,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const currentWeights = {
        'test-provider-3': 0.5,
      };

      const recommendations = await generateRecommendations('GENERATE_HOOKS', currentWeights, {
        minProviderWeight: 0.1, // Min 10%
      });

      const rec = recommendations[0];

      // Should not go below min
      expect(rec.recommendedWeight).toBeGreaterThanOrEqual(0.1);
    });

    it('should normalize weights to sum to 1.0', async () => {
      for (let i = 0; i < 3; i++) {
        await saveSnapshot({
          provider: `test-provider-norm-${i}`,
          capability: 'GENERATE_HOOKS',
          score: 70 + i * 10,
          confidence: 0.85,
          sampleSize: 120,
          windowStart: new Date('2026-01-01'),
          windowEnd: new Date('2026-02-01'),
        });
      }

      const currentWeights = {
        'test-provider-norm-0': 0.33,
        'test-provider-norm-1': 0.33,
        'test-provider-norm-2': 0.34,
      };

      const recommendations = await generateRecommendations('GENERATE_HOOKS', currentWeights);

      const totalWeight = recommendations.reduce((sum, r) => sum + r.recommendedWeight, 0);

      expect(totalWeight).toBeCloseTo(1.0, 2);
    });

    it('should sort recommendations by absolute score change', async () => {
      await saveSnapshot({
        provider: 'test-provider-big-change',
        capability: 'GENERATE_HOOKS',
        score: 95,
        confidence: 0.9,
        sampleSize: 150,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      await saveSnapshot({
        provider: 'test-provider-small-change',
        capability: 'GENERATE_HOOKS',
        score: 75,
        confidence: 0.85,
        sampleSize: 120,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const currentWeights = {
        'test-provider-big-change': 0.2,
        'test-provider-small-change': 0.8,
      };

      const recommendations = await generateRecommendations('GENERATE_HOOKS', currentWeights);

      // First recommendation should be the one with largest change
      expect(Math.abs(recommendations[0].scoreChange)).toBeGreaterThan(
        Math.abs(recommendations[1].scoreChange)
      );
    });

    it('should be deterministic (same inputs → same outputs)', async () => {
      await saveSnapshot({
        provider: 'test-provider-det',
        capability: 'GENERATE_HOOKS',
        score: 80,
        confidence: 0.85,
        sampleSize: 130,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const currentWeights = {
        'test-provider-det': 0.5,
      };

      const recs1 = await generateRecommendations('GENERATE_HOOKS', currentWeights);
      const recs2 = await generateRecommendations('GENERATE_HOOKS', currentWeights);

      expect(recs1[0].recommendedWeight).toBe(recs2[0].recommendedWeight);
    });
  });

  describe('calculateBudgetAllocation', () => {
    it('should throw error for invalid totalBudget', () => {
      expect(() => calculateBudgetAllocation(0, {}, {})).toThrow('Invalid totalBudget');
      expect(() => calculateBudgetAllocation(-100, {}, {})).toThrow('Invalid totalBudget');
    });

    it('should allocate budget proportional to weighted cost', () => {
      const totalBudget = 1000;
      const trafficWeights = {
        'provider-a': 0.6,
        'provider-b': 0.4,
      };
      const providerCosts = {
        'provider-a': 0.05, // $0.05 per request
        'provider-b': 0.10, // $0.10 per request
      };

      const allocation = calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts);

      expect(allocation['provider-a'].budget).toBeGreaterThan(0);
      expect(allocation['provider-b'].budget).toBeGreaterThan(0);

      // Total should equal budget
      const totalAllocated = allocation['provider-a'].budget + allocation['provider-b'].budget;
      expect(totalAllocated).toBeCloseTo(totalBudget, 0);

      // Estimated requests should be budget / costPerRequest
      expect(allocation['provider-a'].estimatedRequests).toBeCloseTo(
        allocation['provider-a'].budget / 0.05,
        0
      );
    });

    it('should handle equal weights', () => {
      const totalBudget = 1000;
      const trafficWeights = {
        'provider-a': 0.5,
        'provider-b': 0.5,
      };
      const providerCosts = {
        'provider-a': 0.05,
        'provider-b': 0.05,
      };

      const allocation = calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts);

      // Equal weights + equal costs = equal budgets
      expect(allocation['provider-a'].budget).toBeCloseTo(allocation['provider-b'].budget, 0);
    });

    it('should use default cost if provider cost unknown', () => {
      const totalBudget = 1000;
      const trafficWeights = {
        'provider-unknown': 1.0,
      };
      const providerCosts = {}; // No cost info

      const allocation = calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts);

      expect(allocation['provider-unknown'].budget).toBe(1000);
      // Should use default $0.01 per request
      expect(allocation['provider-unknown'].estimatedRequests).toBe(100000);
    });

    it('should be deterministic', () => {
      const totalBudget = 1000;
      const trafficWeights = { 'provider-a': 0.6, 'provider-b': 0.4 };
      const providerCosts = { 'provider-a': 0.05, 'provider-b': 0.10 };

      const alloc1 = calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts);
      const alloc2 = calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts);

      expect(alloc1['provider-a'].budget).toBe(alloc2['provider-a'].budget);
      expect(alloc1['provider-b'].budget).toBe(alloc2['provider-b'].budget);
    });
  });

  describe('detectOscillation', () => {
    it('should return false for insufficient history', () => {
      const recentRecs = [
        { recommendations: [{ provider: 'p1', scoreChange: 0.1 }] },
      ];

      const oscillating = detectOscillation(recentRecs, { lookbackCount: 5 });

      expect(oscillating).toBe(false);
    });

    it('should detect oscillation (rapid reversals)', () => {
      const recentRecs = [
        { recommendations: [{ provider: 'p1', scoreChange: 0.3 }] },
        { recommendations: [{ provider: 'p1', scoreChange: -0.3 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.3 }] },
        { recommendations: [{ provider: 'p1', scoreChange: -0.3 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.3 }] },
      ];

      const oscillating = detectOscillation(recentRecs, { lookbackCount: 5 });

      expect(oscillating).toBe(true);
    });

    it('should not detect oscillation for consistent trend', () => {
      const recentRecs = [
        { recommendations: [{ provider: 'p1', scoreChange: 0.1 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.12 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.15 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.18 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.2 }] },
      ];

      const oscillating = detectOscillation(recentRecs, { lookbackCount: 5 });

      expect(oscillating).toBe(false);
    });

    it('should ignore small changes below reversalThreshold', () => {
      const recentRecs = [
        { recommendations: [{ provider: 'p1', scoreChange: 0.05 }] },
        { recommendations: [{ provider: 'p1', scoreChange: -0.05 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.05 }] },
        { recommendations: [{ provider: 'p1', scoreChange: -0.05 }] },
        { recommendations: [{ provider: 'p1', scoreChange: 0.05 }] },
      ];

      const oscillating = detectOscillation(recentRecs, {
        lookbackCount: 5,
        reversalThreshold: 0.2, // Changes are below threshold
      });

      expect(oscillating).toBe(false);
    });

    it('should handle multiple providers independently', () => {
      const recentRecs = [
        {
          recommendations: [
            { provider: 'p1', scoreChange: 0.3 },
            { provider: 'p2', scoreChange: 0.1 },
          ],
        },
        {
          recommendations: [
            { provider: 'p1', scoreChange: -0.3 },
            { provider: 'p2', scoreChange: 0.12 },
          ],
        },
        {
          recommendations: [
            { provider: 'p1', scoreChange: 0.3 },
            { provider: 'p2', scoreChange: 0.15 },
          ],
        },
        {
          recommendations: [
            { provider: 'p1', scoreChange: -0.3 },
            { provider: 'p2', scoreChange: 0.18 },
          ],
        },
        {
          recommendations: [
            { provider: 'p1', scoreChange: 0.3 },
            { provider: 'p2', scoreChange: 0.2 },
          ],
        },
      ];

      const oscillating = detectOscillation(recentRecs, { lookbackCount: 5 });

      // p1 oscillates, p2 doesn't, but if ANY provider oscillates → true
      expect(oscillating).toBe(true);
    });
  });

  describe('CONSTRAINTS', () => {
    it('should export expected constants', () => {
      expect(CONSTRAINTS.MAX_WEIGHT_CHANGE_PER_DAY).toBe(0.15);
      expect(CONSTRAINTS.MIN_PROVIDER_WEIGHT).toBe(0.05);
      expect(CONSTRAINTS.MAX_PROVIDER_WEIGHT).toBe(0.70);
      expect(CONSTRAINTS.REALLOCATION_CONFIDENCE_THRESHOLD).toBe(0.7);
    });
  });
});
