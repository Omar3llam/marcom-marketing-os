// ============================================================
// MARCOM / Lumi — Paid Decision Engine Controller
// ------------------------------------------------------------
// Handles HTTP requests for the Paid Decision Engine API.
//
// Endpoints:
// - GET  /radar   — Proactive radar alerts (Meta MCP; pending move to entity graph)
// - POST /analyze — CSV / direct-JSON campaign analysis (dual-agent)
// - GET  /health  — Dual-agent orchestrator health
//
// NOTE: the Meta-MCP-dependent /execute endpoint and the /analyze "api" branch
// were removed — both were unreachable from the product and duplicated the
// workspace-scoped real paths (execution.js / metaExecutionService). metaMCP
// now survives only behind radarHandler, which is itself slated to move to the
// entity graph (after which metaMCP + META_ACCESS_TOKEN can be retired).
// ============================================================
import metaMCP from '../services/metaMCP.js';
import {
  analyzeRadarData,
  analyzeCampaignData,
  healthCheck,
} from '../agents/orchestrator.js';
import { logger } from '../utils/logger.js';
import { parse } from 'csv-parse/sync';

// MOCK_RADAR_ALERTS retained for test fixtures only — never sent to client.
// On MCP failure, radarHandler now returns 503 + alerts:[] so the frontend
// can render a proper empty/error state instead of silently rendering
// placeholder data as if it were real.
// const MOCK_RADAR_ALERTS = [ ... ];

/**
 * GET /api/v1/paid/radar
 * Fetches proactive radar alerts (bleeding campaigns)
 */
export async function radarHandler(req, res) {
  try {
    logger.info('[PaidController] Radar request received');

    // 1. Fetch campaign insights from Meta MCP
    let campaigns;
    try {
      campaigns = await metaMCP.getCampaignInsights({
        adAccountId: req.query.adAccountId || process.env.META_AD_ACCOUNT_ID,
        datePreset: req.query.datePreset || 'last_7d',
      });
    } catch (mcpError) {
      logger.warn({ err: mcpError.message }, '[PaidController] MCP fetch failed');
      return res.status(503).json({
        success: false,
        alerts: [],
        source: 'unavailable',
        message: 'Meta MCP not connected. Set META_ACCESS_TOKEN to enable live radar.',
      });
    }

    // 2. Pass data to Claude orchestrator for analysis
    const alerts = await analyzeRadarData(campaigns);

    // 3. Return formatted alerts
    return res.json({
      success: true,
      alerts,
      source: 'live',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error.message }, '[PaidController] Radar handler failed');

    return res.status(503).json({
      success: false,
      alerts: [],
      source: 'unavailable',
      message: 'Meta MCP not connected. Set META_ACCESS_TOKEN to enable live radar.',
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
