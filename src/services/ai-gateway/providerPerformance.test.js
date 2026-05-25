// ============================================================
// Provider Performance Tests — PR #38
// ============================================================
// Tests provider performance scoring based on approval analytics.
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Prisma client before module import
const mockFindMany = vi.fn();

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      approvalDecision = {
        findMany: mockFindMany,
      };
    },
  };
});

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks are set up
const { getProviderPerformance, getBestProvider, clearPerformanceCache } = await import('./providerPerformance.js');

describe('Provider Performance Scorer (PR #38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPerformanceCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getProviderPerformance', () => {
    it('should score providers based on approval rate', async () => {
      const mockDecisions = [
        // Claude: 4/5 approved (80%)
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'REJECTED' },

        // OpenAI: 2/4 approved (50%)
        { provider: 'openai', decision: 'APPROVED' },
        { provider: 'openai', decision: 'APPROVED' },
        { provider: 'openai', decision: 'REGENERATE' },
        { provider: 'openai', decision: 'REJECTED' },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const scores = await getProviderPerformance('GENERATE_HOOKS');

      expect(scores).toHaveLength(2);
      expect(scores[0].provider).toBe('claude'); // Higher approval rate
      expect(scores[0].approvalRate).toBe(80);
      expect(scores[0].total).toBe(5);

      expect(scores[1].provider).toBe('openai');
      expect(scores[1].approvalRate).toBe(50);
      expect(scores[1].total).toBe(4);
    });

    it('should calculate risk scores correctly', async () => {
      const mockDecisions = [
        // Claude: 1 rejection, 1 regen, 1 revision
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'REJECTED' },       // 3 points
        { provider: 'claude', decision: 'REGENERATE' },     // 2 points
        { provider: 'claude', decision: 'REQUEST_REVISION' }, // 1 point
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const scores = await getProviderPerformance('GENERATE_HOOKS');

      expect(scores[0].riskScore).toBe(1.5); // (3 + 2 + 1) / 4 = 1.5
    });

    it('should skip providers with insufficient sample size', async () => {
      const mockDecisions = [
        // Claude: 10 decisions (above minSampleSize)
        ...Array(8).fill({ provider: 'claude', decision: 'APPROVED' }),
        { provider: 'claude', decision: 'REJECTED' },
        { provider: 'claude', decision: 'REGENERATE' },

        // Higgsfield: 2 decisions (below minSampleSize=3)
        { provider: 'higgsfield', decision: 'APPROVED' },
        { provider: 'higgsfield', decision: 'APPROVED' },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const scores = await getProviderPerformance('GENERATE_VISUAL_BRIEF', {
        minSampleSize: 3,
      });

      expect(scores).toHaveLength(1);
      expect(scores[0].provider).toBe('claude');
    });

    it('should calculate confidence based on sample size', async () => {
      const mockDecisions = [
        // Claude: 100 decisions (high confidence)
        ...Array(100).fill({ provider: 'claude', decision: 'APPROVED' }),

        // OpenAI: 10 decisions (lower confidence)
        ...Array(10).fill({ provider: 'openai', decision: 'APPROVED' }),
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const scores = await getProviderPerformance('GENERATE_HOOKS');

      expect(scores[0].confidence).toBeGreaterThan(scores[1].confidence);
    });

    it('should filter by workspaceId when provided', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await getProviderPerformance('GENERATE_HOOKS', {
        workspaceId: 'ws-123',
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: 'ws-123',
          }),
        })
      );
    });

    it('should filter by date range', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const startDate = new Date('2026-05-01');
      const endDate = new Date('2026-05-25');

      await getProviderPerformance('GENERATE_HOOKS', {
        startDate,
        endDate,
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reviewedAt: {
              gte: startDate,
              lte: endDate,
            },
          }),
        })
      );
    });

    it('should cache results for 5 minutes', async () => {
      const mockDecisions = [
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'APPROVED' },
        { provider: 'claude', decision: 'APPROVED' },
      ];

      mockFindMany.mockResolvedValue(mockDecisions);

      // First call - should hit DB
      await getProviderPerformance('GENERATE_HOOKS');
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await getProviderPerformance('GENERATE_HOOKS');
      expect(mockFindMany).toHaveBeenCalledTimes(1); // Still 1 (cache hit)

      // Clear cache and call again - should hit DB
      clearPerformanceCache();
      await getProviderPerformance('GENERATE_HOOKS');
      expect(mockFindMany).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no decisions exist', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const scores = await getProviderPerformance('GENERATE_HOOKS');

      expect(scores).toEqual([]);
    });

    it('should handle providers with only rejections', async () => {
      const mockDecisions = [
        { provider: 'claude', decision: 'REJECTED' },
        { provider: 'claude', decision: 'REJECTED' },
        { provider: 'claude', decision: 'REGENERATE' },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const scores = await getProviderPerformance('GENERATE_HOOKS');

      expect(scores[0].approvalRate).toBe(0);
      expect(scores[0].riskScore).toBeGreaterThan(2); // High risk
    });
  });

  describe('getBestProvider', () => {
    it('should return the best-performing provider', async () => {
      const mockDecisions = [
        ...Array(4).fill({ provider: 'claude', decision: 'APPROVED' }),
        { provider: 'claude', decision: 'REJECTED' },
        { provider: 'openai', decision: 'APPROVED' },
        ...Array(3).fill({ provider: 'openai', decision: 'REJECTED' }),
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const best = await getBestProvider('GENERATE_HOOKS');

      expect(best).toBeDefined();
      expect(best.provider).toBe('claude');
      expect(best.score.approvalRate).toBe(80);
      expect(best.reason).toContain('80% approval rate');
    });

    it('should return null when no performance data exists', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const best = await getBestProvider('GENERATE_HOOKS');

      expect(best).toBeNull();
    });

    it('should include confidence in reason', async () => {
      const mockDecisions = [
        ...Array(10).fill({ provider: 'claude', decision: 'APPROVED' }),
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const best = await getBestProvider('GENERATE_HOOKS');

      expect(best.reason).toContain('10 decisions');
      expect(best.reason).toMatch(/\d+% confidence/);
    });
  });
});
