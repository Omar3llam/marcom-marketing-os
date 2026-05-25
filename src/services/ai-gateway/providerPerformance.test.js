// ============================================================
// Provider Performance Tests — PR #38
// ============================================================
// Tests provider performance scoring based on approval analytics.
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Prisma client before module import
const mockFindMany = vi.fn();
const mockGroupBy = vi.fn();

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      approvalDecision = {
        findMany: mockFindMany,
      };
      providerPerformanceMetrics = {
        groupBy: mockGroupBy,
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

// Mock cost calculations (PR #40)
vi.mock('./providerCosts.js', () => ({
  calculateExecutionCost: vi.fn((provider, capability) => {
    // Return mock costs for testing
    if (provider === 'claude') return 0.0195;
    if (provider === 'openai') return 0.0143;
    return 0.01;
  }),
  calculateCostPerApproval: vi.fn((provider, capability, approvalRate) => {
    const executionCost = provider === 'claude' ? 0.0195 : 0.0143;
    if (approvalRate === 0) return null;
    return executionCost / (approvalRate / 100);
  }),
}));

// Import after mocks are set up
const {
  getProviderPerformance,
  getBestProvider,
  getProviderRealPerformance,
  clearPerformanceCache,
} = await import('./providerPerformance.js');

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

      // Use fixed dates to ensure cache key remains the same
      const startDate = new Date('2026-05-01');
      const endDate = new Date('2026-05-25');

      mockFindMany.mockResolvedValue(mockDecisions);

      // First call - should hit DB
      await getProviderPerformance('GENERATE_HOOKS', { startDate, endDate });
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await getProviderPerformance('GENERATE_HOOKS', { startDate, endDate });
      expect(mockFindMany).toHaveBeenCalledTimes(1); // Still 1 (cache hit)

      // Clear cache and call again - should hit DB
      clearPerformanceCache();
      await getProviderPerformance('GENERATE_HOOKS', { startDate, endDate });
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

  // ============================================================
  // PR #41 — Real Performance Tests
  // ============================================================

  describe('getProviderRealPerformance (PR #41)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      clearPerformanceCache();
    });

    it('should combine approval rate + cost + real performance', async () => {
      // Mock approval decisions (for base performance)
      const mockDecisions = [
        ...Array(9).fill({ provider: 'claude', decision: 'APPROVED' }),
        { provider: 'claude', decision: 'REJECTED' },
      ];
      mockFindMany.mockResolvedValueOnce(mockDecisions);

      // Mock real performance metrics
      const mockRealMetrics = [
        {
          provider: 'claude',
          capability: 'GENERATE_HOOKS',
          _avg: {
            ctr: 4.5,  // 4.5% CTR
            cpc: 0.30,
            roas: 2.8, // 2.8x ROAS
          },
          _sum: {
            impressions: 10000,
            clicks: 450,
            spend: 135,
            revenue: 378,
          },
          _count: { id: 5 },
        },
      ];
      mockGroupBy.mockResolvedValueOnce(mockRealMetrics);

      const results = await getProviderRealPerformance('GENERATE_HOOKS', {
        workspaceId: 'test-workspace',
      });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].provider).toBe('claude');
      expect(results[0].hasRealData).toBe(true);
      expect(results[0].ctr).toBe(4.5);
      expect(results[0].roas).toBe(2.8);
      expect(results[0].performanceScore).toBeGreaterThan(0);
      expect(results[0].finalScore).toBeGreaterThan(0);
    });

    it('should handle providers without real data', async () => {
      const mockDecisions = [
        ...Array(8).fill({ provider: 'claude', decision: 'APPROVED' }),
        ...Array(2).fill({ provider: 'claude', decision: 'REJECTED' }),
      ];
      mockFindMany.mockResolvedValueOnce(mockDecisions);

      // No real performance data
      mockGroupBy.mockResolvedValueOnce([]);

      const results = await getProviderRealPerformance('GENERATE_HOOKS', {
        workspaceId: 'test-workspace',
      });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].hasRealData).toBe(false);
      expect(results[0].ctr).toBeNull();
      expect(results[0].performanceScore).toBe(0);
      expect(results[0].finalScore).toEqual(results[0].valueScore); // Falls back to cost-quality score
    });

    it('should require workspaceId for real performance', async () => {
      const results = await getProviderRealPerformance('GENERATE_HOOKS', {
        // Missing workspaceId
      });

      expect(results).toEqual([]);
      expect(mockGroupBy).not.toHaveBeenCalled();
    });

    it('should calculate performance score from CTR and ROAS', async () => {
      const mockDecisions = [
        ...Array(10).fill({ provider: 'openai', decision: 'APPROVED' }),
      ];
      mockFindMany.mockResolvedValueOnce(mockDecisions);

      // High CTR, high ROAS
      const mockRealMetrics = [
        {
          provider: 'openai',
          capability: 'GENERATE_CAPTIONS',
          _avg: {
            ctr: 8.0,   // 8% CTR
            cpc: 0.20,
            roas: 5.0,  // 5x ROAS
          },
          _sum: {
            impressions: 5000,
            clicks: 400,
            spend: 80,
            revenue: 400,
          },
          _count: { id: 3 },
        },
      ];
      mockGroupBy.mockResolvedValueOnce(mockRealMetrics);

      const results = await getProviderRealPerformance('GENERATE_CAPTIONS', {
        workspaceId: 'test-workspace',
      });

      expect(results[0].performanceScore).toBeGreaterThan(50); // Should be high
      expect(results[0].ctr).toBe(8.0);
      expect(results[0].roas).toBe(5.0);
    });

    it('should sort by final score (approval + cost + performance)', async () => {
      const mockDecisions = [
        // Claude: 80% approval
        ...Array(8).fill({ provider: 'claude', decision: 'APPROVED' }),
        ...Array(2).fill({ provider: 'claude', decision: 'REJECTED' }),
        // OpenAI: 90% approval
        ...Array(9).fill({ provider: 'openai', decision: 'APPROVED' }),
        { provider: 'openai', decision: 'REJECTED' },
      ];
      mockFindMany.mockResolvedValueOnce(mockDecisions);

      // Claude has better real performance despite lower approval
      const mockRealMetrics = [
        {
          provider: 'claude',
          capability: 'GENERATE_HOOKS',
          _avg: { ctr: 6.0, cpc: 0.25, roas: 4.0 },
          _sum: { impressions: 5000, clicks: 300, spend: 75, revenue: 300 },
          _count: { id: 5 },
        },
        {
          provider: 'openai',
          capability: 'GENERATE_HOOKS',
          _avg: { ctr: 3.0, cpc: 0.30, roas: 2.0 },
          _sum: { impressions: 4000, clicks: 120, spend: 36, revenue: 72 },
          _count: { id: 3 },
        },
      ];
      mockGroupBy.mockResolvedValueOnce(mockRealMetrics);

      const results = await getProviderRealPerformance('GENERATE_HOOKS', {
        workspaceId: 'test-workspace',
      });

      // Should be sorted by final score
      expect(results[0].finalScore).toBeGreaterThanOrEqual(results[1]?.finalScore || 0);
    });
  });

  describe('getBestProvider with real performance (PR #41)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      clearPerformanceCache();
    });

    it('should use real performance when optimizeForRealPerformance=true', async () => {
      const mockDecisions = [
        ...Array(9).fill({ provider: 'claude', decision: 'APPROVED' }),
        { provider: 'claude', decision: 'REJECTED' },
      ];
      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const mockRealMetrics = [
        {
          provider: 'claude',
          capability: 'GENERATE_HOOKS',
          _avg: { ctr: 5.0, cpc: 0.25, roas: 3.5 },
          _sum: { impressions: 10000, clicks: 500, spend: 125, revenue: 437.5 },
          _count: { id: 5 },
        },
      ];
      mockGroupBy.mockResolvedValueOnce(mockRealMetrics);

      const best = await getBestProvider('GENERATE_HOOKS', {
        workspaceId: 'test-workspace',
        optimizeForRealPerformance: true,
      });

      expect(best).toBeDefined();
      expect(best.provider).toBe('claude');
      expect(best.reason).toContain('CTR');
      expect(best.reason).toContain('ROAS');
      expect(best.reason).toContain('final score');
    });

    it('should fall back to cost-quality if no real data', async () => {
      const mockDecisions = [
        ...Array(9).fill({ provider: 'claude', decision: 'APPROVED' }),
        { provider: 'claude', decision: 'REJECTED' },
      ];
      mockFindMany.mockResolvedValueOnce(mockDecisions);
      mockFindMany.mockResolvedValueOnce(mockDecisions); // Called twice (once for real, once for fallback)

      // No real performance data
      mockGroupBy.mockResolvedValueOnce([]);

      const best = await getBestProvider('GENERATE_HOOKS', {
        workspaceId: 'test-workspace',
        optimizeForRealPerformance: true,
      });

      expect(best).toBeDefined();
      expect(best.provider).toBe('claude');
      // Should fall back to cost-quality reason
      expect(best.reason).not.toContain('CTR');
      expect(best.reason).not.toContain('ROAS');
    });
  });
});
