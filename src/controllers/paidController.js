// ============================================================
// MARCOM / Lumi — Paid Decision Engine Controller
// ------------------------------------------------------------
// Handles HTTP requests for the Paid Decision Engine API.
//
// Endpoints:
// - GET  /radar   — Proactive radar alerts (workspace-scoped connector entity graph)
// - POST /analyze — CSV / direct-JSON campaign analysis (dual-agent)
// - GET  /health  — Dual-agent orchestrator health
//
// NOTE: radar now sources campaigns from the workspace-scoped connector entity
// graph (EntityGraphService) — NOT a global META_ACCESS_TOKEN. metaMCP has been
// removed entirely (PR C); no product path reads META_ACCESS_TOKEN.
// (The /execute endpoint + /analyze "api" branch were pruned in PR A.)
// ============================================================
import {
  analyzeRadarData,
  analyzeCampaignData,
  healthCheck,
} from '../agents/orchestrator.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { parse } from 'csv-parse/sync';
import { getConnectorCampaigns } from '../services/entity-graph/index.js';

// resolveWorkspaceId — same pattern as the lumi routes: trust the auth
// middleware's req.workspaceId, fall back to a user lookup by Firebase uid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[PaidController] workspaceId fallback failed');
    return null;
  }
}

/**
 * GET /api/v1/paid/radar
 * Proactive radar alerts (bleeding campaigns) for the caller's workspace.
 * Sources campaigns from the workspace-scoped connector entity graph (the same
 * substrate the Campaigns surface drills into) — never a global env token.
 * Honest by construction: only metric-bearing campaigns are analysed, and an
 * unsynced workspace returns 503 so the UI shows "connect a channel".
 */
export async function radarHandler(req, res) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) {
    return res.status(503).json({
      success: false, alerts: [], source: 'unavailable',
      message: 'No workspace resolved for this user.',
    });
  }

  try {
    logger.info({ workspaceId: wsId }, '[PaidController] Radar request received');

    // Workspace-scoped connector campaigns + their latest real metrics
    // (null-where-absent). Empty when no channel has synced.
    const rows = await getConnectorCampaigns(wsId);

    // Only metric-bearing campaigns can ground a verdict — a row with no
    // snapshot (all-null) gives the model nothing to reason over, so exclude
    // it rather than risk a fabricated alert.
    const withMetrics = rows.filter((r) => r.spendMinor != null || r.roas != null);

    if (withMetrics.length === 0) {
      // Preserves the existing "connect a channel" UX (CommandCenter banner):
      // an empty connector substrate genuinely means nothing has synced yet.
      return res.status(503).json({
        success: false, alerts: [], source: 'unavailable',
        message: 'No connector campaign data yet — connect and sync a channel to enable live radar.',
      });
    }

    // Shape for the strategist model: real values in display units (money in
    // major units, CTR as a percentage). Identity is the entity-graph UUID so
    // each alert's campaign_id joins back to a real row.
    const campaigns = withMetrics.map((r) => ({
      campaign_id:   r.entityId,
      campaign_name: r.name,
      channel:       r.channel,
      spend:         r.spendMinor != null ? r.spendMinor / 100 : null,
      roas:          r.roas ?? null,
      ctr:           r.ctr != null ? r.ctr * 100 : null,
      frequency:     r.frequency ?? null,
      currency:      r.currency ?? null,
    }));

    const alerts = await analyzeRadarData(campaigns);

    return res.json({
      success: true,
      alerts,
      source: 'live',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error.message, workspaceId: wsId }, '[PaidController] Radar handler failed');
    return res.status(503).json({
      success: false, alerts: [], source: 'unavailable',
      message: 'Radar temporarily unavailable.',
      error: error.message,
    });
  }
}

/**
 * POST /api/v1/paid/analyze
 * Analyzes campaign data from CSV upload or JSON body
 */
export async function analyzeHandler(req, res) {
  try {
    logger.info('[PaidController] Analyze request received');

    let campaignData;
    let source = 'json';

    // Check if CSV file was uploaded
    if (req.file) {
      source = 'csv';
      const csvText = req.file.buffer.toString('utf-8');

      // Parse CSV
      const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      // Transform CSV rows to campaign data
      campaignData = {
        campaigns: rows.map((row, index) => ({
          campaign_id: row.campaign_id || row.id || `csv_${index}`,
          campaign_name: row.campaign_name || row.name || `Campaign ${index + 1}`,
          spend: parseFloat(row.spend || 0),
          impressions: parseInt(row.impressions || 0),
          clicks: parseInt(row.clicks || 0),
          ctr: parseFloat(row.ctr || 0),
          cpc: parseFloat(row.cpc || 0),
          cpm: parseFloat(row.cpm || 0),
          conversions: parseInt(row.conversions || row.actions || 0),
          cpa: parseFloat(row.cpa || row.cost_per_action || 0),
          roas: parseFloat(row.roas || 0),
          frequency: parseFloat(row.frequency || 0),
        })),
        uploadedAt: new Date().toISOString(),
      };

      logger.info({ rowCount: rows.length }, '[PaidController] CSV parsed successfully');
    } else {
      // Direct JSON payload
      campaignData = req.body;
    }

    // Analyze with Claude
    // For simplicity, analyze the first campaign if multiple
    const targetCampaign = campaignData.campaigns?.[0] || campaignData;

    const verdict = await analyzeCampaignData(targetCampaign, source);

    return res.json({
      success: true,
      verdict,
      source,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error.message }, '[PaidController] Analyze handler failed');

    return res.status(500).json({
      success: false,
      error: error.message,
      classification: error.message.includes('parse') ? 'parsing' : 'network',
      fallbackAction: 'Try uploading CSV instead',
    });
  }
}

/**
 * GET /api/v1/paid/health
 * Health check for Paid Decision Engine
 */
export async function healthHandler(req, res) {
  try {
    // Dual-agent orchestrator health. The Meta MCP probe was removed — metaMCP
    // is being retired and Meta credentials are workspace-scoped, resolved
    // outside this controller.
    const orchestratorHealth = await healthCheck();

    return res.json({
      status: orchestratorHealth.status === 'healthy' ? 'healthy' : 'degraded',
      components: {
        orchestrator: orchestratorHealth,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
