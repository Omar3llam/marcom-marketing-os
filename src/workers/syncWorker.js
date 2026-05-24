// ============================================================
// MARCOM / Lumi — Campaign Sync Worker
// ------------------------------------------------------------
// Background job that periodically fetches live campaign data
// from Meta Ads API for all connected workspaces, analyzes
// with Claude orchestrator, and stores decisions in the DB
// as PENDING Action rows.
//
// Scheduled via BullMQ cron (see scheduleCampaignSync).
// Default: daily at 9 AM UTC (configurable via CAMPAIGN_SYNC_CRON).
// ============================================================
import { Worker } from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { SYNC_QUEUE_NAME } from '../queues/index.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import {
  fetchCampaignInsights,
  normalizeInsightsForAnalysis,
} from '../services/metaAdsService.js';
import { analyzeCampaignData } from '../agents/orchestrator.js';
import { randomUUID } from 'crypto';

const MAX_CAMPAIGNS_PER_WORKSPACE = 20;

// ── Worker Job Handler ────────────────────────────────────────
async function processSyncJob(job) {
  const { workspaceId, datePreset = 'last_7d' } = job.data;

  logger.info({ jobId: job.id, workspaceId }, '[syncWorker] starting job');

  try {
    // Sync all workspaces if no specific workspaceId provided
    if (!workspaceId) {
      await syncAllWorkspaces(datePreset);
      return { status: 'complete', mode: 'all-workspaces' };
    }

    // Sync single workspace
    const result = await syncWorkspace(workspaceId, datePreset);
    return result;
  } catch (err) {
    logger.error({ jobId: job.id, err: err.message }, '[syncWorker] job failed');
    throw err;
  }
}

// ── Sync All Workspaces ───────────────────────────────────────
async function syncAllWorkspaces(datePreset) {
  // Find all workspaces that have Meta OAuth credentials
  const credentials = await prisma.credential.findMany({
    where: { platform: 'meta_ads' },
    select: { workspaceId: true },
    distinct: ['workspaceId'],
  });

  if (credentials.length === 0) {
    logger.info('[syncWorker] no workspaces with Meta credentials found');
    return { synced: 0 };
  }

  const results = [];
  for (const { workspaceId } of credentials) {
    try {
      const result = await syncWorkspace(workspaceId, datePreset);
      results.push({ workspaceId, ...result });
    } catch (err) {
      logger.error({ workspaceId, err: err.message }, '[syncWorker] workspace sync failed');
      results.push({ workspaceId, error: err.message });
    }
  }

  const synced = results.filter(r => r.status === 'success').length;
  logger.info({ total: credentials.length, synced }, '[syncWorker] all-workspaces sync complete');

  return { synced, results };
}

// ── Sync Single Workspace ─────────────────────────────────────
async function syncWorkspace(workspaceId, datePreset) {
  logger.info({ workspaceId, datePreset }, '[syncWorker] syncing workspace');

  // Load workspace's first Meta credential
  const cred = await prisma.credential.findFirst({
    where: { workspaceId, platform: 'meta_ads' },
    orderBy: { createdAt: 'desc' },
  });

  if (!cred || !cred.accessToken || !cred.accountId) {
    logger.warn({ workspaceId }, '[syncWorker] no valid Meta credential found');
    return { status: 'skipped', reason: 'no_credential' };
  }

  // Fetch live campaigns from Meta API
  let insights;
  try {
    insights = await fetchCampaignInsights(cred.accessToken, cred.accountId, datePreset);
  } catch (err) {
    // OAuth token expired → log and skip
    if (err.message?.includes('OAuthException') || err.message?.includes('token') || err.message?.includes('190')) {
      logger.warn({ workspaceId, accountId: cred.accountId }, '[syncWorker] OAuth token expired');
      return { status: 'skipped', reason: 'token_expired' };
    }
    throw err;
  }

  if (!insights || insights.length === 0) {
    logger.info({ workspaceId }, '[syncWorker] no campaigns found in Meta account');
    return { status: 'success', analyzed: 0, created: 0 };
  }

  // Hard cap: same as interactive mode
  if (insights.length > MAX_CAMPAIGNS_PER_WORKSPACE) {
    logger.warn({
      workspaceId,
      count: insights.length,
      cap: MAX_CAMPAIGNS_PER_WORKSPACE,
    }, '[syncWorker] too many campaigns, capping');
    insights = insights.slice(0, MAX_CAMPAIGNS_PER_WORKSPACE);
  }

  // Normalize + analyze each campaign
  const normalized = normalizeInsightsForAnalysis(insights);
  const created = [];
  const errors  = [];

  for (const c of normalized) {
    try {
      const dataForClaude = {
        campaignId:   c.campaignId,
        campaignName: c.campaignName,
        adsetName:    c.adsetName,
        metrics: {
          spend:         c.spend,
          impressions:   c.impressions,
          results:       c.results,
          ctr:           c.ctr,
          cpc:           c.cpc,
          roas:          c.roas,
          frequency:     c.frequency,
          reach:         c.reach,
          costPerResult: c.costPerResult,
        },
        deliveryStatus: c.deliveryStatus,
        rawRecord:      c.rawRecord,
      };

      const decision = await analyzeCampaignData(dataForClaude, 'auto-sync');

      // Upsert CampaignState
      const stage = inferStage(decision.verdict, decision.risk_level);
      const healthScore = computeHealthScore(c);

      await prisma.campaignState.upsert({
        where:  { campaignId: c.campaignId },
        update: {
          stage,
          healthScore,
          lastAnalysis: new Date(),
        },
        create: {
          campaignId:   c.campaignId,
          workspaceId,
          stage,
          healthScore,
          lastAnalysis: new Date(),
        },
      });

      // Create PENDING Action with decision payload
      const action = await prisma.action.create({
        data: {
          workspaceId,
          campaignId:     c.campaignId,
          idempotencyKey: `auto-sync:${c.campaignId}:${Date.now()}:${randomUUID().slice(0, 8)}`,
          status:         'PENDING',
          payload: {
            kind:         'lumi.auto-sync',
            source:       'auto-sync',
            platform:     'META',
            campaignName: c.campaignName,
            adsetName:    c.adsetName,
            priority:     inferPriority(decision.verdict, decision.risk_level),
            verdict:      decision.verdict,
            rootCause:    decision.why?.[0] || decision.impact,
            rationale:    decision.why?.join(' · ') || decision.impact,
            metrics: {
              spend:         c.spend,
              impressions:   c.impressions,
              results:       c.results,
              frequency:     c.frequency,
              reach:         c.reach,
              ctr:           c.ctr,
              cpc:           c.cpc,
              roas:          c.roas,
              costPerResult: c.costPerResult,
            },
            deliveryStatus: c.deliveryStatus,
            // Full Claude decision for frontend
            strategicAnalysis: {
              verdict:    decision.verdict,
              rootCause:  decision.why?.[0] || decision.impact,
              diagnosis:  decision.why?.join(' · '),
              actionPlan: {
                action: decision.action?.type || 'Review decision',
              },
            },
            // Raw record for audit
            rawRecord: c.rawRecord,
          },
        },
      });

      created.push(action.id);
    } catch (err) {
      logger.error({ err: err.message, campaignId: c.campaignId },
        '[syncWorker] campaign analysis failed');
      errors.push({ campaign: c.campaignName, error: err.message });
    }
  }

  logger.info({
    workspaceId,
    fetched:  insights.length,
    analyzed: normalized.length,
    created:  created.length,
    errors:   errors.length,
  }, '[syncWorker] workspace sync complete');

  return {
    status:   'success',
    analyzed: normalized.length,
    created:  created.length,
    errors:   errors.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function inferStage(verdict, riskLevel) {
  if (verdict === 'KILL') {
    return riskLevel === 'HIGH' ? 'DYING' : 'FATIGUED';
  }
  if (verdict === 'SCALE') {
    return 'SCALING';
  }
  if (verdict === 'HOLD') {
    return riskLevel === 'HIGH' ? 'FATIGUED' : 'STABLE';
  }
  return 'TESTING';
}

function inferPriority(verdict, riskLevel) {
  if (verdict === 'KILL' && riskLevel === 'HIGH') return 'HIGH';
  if (verdict === 'SCALE' && riskLevel === 'LOW') return 'LOW';
  return 'MEDIUM';
}

function computeHealthScore(campaign) {
  const roas = Math.max(0, Math.min(5, campaign.roas ?? 0)) / 5;
  const ctr  = Math.max(0, Math.min(5, campaign.ctr  ?? 0)) / 5;
  const freq = 1 - Math.min(1, Math.max(0, ((campaign.frequency ?? 0) - 1.5) / 4));
  return Math.round(((roas * 0.5) + (ctr * 0.3) + (freq * 0.2)) * 100) / 100;
}

// ── Worker Bootstrap ──────────────────────────────────────────
export function startSyncWorker() {
  if (!bullConnection) {
    logger.warn('[syncWorker] Redis disabled — worker not started');
    return { close: async () => {} };
  }

  const worker = new Worker(SYNC_QUEUE_NAME, processSyncJob, {
    connection: bullConnection,
    prefix:     QUEUE_PREFIX,
    concurrency: 1, // Serialize sync jobs to avoid rate limits
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, result: job.returnvalue }, '[syncWorker] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, '[syncWorker] job failed');
  });

  logger.info('[syncWorker] online');
  return worker;
}
