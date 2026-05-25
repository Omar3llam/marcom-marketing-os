// ============================================================
// Meta Performance Sync — PR #41
// ============================================================
// Fetches real campaign performance data from Meta API and
// updates ProviderPerformanceMetrics for attribution analysis.
//
// USAGE:
//   import { syncMetaPerformance } from './services/metaPerformanceSync.js';
//   await syncMetaPerformance(workspaceId);
//
// CRON SCHEDULE:
//   Run every 6 hours to keep performance data fresh.
// ============================================================
import prisma from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { getMetaClient } from '../utils/meta.js';

/**
 * Sync Meta performance data for a workspace.
 *
 * Fetches insights for all published creatives and updates
 * ProviderPerformanceMetrics with latest CTR, CPC, ROAS, etc.
 *
 * @param {string} workspaceId - Workspace to sync
 * @param {object} options - Sync options
 * @param {Date} options.startDate - Performance period start (default: 7 days ago)
 * @param {Date} options.endDate - Performance period end (default: now)
 * @returns {Promise<{ synced: number, errors: number }>}
 */
export async function syncMetaPerformance(workspaceId, options = {}) {
  const {
    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    endDate = new Date(),
  } = options;

  logger.info({
    workspaceId,
    startDate,
    endDate,
  }, '[metaPerformanceSync] starting sync');

  try {
    // Get all published creatives for this workspace
    const publishedCreatives = await prisma.publishedCreative.findMany({
      where: { workspaceId },
      include: {
        artifact: {
          select: {
            id: true,
            provider: true,
            capability: true,
            metadata: true,
          },
        },
      },
    });

    if (publishedCreatives.length === 0) {
      logger.debug({ workspaceId }, '[metaPerformanceSync] no published creatives found');
      return { synced: 0, errors: 0 };
    }

    // Get Meta API client
    const metaClient = await getMetaClient(workspaceId);

    let synced = 0;
    let errors = 0;

    // Fetch performance for each ad
    for (const creative of publishedCreatives) {
      try {
        const insights = await fetchAdInsights(metaClient, creative.metaAdId, {
          startDate,
          endDate,
        });

        if (!insights) {
          logger.debug({
            metaAdId: creative.metaAdId,
          }, '[metaPerformanceSync] no insights available');
          continue;
        }

        // Extract model from artifact metadata
        const model = creative.artifact.metadata?.model || null;

        // Upsert performance metrics
        await prisma.providerPerformanceMetrics.upsert({
          where: {
            // Composite key: publishedCreativeId + startDate + endDate
            publishedCreativeId_startDate_endDate: {
              publishedCreativeId: creative.id,
              startDate,
              endDate,
            },
          },
          create: {
            publishedCreativeId: creative.id,
            workspaceId,
            provider: creative.artifact.provider,
            capability: creative.artifact.capability,
            model,
            impressions: insights.impressions,
            clicks: insights.clicks,
            ctr: insights.ctr,
            cpc: insights.cpc,
            spend: insights.spend,
            conversions: insights.conversions,
            revenue: insights.revenue,
            roas: insights.roas,
            startDate,
            endDate,
          },
          update: {
            impressions: insights.impressions,
            clicks: insights.clicks,
            ctr: insights.ctr,
            cpc: insights.cpc,
            spend: insights.spend,
            conversions: insights.conversions,
            revenue: insights.revenue,
            roas: insights.roas,
            fetchedAt: new Date(),
          },
        });

        synced++;

        logger.debug({
          metaAdId: creative.metaAdId,
          impressions: insights.impressions,
          ctr: insights.ctr,
          roas: insights.roas,
        }, '[metaPerformanceSync] synced ad performance');
      } catch (error) {
        errors++;
        logger.error({
          error: error.message,
          metaAdId: creative.metaAdId,
          publishedCreativeId: creative.id,
        }, '[metaPerformanceSync] failed to sync ad');
      }
    }

    logger.info({
      workspaceId,
      synced,
      errors,
      total: publishedCreatives.length,
    }, '[metaPerformanceSync] sync complete');

    return { synced, errors };
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      workspaceId,
    }, '[metaPerformanceSync] sync failed');

    throw error;
  }
}

/**
 * Fetch ad insights from Meta API.
 *
 * @param {object} metaClient - Meta API client
 * @param {string} adId - Meta ad ID
 * @param {object} options - Date range
 * @returns {Promise<object|null>} Insights or null if unavailable
 */
async function fetchAdInsights(metaClient, adId, { startDate, endDate }) {
  try {
    const fields = [
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'spend',
      'conversions',
      'purchase_roas', // Meta's ROAS field
    ];

    const params = {
      time_range: {
        since: startDate.toISOString().split('T')[0], // YYYY-MM-DD
        until: endDate.toISOString().split('T')[0],
      },
      fields: fields.join(','),
    };

    const response = await metaClient.get(`/${adId}/insights`, params);
    const data = response.data?.[0];

    if (!data) {
      return null;
    }

    // Parse Meta response
    const impressions = parseInt(data.impressions || '0', 10);
    const clicks = parseInt(data.clicks || '0', 10);
    const spend = parseFloat(data.spend || '0');
    const conversions = parseInt(data.conversions || '0', 10);

    // Calculate derived metrics
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpc = clicks > 0 ? spend / clicks : null;

    // Meta returns ROAS as array: [{ value, action_type }]
    let roas = null;
    if (data.purchase_roas && Array.isArray(data.purchase_roas)) {
      const roasData = data.purchase_roas.find(
        (r) => r.action_type === 'omni_purchase'
      );
      roas = roasData ? parseFloat(roasData.value) : null;
    }

    // Calculate revenue from ROAS and spend
    const revenue = roas && spend > 0 ? roas * spend : 0;

    return {
      impressions,
      clicks,
      ctr,
      cpc,
      spend,
      conversions,
      revenue,
      roas,
    };
  } catch (error) {
    logger.error({
      error: error.message,
      adId,
    }, '[metaPerformanceSync] failed to fetch ad insights');

    return null;
  }
}

/**
 * Sync all workspaces (for cron job).
 *
 * @returns {Promise<{ totalSynced: number, totalErrors: number }>}
 */
export async function syncAllWorkspaces() {
  logger.info('[metaPerformanceSync] starting sync for all workspaces');

  try {
    const workspaces = await prisma.workspace.findMany({
      select: { id: true, name: true },
    });

    let totalSynced = 0;
    let totalErrors = 0;

    for (const workspace of workspaces) {
      try {
        const result = await syncMetaPerformance(workspace.id);
        totalSynced += result.synced;
        totalErrors += result.errors;
      } catch (error) {
        logger.error({
          error: error.message,
          workspaceId: workspace.id,
        }, '[metaPerformanceSync] workspace sync failed');
        totalErrors++;
      }
    }

    logger.info({
      totalSynced,
      totalErrors,
      workspaceCount: workspaces.length,
    }, '[metaPerformanceSync] all workspaces synced');

    return { totalSynced, totalErrors };
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
    }, '[metaPerformanceSync] failed to sync all workspaces');

    throw error;
  }
}
