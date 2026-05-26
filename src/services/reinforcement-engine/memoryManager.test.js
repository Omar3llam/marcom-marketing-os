// ============================================================
// Memory Manager Tests — PR #42
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveSnapshot,
  getSnapshotHistory,
  getLatestSnapshot,
  getLatestSnapshotsForCapability,
  calculateScoreTrend,
  getCapabilityStats,
} from './memoryManager.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('memoryManager', () => {
  beforeEach(async () => {
    // Clean up test snapshots
    await prisma.reinforcementSnapshot.deleteMany({
      where: { provider: { startsWith: 'test-' } },
    });
  });

  afterEach(async () => {
    await prisma.reinforcementSnapshot.deleteMany({
      where: { provider: { startsWith: 'test-' } },
    });
  });

  describe('saveSnapshot', () => {
    it('should save a valid snapshot', async () => {
      const snapshot = {
        provider: 'test-provider-1',
        capability: 'GENERATE_HOOKS',
        score: 75.5,
        confidence: 0.85,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      };

      const result = await saveSnapshot(snapshot);

      expect(result.id).toBeTruthy();
      expect(result.provider).toBe('test-provider-1');
      expect(result.capability).toBe('GENERATE_HOOKS');
      expect(result.score).toBe(75.5);
      expect(result.confidence).toBe(0.85);
      expect(result.sampleSize).toBe(100);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should throw error for missing required fields', async () => {
      await expect(saveSnapshot({})).rejects.toThrow('provider and capability are required');
    });

    it('should throw error for invalid score', async () => {
      const snapshot = {
        provider: 'test-provider',
        capability: 'GENERATE_HOOKS',
        score: 150, // Invalid: > 100
        confidence: 0.85,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      };

      await expect(saveSnapshot(snapshot)).rejects.toThrow('Invalid score');
    });

    it('should throw error for invalid confidence', async () => {
      const snapshot = {
        provider: 'test-provider',
        capability: 'GENERATE_HOOKS',
        score: 75,
        confidence: 1.5, // Invalid: > 1.0
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      };

      await expect(saveSnapshot(snapshot)).rejects.toThrow('Invalid confidence');
    });

    it('should throw error if windowStart >= windowEnd', async () => {
      const snapshot = {
        provider: 'test-provider',
        capability: 'GENERATE_HOOKS',
        score: 75,
        confidence: 0.85,
        sampleSize: 100,
        windowStart: new Date('2026-02-01'),
        windowEnd: new Date('2026-01-01'), // Before start
      };

      await expect(saveSnapshot(snapshot)).rejects.toThrow('windowStart must be before windowEnd');
    });

    it('should support workspace scoping', async () => {
      const snapshot = {
        provider: 'test-provider',
        capability: 'GENERATE_HOOKS',
        score: 75,
        confidence: 0.85,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
        workspaceId: '00000000-0000-0000-0000-000000000001',
      };

      const result = await saveSnapshot(snapshot);

      expect(result.workspaceId).toBe('00000000-0000-0000-0000-000000000001');
    });
  });

  describe('getSnapshotHistory', () => {
    it('should return empty array when no snapshots exist', async () => {
      const history = await getSnapshotHistory('nonexistent-provider', 'GENERATE_HOOKS');

      expect(history).toEqual([]);
    });

    it('should return snapshots ordered by createdAt desc', async () => {
      // Create 3 snapshots with different timestamps
      for (let i = 0; i < 3; i++) {
        await saveSnapshot({
          provider: 'test-provider-2',
          capability: 'GENERATE_HOOKS',
          score: 70 + i,
          confidence: 0.8,
          sampleSize: 100,
          windowStart: new Date('2026-01-01'),
          windowEnd: new Date('2026-02-01'),
        });

        // Small delay to ensure different createdAt timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const history = await getSnapshotHistory('test-provider-2', 'GENERATE_HOOKS');

      expect(history).toHaveLength(3);
      // Newest first
      expect(history[0].score).toBe(72);
      expect(history[1].score).toBe(71);
      expect(history[2].score).toBe(70);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await saveSnapshot({
          provider: 'test-provider-3',
          capability: 'GENERATE_HOOKS',
          score: 70,
          confidence: 0.8,
          sampleSize: 100,
          windowStart: new Date('2026-01-01'),
          windowEnd: new Date('2026-02-01'),
        });
      }

      const history = await getSnapshotHistory('test-provider-3', 'GENERATE_HOOKS', { limit: 5 });

      expect(history).toHaveLength(5);
    });

    it('should filter by workspace', async () => {
      const workspace1 = '00000000-0000-0000-0000-000000000001';
      const workspace2 = '00000000-0000-0000-0000-000000000002';

      await saveSnapshot({
        provider: 'test-provider-4',
        capability: 'GENERATE_HOOKS',
        score: 70,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
        workspaceId: workspace1,
      });

      await saveSnapshot({
        provider: 'test-provider-4',
        capability: 'GENERATE_HOOKS',
        score: 80,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
        workspaceId: workspace2,
      });

      const history = await getSnapshotHistory('test-provider-4', 'GENERATE_HOOKS', {
        workspaceId: workspace1,
      });

      expect(history).toHaveLength(1);
      expect(history[0].workspaceId).toBe(workspace1);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return null when no snapshots exist', async () => {
      const latest = await getLatestSnapshot('nonexistent-provider', 'GENERATE_HOOKS');

      expect(latest).toBeNull();
    });

    it('should return the most recent snapshot', async () => {
      await saveSnapshot({
        provider: 'test-provider-5',
        capability: 'GENERATE_HOOKS',
        score: 70,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await saveSnapshot({
        provider: 'test-provider-5',
        capability: 'GENERATE_HOOKS',
        score: 85,
        confidence: 0.9,
        sampleSize: 150,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const latest = await getLatestSnapshot('test-provider-5', 'GENERATE_HOOKS');

      expect(latest).not.toBeNull();
      expect(latest.score).toBe(85);
    });
  });

  describe('getLatestSnapshotsForCapability', () => {
    it('should return one snapshot per provider', async () => {
      // Create multiple snapshots for two providers
      for (const provider of ['test-provider-a', 'test-provider-b']) {
        for (let i = 0; i < 3; i++) {
          await saveSnapshot({
            provider,
            capability: 'GENERATE_HOOKS',
            score: 70 + i,
            confidence: 0.8,
            sampleSize: 100,
            windowStart: new Date('2026-01-01'),
            windowEnd: new Date('2026-02-01'),
          });

          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const results = await getLatestSnapshotsForCapability('GENERATE_HOOKS');

      expect(results).toHaveLength(2);

      // Should return latest score for each provider (72)
      const providerA = results.find(r => r.provider === 'test-provider-a');
      const providerB = results.find(r => r.provider === 'test-provider-b');

      expect(providerA.score).toBe(72);
      expect(providerB.score).toBe(72);
    });
  });

  describe('calculateScoreTrend', () => {
    it('should return unknown for insufficient data', async () => {
      await saveSnapshot({
        provider: 'test-provider-6',
        capability: 'GENERATE_HOOKS',
        score: 70,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date('2026-01-01'),
        windowEnd: new Date('2026-02-01'),
      });

      const trend = await calculateScoreTrend('test-provider-6', 'GENERATE_HOOKS');

      expect(trend.trend).toBe('unknown');
      expect(trend.snapshots).toBe(1);
    });

    it('should detect improving trend', async () => {
      const now = new Date();

      // Old snapshot: low score
      await saveSnapshot({
        provider: 'test-provider-7',
        capability: 'GENERATE_HOOKS',
        score: 60,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        windowEnd: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Recent snapshot: high score
      await saveSnapshot({
        provider: 'test-provider-7',
        capability: 'GENERATE_HOOKS',
        score: 80,
        confidence: 0.9,
        sampleSize: 150,
        windowStart: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        windowEnd: now,
      });

      const trend = await calculateScoreTrend('test-provider-7', 'GENERATE_HOOKS');

      expect(trend.trend).toBe('improving');
      expect(trend.change).toBeGreaterThan(5);
    });

    it('should detect declining trend', async () => {
      const now = new Date();

      // Old snapshot: high score
      await saveSnapshot({
        provider: 'test-provider-8',
        capability: 'GENERATE_HOOKS',
        score: 80,
        confidence: 0.9,
        sampleSize: 150,
        windowStart: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        windowEnd: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Recent snapshot: low score
      await saveSnapshot({
        provider: 'test-provider-8',
        capability: 'GENERATE_HOOKS',
        score: 60,
        confidence: 0.8,
        sampleSize: 100,
        windowStart: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        windowEnd: now,
      });

      const trend = await calculateScoreTrend('test-provider-8', 'GENERATE_HOOKS');

      expect(trend.trend).toBe('declining');
      expect(trend.change).toBeLessThan(-5);
    });

    it('should detect stable trend', async () => {
      const now = new Date();

      for (let i = 0; i < 3; i++) {
        await saveSnapshot({
          provider: 'test-provider-9',
          capability: 'GENERATE_HOOKS',
          score: 75,
          confidence: 0.85,
          sampleSize: 120,
          windowStart: new Date(now.getTime() - (30 - i * 10) * 24 * 60 * 60 * 1000),
          windowEnd: new Date(now.getTime() - (20 - i * 10) * 24 * 60 * 60 * 1000),
        });

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const trend = await calculateScoreTrend('test-provider-9', 'GENERATE_HOOKS');

      expect(trend.trend).toBe('stable');
      expect(Math.abs(trend.change)).toBeLessThan(5);
    });
  });

  describe('getCapabilityStats', () => {
    it('should return zero stats when no snapshots exist', async () => {
      const stats = await getCapabilityStats('NONEXISTENT_CAPABILITY');

      expect(stats.providers).toBe(0);
      expect(stats.avgScore).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.totalSampleSize).toBe(0);
    });

    it('should calculate aggregate statistics', async () => {
      // Create latest snapshots for 3 providers
      for (let i = 0; i < 3; i++) {
        await saveSnapshot({
          provider: `test-provider-stats-${i}`,
          capability: 'GENERATE_HOOKS',
          score: 70 + i * 10, // 70, 80, 90
          confidence: 0.8,
          sampleSize: 100,
          windowStart: new Date('2026-01-01'),
          windowEnd: new Date('2026-02-01'),
        });
      }

      const stats = await getCapabilityStats('GENERATE_HOOKS');

      expect(stats.providers).toBe(3);
      expect(stats.avgScore).toBeCloseTo(80, 1); // (70+80+90)/3
      expect(stats.avgConfidence).toBe(0.8);
      expect(stats.totalSampleSize).toBe(300); // 3 providers × 100
    });
  });
});
