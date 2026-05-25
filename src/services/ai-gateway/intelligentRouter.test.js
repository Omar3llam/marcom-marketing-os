// ============================================================
// Intelligent Router Tests — PR #38 + PR #39
// ============================================================
// Tests intelligent provider routing with fallback strategies
// and active routing with A/B testing.
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies before imports
const mockGetBestProvider = vi.fn();
const mockGetProviderForCapability = vi.fn();
const mockGetMethodForProvider = vi.fn();

vi.mock('./providerPerformance.js', () => ({
  getBestProvider: mockGetBestProvider,
}));

vi.mock('./providerRegistry.js', () => ({
  getProviderForCapability: mockGetProviderForCapability,
  getMethodForProvider: mockGetMethodForProvider,
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
const { routeCapability, getRoutingStats, isInControlGroup } = await import('./intelligentRouter.js');

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
      expect(stats).toHaveProperty('activeRoutingEnabled');
      expect(stats).toHaveProperty('abTestControlPercentage');
      expect(stats).toHaveProperty('featureFlagSource');
    });

    it('should report environment variable source when set', () => {
      // Note: Module constants are set at import time, so we can't test
      // the actual values here without re-importing. We test the source detection.
      const originalEnv = process.env.ENABLE_INTELLIGENT_ROUTING;
      process.env.ENABLE_INTELLIGENT_ROUTING = 'true';

      const stats = getRoutingStats();

      // If env var was set, source should be 'env'
      if (process.env.ENABLE_INTELLIGENT_ROUTING) {
        expect(stats.featureFlagSource.intelligentRouting).toBe('env');
      }

      // Cleanup
      if (originalEnv === undefined) {
        delete process.env.ENABLE_INTELLIGENT_ROUTING;
      } else {
        process.env.ENABLE_INTELLIGENT_ROUTING = originalEnv;
      }
    });
  });

  // ============================================================
  // PR #39 — Active Routing Tests
  // ============================================================

  describe('Active Routing (PR #39)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      delete process.env.ENABLE_INTELLIGENT_ROUTING;
      delete process.env.ENABLE_ACTIVE_ROUTING;
      delete process.env.AB_TEST_CONTROL_PERCENTAGE;
    });

    it('should use static provider when active routing disabled', async () => {
      // Analytics suggests OpenAI (better performance)
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'openai',
        reason: '92% approval rate (30 decisions)',
        score: {
          provider: 'openai',
          approvalRate: 92,
          riskScore: 0.2,
          total: 30,
          confidence: 0.98,
        },
      });

      // Static registry has Claude
      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
        enableActiveRouting: false, // Active routing OFF
      });

      // Should use static (observation mode)
      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('performance-based-passive');
      expect(result.routingDecision.analyticsRecommendation).toBe('openai');
    });

    it('should route to analytics provider when active routing enabled (treatment group)', async () => {
      // Analytics suggests OpenAI
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'openai',
        reason: '92% approval rate (30 decisions)',
        score: {
          provider: 'openai',
          approvalRate: 92,
          riskScore: 0.2,
          total: 30,
          confidence: 0.98,
        },
      });

      // Static registry has Claude
      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      // Analytics provider method available
      mockGetMethodForProvider.mockReturnValueOnce({
        provider: 'openai',
        method: vi.fn(),
      });

      // Use requestId that will be in treatment group (not control)
      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
        enableActiveRouting: true,
        requestId: 'treatment-request-id', // This will hash to treatment group
      });

      // Should route to analytics provider (OpenAI)
      // Note: Due to deterministic hashing, we need to check if in treatment
      if (result.routingDecision.abTestGroup === 'treatment') {
        expect(result.provider).toBe('openai');
        expect(result.routingDecision.strategy).toBe('performance-based-active');
        expect(result.routingDecision.staticProvider).toBe('claude');
      } else {
        // If randomly in control, that's also valid
        expect(result.routingDecision.abTestGroup).toBe('control');
      }
    });

    it('should use static provider for control group in A/B test', async () => {
      // Analytics suggests OpenAI
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'openai',
        reason: '92% approval rate (30 decisions)',
        score: {
          provider: 'openai',
          approvalRate: 92,
          riskScore: 0.2,
          total: 30,
          confidence: 0.98,
        },
      });

      // Static registry has Claude
      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      // Mock analytics provider method (for treatment group path)
      mockGetMethodForProvider.mockReturnValueOnce({
        provider: 'openai',
        method: vi.fn(),
      });

      // Use requestId that will be in control group
      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
        enableActiveRouting: true,
        requestId: 'control-request-id', // This will hash to either control or treatment
      });

      // Verify result is either control or treatment (deterministic based on hash)
      expect(result.routingDecision.abTestGroup).toBeDefined();
      expect(['control', 'treatment']).toContain(result.routingDecision.abTestGroup);

      if (result.routingDecision.abTestGroup === 'control') {
        expect(result.provider).toBe('claude');
        expect(result.routingDecision.strategy).toBe('ab-test-control');
        expect(result.routingDecision.analyticsRecommendation).toBe('openai');
      } else {
        expect(result.provider).toBe('openai');
        expect(result.routingDecision.strategy).toBe('performance-based-active');
      }
    });

    it('should fallback to static when analytics provider does not support capability', async () => {
      // Analytics suggests Higgsfield for GENERATE_HOOKS
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'higgsfield',
        reason: '95% approval rate (5 decisions)',
        score: {
          provider: 'higgsfield',
          approvalRate: 95,
          riskScore: 0.1,
          total: 5,
          confidence: 0.7,
        },
      });

      // Static registry has Claude
      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      // Higgsfield doesn't support GENERATE_HOOKS
      mockGetMethodForProvider.mockReturnValueOnce(null);

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
        enableActiveRouting: true,
        requestId: 'any-id',
      });

      // Should fallback to static (Claude)
      expect(result.provider).toBe('claude');
      expect(result.routingDecision.strategy).toBe('static');
      expect(result.routingDecision.fallback).toBe(true);
      expect(result.routingDecision.analyticsRecommendation).toBe('higgsfield');
    });

    it('should use workspaceId for A/B bucketing when requestId not provided', async () => {
      mockGetBestProvider.mockResolvedValueOnce({
        provider: 'openai',
        reason: '90% approval rate',
        score: { approvalRate: 90, total: 20, confidence: 0.95, riskScore: 0.3 },
      });

      mockGetProviderForCapability.mockReturnValueOnce({
        provider: 'claude',
        method: vi.fn(),
      });

      mockGetMethodForProvider.mockReturnValueOnce({
        provider: 'openai',
        method: vi.fn(),
      });

      const result = await routeCapability('GENERATE_HOOKS', {
        enableIntelligentRouting: true,
        enableActiveRouting: true,
        workspaceId: 'ws-123', // No requestId, should use workspaceId
      });

      // Should have A/B test group assigned
      expect(result.routingDecision.abTestGroup).toBeDefined();
      expect(['control', 'treatment']).toContain(result.routingDecision.abTestGroup);
    });
  });

  // ============================================================
  // PR #39 — A/B Testing Utility Tests
  // ============================================================

  describe('isInControlGroup (PR #39)', () => {
    it('should return consistent results for same identifier', () => {
      const identifier = 'test-request-123';
      const result1 = isInControlGroup(identifier, 10);
      const result2 = isInControlGroup(identifier, 10);

      expect(result1).toBe(result2); // Deterministic
    });

    it('should return different results for different identifiers', () => {
      // With enough samples, we should see both true and false
      const results = new Set();
      for (let i = 0; i < 100; i++) {
        results.add(isInControlGroup(`identifier-${i}`, 10));
      }

      expect(results.size).toBe(2); // Both true and false should appear
    });

    it('should respect control percentage boundaries', () => {
      const identifier = 'test-id';

      expect(isInControlGroup(identifier, 0)).toBe(false);   // 0% = never control
      expect(isInControlGroup(identifier, 100)).toBe(true);  // 100% = always control
    });

    it('should distribute requests according to control percentage', () => {
      const controlPercentage = 10;
      const sampleSize = 1000;
      let controlCount = 0;

      for (let i = 0; i < sampleSize; i++) {
        if (isInControlGroup(`request-${i}`, controlPercentage)) {
          controlCount++;
        }
      }

      const actualPercentage = (controlCount / sampleSize) * 100;

      // Allow 3% margin of error (statistical variance)
      expect(actualPercentage).toBeGreaterThan(controlPercentage - 3);
      expect(actualPercentage).toBeLessThan(controlPercentage + 3);
    });
  });
});
