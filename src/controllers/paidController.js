// ============================================================
// MARCOM / Lumi — Paid Decision Engine Controller
// ------------------------------------------------------------
// Handles HTTP requests for the Paid Decision Engine API.
//
// Endpoints:
// - GET /radar — Proactive radar alerts
// - POST /analyze — CSV/manual campaign analysis
// - POST /execute — Execute Meta API actions
// ============================================================
import metaMCP from '../services/metaMCP.js';
import {
  analyzeRadarData,
  analyzeCampaignData,
  healthCheck,
} from '../agents/orchestrator.js';
import { logger } from '../utils/logger.js';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

// ── ZOD VALIDATION SCHEMAS ───────────────────────────────────
const executeSchema = z.object({
  action_type: z.enum(['pause_campaign', 'resume_campaign', 'update_budget', 'update_bid'], {
    required_error: 'action_type is required',
    invalid_type_error: 'action_type must be one of: pause_campaign, resume_campaign, update_budget, update_bid',
  }),
  target_id: z.string().min(1, 'target_id is required and cannot be empty'),
  payload: z.record(z.any()).optional().default({}),
});

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
    } else if (req.body && req.body.campaignId) {
      // Fetch specific campaign from Meta MCP
      source = 'api';
      const campaignInsights = await metaMCP.getCampaignInsights({
        adAccountId: req.body.adAccountId || process.env.META_AD_ACCOUNT_ID,
        datePreset: req.body.datePreset || 'last_7d',
      });

      // Filter to specific campaign
      const campaign = campaignInsights.find(
        c => c.campaign_id === req.body.campaignId
      );

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found',
          campaignId: req.body.campaignId,
        });
      }

      campaignData = {
        campaigns: [campaign],
      };
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
 * POST /api/v1/paid/execute
 * Executes a Meta API action via MCP
 */
export async function executeHandler(req, res) {
  try {
    // Validate input with Zod
    const validation = executeSchema.safeParse(req.body);
    if (!validation.success) {
      const errors = validation.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      logger.warn({ errors }, '[PaidController] Execute validation failed');

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
        classification: 'validation',
      });
    }

    const { action_type, target_id, payload } = validation.data;

    logger.info({ action_type, target_id }, '[PaidController] Execute request received');

    // Map action_type to MCP tool name
    const toolNameMap = {
      pause_campaign: 'pause_campaign',
      resume_campaign: 'resume_campaign',
      update_budget: 'update_campaign_budget',
      update_bid: 'update_campaign_bid',
    };

    const toolName = toolNameMap[action_type];

    // Build MCP tool arguments
    const args = {
      campaign_id: target_id,
      ...payload,
    };

    // Execute via MCP
    const result = await metaMCP.executeAction(toolName, args);

    return res.json({
      success: true,
      message: `Action ${action_type} executed successfully`,
      action: {
        type: action_type,
        target_id,
        timestamp: new Date().toISOString(),
      },
      result,
    });
  } catch (error) {
    logger.error({ err: error.message }, '[PaidController] Execute handler failed');

    return res.status(500).json({
      success: false,
      error: error.message,
      classification: 'execution',
      fallbackAction: 'Verify MCP connection and Meta API credentials',
    });
  }
}

/**
 * GET /api/v1/paid/health
 * Health check for Paid Decision Engine
 */
export async function healthHandler(req, res) {
  try {
    // Check both MCP and Orchestrator
    const [mcpHealth, orchestratorHealth] = await Promise.all([
      metaMCP.healthCheck(),
      healthCheck(),
    ]);

    const overallStatus =
      mcpHealth.status === 'healthy' && orchestratorHealth.status === 'healthy'
        ? 'healthy'
        : 'degraded';

    return res.json({
      status: overallStatus,
      components: {
        metaMCP: mcpHealth,
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
