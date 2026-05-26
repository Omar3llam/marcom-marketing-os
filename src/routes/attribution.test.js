// ============================================================
// Attribution Routes Tests — PR #41
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import attributionRouter from './attribution.js';
import { prisma } from '../lib/prisma.js';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    artifact: {
      findFirst: vi.fn(),
    },
    publishedCreative: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    providerPerformanceMetrics: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

// Mock middleware
vi.mock('../middleware/firebaseAuth.js', () => ({
  requireAuth: (req, res, next) => {
    req.workspaceId = 'test-workspace-123';
    req.user = { id: 'test-user-123' };
    next();
  },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Test app
const app = express();
app.use(express.json());
app.use('/api/attribution', attributionRouter);

describe('Attribution Routes (PR #41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/attribution/publish', () => {
    it('should track published creative', async () => {
      prisma.artifact.findFirst.mockResolvedValue({
        id: 'artifact-123',
        workspaceId: 'test-workspace-123',
        provider: 'CLAUDE',
        capability: 'GENERATE_HOOKS',
      });

      prisma.publishedCreative.findFirst.mockResolvedValue(null);

      prisma.publishedCreative.create.mockResolvedValue({
        id: 'published-123',
        artifactId: 'artifact-123',
        workspaceId: 'test-workspace-123',
        metaAdId: 'ad-123',
        metaCampaignId: 'campaign-123',
        publishedBy: 'test-user-123',
        publishedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
          adName: 'Test Ad',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.publishedCreative).toBeDefined();
      expect(response.body.publishedCreative.metaAdId).toBe('ad-123');

      expect(prisma.artifact.findFirst).toHaveBeenCalledWith({
        where: { id: 'artifact-123', workspaceId: 'test-workspace-123' },
      });

      expect(prisma.publishedCreative.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
          adName: 'Test Ad',
        }),
      });
    });

    it('should return 400 if missing required fields', async () => {
      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          // Missing metaAdId and metaCampaignId
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should return 404 if artifact not found', async () => {
      prisma.artifact.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Artifact not found');
    });

    it('should return 409 if already published', async () => {
      prisma.artifact.findFirst.mockResolvedValue({
        id: 'artifact-123',
        workspaceId: 'test-workspace-123',
      });

      prisma.publishedCreative.findFirst.mockResolvedValue({
        id: 'published-123',
        artifactId: 'artifact-123',
        metaAdId: 'ad-123',
      });

      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already published');
    });
  });

  describe('GET /api/attribution/metrics', () => {
    it('should return performance metrics', async () => {
      const mockMetrics = [
        {
          id: 'metric-1',
          publishedCreativeId: 'published-1',
          provider: 'CLAUDE',
          capability: 'GENERATE_HOOKS',
          impressions: 1000,
          clicks: 50,
          ctr: 5.0,
          cpc: 0.25,
          spend: 12.5,
          roas: 3.2,
          publishedCreative: {
            artifact: {
              id: 'artifact-1',
              type: 'hook',
              capability: 'GENERATE_HOOKS',
              provider: 'CLAUDE',
            },
          },
        },
      ];

      prisma.providerPerformanceMetrics.findMany.mockResolvedValue(mockMetrics);

      const response = await request(app).get('/api/attribution/metrics');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.metrics).toHaveLength(1);
      expect(response.body.metrics[0].provider).toBe('CLAUDE');
      expect(response.body.metrics[0].ctr).toBe(5.0);
    });

    it('should filter by provider', async () => {
      prisma.providerPerformanceMetrics.findMany.mockResolvedValue([]);

      await request(app).get('/api/attribution/metrics?provider=OPENAI');

      expect(prisma.providerPerformanceMetrics.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: 'OPENAI',
          }),
        })
      );
    });

    it('should filter by capability', async () => {
      prisma.providerPerformanceMetrics.findMany.mockResolvedValue([]);

      await request(app).get('/api/attribution/metrics?capability=GENERATE_CAPTIONS');

      expect(prisma.providerPerformanceMetrics.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            capability: 'GENERATE_CAPTIONS',
          }),
        })
      );
    });
  });

  describe('GET /api/attribution/summary', () => {
    it('should return aggregated summary', async () => {
      const mockGrouped = [
        {
          provider: 'CLAUDE',
          capability: 'GENERATE_HOOKS',
          _sum: {
            impressions: 10000,
            clicks: 500,
            spend: 125,
            revenue: 400,
          },
          _avg: {
            ctr: 5.0,
            cpc: 0.25,
            roas: 3.2,
          },
          _count: {
            id: 5,
          },
        },
      ];

      prisma.providerPerformanceMetrics.groupBy.mockResolvedValue(mockGrouped);

      const response = await request(app).get('/api/attribution/summary');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.summary).toHaveLength(1);
      expect(response.body.summary[0].provider).toBe('CLAUDE');
      expect(response.body.summary[0].totalImpressions).toBe(10000);
      expect(response.body.summary[0].aggregateCtr).toBeCloseTo(5.0, 1);
      expect(response.body.summary[0].aggregateRoas).toBeCloseTo(3.2, 1);
    });
  });
});
