// ============================================================
// Attribution Routes — PR #41
// ============================================================
// Tracks artifact publishing to Meta and queries attribution metrics.
// ============================================================
import express from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/firebaseAuth.js';
import { requireCollabRole } from '../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../services/collaboration/roleScope.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/attribution/publish
 * Record that an artifact was published to Meta as a real ad.
 *
 * This records an EXTERNAL action that already happened — the human created
 * the ad in Meta Ads Manager (using copy/briefs pulled from an approved
 * artifact) and is now entering the real Meta IDs to close the attribution
 * link. It does NOT call the Meta API or create anything in Meta.
 *
 * Role: BUYER or STRATEGIST. Recording a live publish is execution-domain
 * bookkeeping (roleScope.canExecute) — the buyer who ran the ad records it.
 * A CLIENT (read-only REPORT seat) cannot. This is the execution tier, not
 * the STRATEGIST-only approval tier.
 *
 * Body:
 * {
 *   artifactId: string,
 *   metaAdId: string,
 *   metaCampaignId: string,
 *   metaAdsetId?: string,
 *   adName?: string,
 *   adStatus?: string
 * }
 */
router.post(
  '/publish',
  requireAuth,
  requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  async (req, res) => {
  const { artifactId, metaAdId, metaCampaignId, metaAdsetId, adName, adStatus } = req.body;
  const { workspaceId } = req;

  // Validation
  if (!artifactId || !metaAdId || !metaCampaignId) {
    return res.status(400).json({
      error: 'Missing required fields: artifactId, metaAdId, metaCampaignId',
    });
  }

  try {
    // Resolve the publishing user's Prisma UUID. publishedBy is String @db.Uuid
    // (a User.id), but req.user is the Firebase token — it carries .uid (the
    // Firebase id, stored in User.clerkId), NOT the row's UUID. Writing the raw
    // token would set publishedBy to undefined (required field → Prisma throws)
    // or a non-UUID string (column rejects it). Look up the row id by uid.
    const publisher = await prisma.user.findUnique({
      where: { clerkId: req.userId },
      select: { id: true },
    });

    if (!publisher) {
      return res.status(404).json({ error: 'Publishing user not found' });
    }

    // Verify artifact exists and belongs to workspace
    const artifact = await prisma.artifact.findFirst({
      where: { id: artifactId, workspaceId },
    });

    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }

    // Check if already published
    const existing = await prisma.publishedCreative.findFirst({
      where: { artifactId, metaAdId },
    });

    if (existing) {
      return res.status(409).json({
        error: 'Artifact already published to this Meta ad',
        publishedCreativeId: existing.id,
      });
    }

    // Create published creative record
    const publishedCreative = await prisma.publishedCreative.create({
      data: {
        artifactId,
        workspaceId,
        metaAdId,
        metaCampaignId,
        metaAdsetId,
        adName,
        adStatus,
        publishedBy: publisher.id,
      },
    });

    logger.info({
      publishedCreativeId: publishedCreative.id,
      artifactId,
      metaAdId,
      metaCampaignId,
      workspaceId,
    }, '[attribution] artifact published to Meta');

    res.status(201).json({
      success: true,
      publishedCreative,
    });
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      artifactId,
      metaAdId,
      workspaceId,
    }, '[attribution] failed to track published creative');

    res.status(500).json({
      error: 'Failed to track published creative',
    });
  }
});

/**
 * GET /api/attribution/metrics
 * Query attribution metrics for provider performance.
 *
 * Query params:
 * - provider: Filter by provider (optional)
 * - capability: Filter by capability (optional)
 * - startDate: Performance period start (ISO 8601, optional)
 * - endDate: Performance period end (ISO 8601, optional)
 * - limit: Max results (default: 100)
 */
router.get('/metrics', requireAuth, async (req, res) => {
  const { workspaceId } = req;
  const {
    provider,
    capability,
    startDate,
    endDate,
    limit = 100,
  } = req.query;

  try {
    const where = {
      workspaceId,
      ...(provider && { provider }),
      ...(capability && { capability }),
      ...(startDate || endDate
        ? {
            startDate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          }
        : {}),
    };

    const metrics = await prisma.providerPerformanceMetrics.findMany({
      where,
      include: {
        publishedCreative: {
          include: {
            artifact: {
              select: {
                id: true,
                type: true,
                capability: true,
                provider: true,
                model: true,
              },
            },
          },
        },
      },
      orderBy: { fetchedAt: 'desc' },
      // Clamp: NaN or negative limit would make Prisma throw on take.
      take: Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500),
    });

    res.json({
      success: true,
      metrics,
      count: metrics.length,
    });
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      workspaceId,
    }, '[attribution] failed to query performance metrics');

    res.status(500).json({
      error: 'Failed to query performance metrics',
    });
  }
});

/**
 * GET /api/attribution/summary
 * Get aggregated provider performance summary.
 *
 * Query params:
 * - capability: Filter by capability (optional)
 * - startDate: Performance period start (ISO 8601, optional)
 * - endDate: Performance period end (ISO 8601, optional)
 */
router.get('/summary', requireAuth, async (req, res) => {
  const { workspaceId } = req;
  const { capability, startDate, endDate } = req.query;

  try {
    const where = {
      workspaceId,
      ...(capability && { capability }),
      ...(startDate || endDate
        ? {
            startDate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          }
        : {}),
    };

    // Aggregate by provider + capability
    const metrics = await prisma.providerPerformanceMetrics.groupBy({
      by: ['provider', 'capability'],
      where,
      _sum: {
        impressions: true,
        clicks: true,
        spend: true,
        conversions: true,
        revenue: true,
      },
      _avg: {
        ctr: true,
        cpc: true,
        roas: true,
      },
      _count: {
        id: true,
      },
    });

    // Calculate aggregate metrics
    const summary = metrics.map((m) => ({
      provider: m.provider,
      capability: m.capability,
      totalImpressions: m._sum.impressions || 0,
      totalClicks: m._sum.clicks || 0,
      totalSpend: m._sum.spend || 0,
      totalConversions: m._sum.conversions || 0,
      totalRevenue: m._sum.revenue || 0,
      avgCtr: m._avg.ctr || 0,
      avgCpc: m._avg.cpc || 0,
      avgRoas: m._avg.roas || 0,
      dataPoints: m._count.id,
      // Computed aggregate CTR and ROAS
      aggregateCtr:
        m._sum.impressions > 0
          ? (m._sum.clicks / m._sum.impressions) * 100
          : 0,
      aggregateRoas:
        m._sum.spend > 0 ? m._sum.revenue / m._sum.spend : 0,
    }));

    res.json({
      success: true,
      summary,
      count: summary.length,
    });
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      workspaceId,
    }, '[attribution] failed to generate performance summary');

    res.status(500).json({
      error: 'Failed to generate performance summary',
    });
  }
});

export default router;
