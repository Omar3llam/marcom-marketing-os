// ============================================================
// Attribution Routes Tests — PR #41 (+ manual-publish recording)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import attributionRouter from './attribution.js';
import { prisma } from '../lib/prisma.js';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
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

// Mock auth: mirrors the real firebaseAuth contract — req.user is the Firebase
// token (it carries .uid, NOT a Prisma row .id), and req.userId is that uid.
// The collab-role gate is NOT mocked — it runs for real, resolving the role
// from prisma.user.findUnique (since req.collabRole is unset here).
vi.mock('../middleware/firebaseAuth.js', () => ({
  requireAuth: (req, res, next) => {
    req.workspaceId = 'test-workspace-123';
    req.userId = 'firebase-uid-1';
    req.user = { uid: 'firebase-uid-1' };
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
    // Default: a real STRATEGIST user row resolves for both the role gate and
    // the publishedBy lookup. Individual tests override the role as needed.
    prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-123', collabRole: 'STRATEGIST' });
  });

  describe('POST /api/attribution/publish', () => {
    it('records a published creative and stamps publishedBy with the resolved User UUID', async () => {
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
        publishedBy: 'user-uuid-123',
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

      // The publishing user's UUID is resolved from the Firebase uid (clerkId).
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { clerkId: 'firebase-uid-1' },
        select: { id: true },
      });

      expect(prisma.artifact.findFirst).toHaveBeenCalledWith({
        where: { id: 'artifact-123', workspaceId: 'test-workspace-123' },
      });

      // The regression that the old test masked: publishedBy MUST be the
      // Prisma User UUID, never req.user.id (undefined on a Firebase token).
      expect(prisma.publishedCreative.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
          adName: 'Test Ad',
          publishedBy: 'user-uuid-123',
        }),
      });
    });

    it('returns 400 if missing required fields', async () => {
      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          // Missing metaAdId and metaCampaignId
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(prisma.publishedCreative.create).not.toHaveBeenCalled();
    });

    it('returns 404 if the publishing user row cannot be resolved', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Publishing user not found');
      expect(prisma.publishedCreative.create).not.toHaveBeenCalled();
    });

    it('returns 404 if artifact not found', async () => {
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
      expect(prisma.publishedCreative.create).not.toHaveBeenCalled();
    });

    it('returns 409 if already published', async () => {
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
      expect(response.body.publishedCreativeId).toBe('published-123');
      expect(prisma.publishedCreative.create).not.toHaveBeenCalled();
    });

    // ── Role gate (execution tier: BUYER + STRATEGIST) ────────
    it('forbids a CLIENT (read-only seat) from recording a publish', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-123', collabRole: 'CLIENT' });

      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('RoleForbidden');
      // The gate short-circuits before any write.
      expect(prisma.publishedCreative.create).not.toHaveBeenCalled();
      expect(prisma.artifact.findFirst).not.toHaveBeenCalled();
    });

    it('allows a BUYER to record a publish (the buyer who ran the ad)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-123', collabRole: 'BUYER' });
      prisma.artifact.findFirst.mockResolvedValue({ id: 'artifact-123', workspaceId: 'test-workspace-123' });
      prisma.publishedCreative.findFirst.mockResolvedValue(null);
      prisma.publishedCreative.create.mockResolvedValue({
        id: 'published-123',
        metaAdId: 'ad-123',
        publishedBy: 'user-uuid-123',
      });

      const response = await request(app)
        .post('/api/attribution/publish')
        .send({
          artifactId: 'artifact-123',
          metaAdId: 'ad-123',
          metaCampaignId: 'campaign-123',
        });

      expect(response.status).toBe(201);
      expect(prisma.publishedCreative.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ publishedBy: 'user-uuid-123' }),
      });
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
