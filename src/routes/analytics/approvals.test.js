// ============================================================
// Analytics Approvals Tests — PR #37
// ============================================================
// Tests approval decision analytics endpoints.
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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
const { registerApprovalAnalyticsRoutes } = await import('./approvals.js');

describe('Analytics — Approval Decision Routes (PR #37)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock workspace middleware
    app.use((req, res, next) => {
      req.workspaceId = 'workspace-123';
      next();
    });

    const router = express.Router();
    registerApprovalAnalyticsRoutes(router);
    app.use('/api/analytics', router);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/analytics/approvals/summary', () => {
    it('should return overall approval metrics', async () => {
      const mockDecisions = [
        { decision: 'APPROVED', severity: 'LOW', reviewedAt: new Date() },
        { decision: 'APPROVED', severity: 'MEDIUM', reviewedAt: new Date() },
        { decision: 'REJECTED', severity: 'HIGH', reviewedAt: new Date() },
        { decision: 'REGENERATE', severity: 'HIGH', reviewedAt: new Date() },
        { decision: 'REQUEST_REVISION', severity: 'MEDIUM', reviewedAt: new Date() },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const response = await request(app)
        .get('/api/analytics/approvals/summary')
        .expect(200);

      expect(response.body.total).toBe(5);
      expect(response.body.decisions.approved).toBe(2);
      expect(response.body.decisions.rejected).toBe(1);
      expect(response.body.decisions.regenerate).toBe(1);
      expect(response.body.decisions.requestRevision).toBe(1);
      expect(response.body.rates.approvalRate).toBe(40); // 2/5 * 100
      expect(response.body.severity.high).toBe(2);
      expect(response.body.severity.medium).toBe(2);
      expect(response.body.severity.low).toBe(1);
    });

    it('should handle empty results', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/analytics/approvals/summary')
        .expect(200);

      expect(response.body.total).toBe(0);
      expect(response.body.rates.approvalRate).toBe(0);
    });

    it('should filter by date range', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/analytics/approvals/summary')
        .query({ startDate: '2026-05-01', endDate: '2026-05-25' })
        .expect(200);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reviewedAt: {
              gte: new Date('2026-05-01'),
              lte: new Date('2026-05-25'),
            },
          }),
        })
      );
    });
  });

  describe('GET /api/analytics/approvals/by-provider', () => {
    it('should return provider performance comparison', async () => {
      const mockDecisions = [
        { provider: 'claude', decision: 'APPROVED', model: 'claude-opus-4' },
        { provider: 'claude', decision: 'APPROVED', model: 'claude-opus-4' },
        { provider: 'claude', decision: 'REJECTED', model: 'claude-opus-4' },
        { provider: 'openai', decision: 'APPROVED', model: 'gpt-4' },
        { provider: 'openai', decision: 'REGENERATE', model: 'gpt-4' },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const response = await request(app)
        .get('/api/analytics/approvals/by-provider')
        .expect(200);

      expect(response.body.providers.claude).toBeDefined();
      expect(response.body.providers.claude.total).toBe(3);
      expect(response.body.providers.claude.approvalRate).toBeCloseTo(66.67, 1); // 2/3 * 100
      expect(response.body.providers.claude.models).toContain('claude-opus-4');

      expect(response.body.providers.openai).toBeDefined();
      expect(response.body.providers.openai.total).toBe(2);
      expect(response.body.providers.openai.approvalRate).toBe(50); // 1/2 * 100
    });

    it('should exclude decisions without provider', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/analytics/approvals/by-provider')
        .expect(200);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: { not: null },
          }),
        })
      );
    });
  });

  describe('GET /api/analytics/approvals/by-capability', () => {
    it('should return capability performance with risk scores', async () => {
      const mockDecisions = [
        { capability: 'GENERATE_HOOKS', decision: 'APPROVED' },
        { capability: 'GENERATE_HOOKS', decision: 'APPROVED' },
        { capability: 'GENERATE_HOOKS', decision: 'REGENERATE' },
        { capability: 'GENERATE_CAPTIONS', decision: 'REJECTED' },
        { capability: 'GENERATE_CAPTIONS', decision: 'REGENERATE' },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const response = await request(app)
        .get('/api/analytics/approvals/by-capability')
        .expect(200);

      expect(response.body.capabilities.GENERATE_HOOKS).toBeDefined();
      expect(response.body.capabilities.GENERATE_HOOKS.total).toBe(3);
      expect(response.body.capabilities.GENERATE_HOOKS.approvalRate).toBeCloseTo(66.67, 1);
      expect(response.body.capabilities.GENERATE_HOOKS.regenerationRate).toBeCloseTo(33.33, 1);
      expect(response.body.capabilities.GENERATE_HOOKS.riskScore).toBeGreaterThan(0);

      expect(response.body.capabilities.GENERATE_CAPTIONS).toBeDefined();
      expect(response.body.capabilities.GENERATE_CAPTIONS.total).toBe(2);
      expect(response.body.capabilities.GENERATE_CAPTIONS.riskScore).toBeGreaterThan(
        response.body.capabilities.GENERATE_HOOKS.riskScore
      ); // Higher risk (rejected + regen)
    });
  });

  describe('GET /api/analytics/approvals/feedback-patterns', () => {
    it('should return most common feedback types', async () => {
      const mockDecisions = [
        {
          feedbackType: 'hook_angle',
          severity: 'HIGH',
          decision: 'REGENERATE',
          preserveAspects: ['brand_voice', 'tone'],
        },
        {
          feedbackType: 'hook_angle',
          severity: 'MEDIUM',
          decision: 'REGENERATE',
          preserveAspects: ['brand_voice'],
        },
        {
          feedbackType: 'tone',
          severity: 'LOW',
          decision: 'REQUEST_REVISION',
          preserveAspects: ['cta'],
        },
        {
          feedbackType: 'cta',
          severity: 'HIGH',
          decision: 'REGENERATE',
          preserveAspects: [],
        },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const response = await request(app)
        .get('/api/analytics/approvals/feedback-patterns')
        .expect(200);

      expect(response.body.total).toBe(4);
      expect(response.body.patterns.hook_angle).toBeDefined();
      expect(response.body.patterns.hook_angle.count).toBe(2);
      expect(response.body.patterns.hook_angle.severity.high).toBe(1);
      expect(response.body.patterns.hook_angle.severity.medium).toBe(1);
      expect(response.body.patterns.hook_angle.decisions.regenerate).toBe(2);
      expect(response.body.patterns.hook_angle.commonPreserveAspects[0].aspect).toBe('brand_voice');
      expect(response.body.patterns.hook_angle.commonPreserveAspects[0].count).toBe(2);
    });

    it('should sort patterns by count descending', async () => {
      const mockDecisions = [
        { feedbackType: 'hook_angle', severity: 'HIGH', decision: 'REGENERATE', preserveAspects: [] },
        { feedbackType: 'hook_angle', severity: 'HIGH', decision: 'REGENERATE', preserveAspects: [] },
        { feedbackType: 'hook_angle', severity: 'HIGH', decision: 'REGENERATE', preserveAspects: [] },
        { feedbackType: 'tone', severity: 'LOW', decision: 'REQUEST_REVISION', preserveAspects: [] },
      ];

      mockFindMany.mockResolvedValueOnce(mockDecisions);

      const response = await request(app)
        .get('/api/analytics/approvals/feedback-patterns')
        .expect(200);

      const patternKeys = Object.keys(response.body.patterns);
      expect(patternKeys[0]).toBe('hook_angle'); // Most common first
      expect(patternKeys[1]).toBe('tone');
    });

    it('should exclude decisions without feedbackType', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/analytics/approvals/feedback-patterns')
        .expect(200);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            feedbackType: { not: null },
          }),
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockFindMany.mockRejectedValueOnce(new Error('DB connection failed'));

      const response = await request(app)
        .get('/api/analytics/approvals/summary')
        .expect(500);

      expect(response.body.error).toBe('DB connection failed');
    });
  });
});
