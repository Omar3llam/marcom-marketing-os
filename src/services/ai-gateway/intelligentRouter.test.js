// ============================================================
// Intelligent Router Tests — PR #38
// ============================================================
// Tests intelligent provider routing with fallback strategies.
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies before imports
const mockGetBestProvider = vi.fn();
const mockGetProviderForCapability = vi.fn();

vi.mock('./providerPerformance.js', () => ({
  getBestProvider: mockGetBestProvider,
}));

vi.mock('./providerRegistry.js', () => ({
  getProviderForCapability: mockGetProviderForCapability,
  PROVIDER_REGISTRY: {
    GENERATE_HOOKS: {
      provider: 'claude',
      method: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks
const { routeCapability, getRoutingStats } = await import('./intelligentRouter.js');

describe('Intelligent Provider Router (PR #38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variable
    delete process.env.ENABLE_INTELLIGENT_ROUTING;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('routeCapability', () => {
    it('should use static registry when intelligent routing disabled', async () => {
      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: false,
      });

      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('static');
      expect(result.routingDecision.reason).toContain('Intelligent routing disabled');
      expect(result.routingDecision.fallback).toBe(false);
      expect(mockGetBestProvider).not.toHaveBeenCalled();
    });

    it('should use performance data when available', async () => {
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'claude',
        reason: '85% approval rate (20 decisions, 95% confidence)',
        score: {
          provider: 'claude',
          approvalRate: 85,
          riskScore: 0.5,
          total: 20,
          confidence: 0.95,
        },
      });

      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
      });

      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('performance-based');
      expect(result.routingDecision.reason).toContain('85% approval rate');
      expect(result.routingDecision.performanceData).toBeDefined();
      expect(result.routingDecision.performanceData.approvalRate).toBe(85);
    });

    it('should fallback to static when no performance data exists', async () => {
      mockGetBestProvider.mockResolvedValueOnce(null); // No data

      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
      });

      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('static');
      expect(result.routingDecision.reason).toContain('No performance data available');
      expect(result.routingDecision.fallback).toBe(true);
    });

    it('should fallback to static when performance query fails', async () => {
      mockGetBestProvider.mockRejectedValueOnce(new Error('DB connection failed'));

      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
      });

      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('static');
      expect(result.routingDecision.reason).toContain('Performance query failed');
      expect(result.routingDecision.fallback).toBe(true);
    });

    it('should log when analytics suggests different provider', async () => {
      // Analytics suggests OpenAI
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'openai',
        reason: '92% approval rate (30 decisions, 98% confidence)',
        score: {
          provider: 'openai',
          approvalRate: 92,
          riskScore: 0.2,
          total: 30,
          confidence: 0.98,
        },
      });

      // But static registry has Claude
      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
      });

      // Should use static registry for now (conservative approach)
      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('performance-based-passive');
      expect(result.routingDecision.analyticsRecommendation).toBe('openai');
      expect(result.routingDecision.reason).toContain('Analytics suggests: openai');
      expect(result.routingDecision.performanceData).toBeDefined();
    });

    it('should filter by workspaceId when provided', async () => {
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'claude',
        reason: '80% approval rate',
        score: { approvalRate: 80, total: 10, confidence: 0.9, riskScore: 0.5 },
      });

      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      await routeCapability('GENERATE_HOOKS', {
        workspaceId: 'ws-123',
        enableIntelligentRouting: true,
      });

      expect(mockGetBestProvider).toHaveBeenCalledWith(
        'GENERATE_HOOKS',
        expect.objectContaining({
          workspaceId: 'ws-123',
        })
      );
    });

    it('should pass performance options to scorer', async () => {
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'claude',
        reason: '80% approval rate',
        score: { approvalRate: 80, total: 10, confidence: 0.9, riskScore: 0.5 },
      });

      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const startDate = new Date('2026-05-01');
      const endDate = new Date('2026-05-25');

      await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
        performanceOptions: {
          startDate,
          endDate,
          minSampleSize: 5,
        },
      });

      expect(mockGetBestProvider).toHaveBeenCalledWith(
        'GENERATE_HOOKS',
        expect.objectContaining({
          startDate,
          endDate,
          minSampleSize: 5,
        })
      );
    });
  });

  describe('getRoutingStats', () => {
    it('should return routing configuration', () => {
      const stats = getRoutingStats();

      expect(stats).toHaveProperty('intelligentRoutingEnabled');
      expect(stats).toHaveProperty('featureFlagSource');
    });

    it('should reflect environment variable', () => {
      process.env.ENABLE_INTELLIGENT_ROUTING = 'true';

      const stats = getRoutingStats();

      expect(stats.featureFlagSource).toBe('env');
    });
  });
});
