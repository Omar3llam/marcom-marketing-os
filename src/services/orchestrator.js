// ============================================================
// MARCOM / Lumi — Claude Orchestrator (The Brain)
// ------------------------------------------------------------
// Anthropic Claude API wrapper for decision intelligence.
// Acts as a ruthless media buying fiduciary for MENA region.
//
// Key Methods:
// - analyzeRadarData(campaigns) — Returns array of alerts
// - analyzeCampaignData(data) — Returns single verdict
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-3-5-sonnet-20241022';
const MAX_TOKENS = 4096;

// ── SYSTEM PROMPT ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Lumi, a ruthless media buying fiduciary AI for MENA (Middle East & North Africa) market advertisers.

Your ONLY job is to analyze campaign performance data and issue strict verdicts: KILL, SCALE, or HOLD.

# CORE PRINCIPLES
1. **Decision First, Not Content First** — Every analysis MUST end in a verdict
2. **MENA Native by Design** — Consider regional factors (Ramadan, local holidays, cultural sensitivities)
3. **Financial Fiduciary** — Prioritize client's money above all else
4. **No Sentimentality** — Kill underperformers without hesitation

# VERDICT RULES
- **KILL**: CPA > target by 50%+, OR ROAS < 1.5x, OR frequency > 8x with declining CTR, OR 7+ days of zero conversions
- **SCALE**: ROAS > 3x, CPA < target by 30%+, CTR > 2%, consistent conversions
- **HOLD**: Performance stable but not exceptional, needs more data, or risky to kill/scale right now

# OUTPUT FORMAT (CRITICAL)
You MUST respond with ONLY valid JSON. NO markdown code blocks. NO explanations outside the JSON.

For radar analysis (multiple campaigns):
[
  {
    "id": "campaign_id",
    "mode": "campaign",
    "title": "Campaign Name",
    "verdict": "KILL" | "SCALE" | "HOLD",
    "confidence": 0.0-1.0,
    "impact": "🔴 Burn Rate: $X/day detected" OR "🟢 Scaling Potential: +$X/day",
    "risk_level": "LOW" | "MEDIUM" | "HIGH",
    "why": ["Reason 1", "Reason 2", "Reason 3"],
    "action": {
      "type": "pause_campaign" | "update_budget",
      "target_id": "campaign_id",
      "payload": {}
    }
  }
]

For single campaign analysis (CSV/manual):
{
  "id": "campaign_id",
  "mode": "campaign",
  "title": "Campaign Name",
  "verdict": "KILL" | "SCALE" | "HOLD",
  "confidence": 0.0-1.0,
  "impact": "Detailed financial impact statement",
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "why": ["Reason 1", "Reason 2", "Reason 3"],
  "action": {
    "type": "pause_campaign" | "update_budget",
    "target_id": "campaign_id",
    "payload": {}
  }
}

# REGIONAL CONTEXT (MENA)
- Currency: Assume USD unless specified
- Key markets: UAE, KSA, Egypt, Kuwait, Qatar
- Peak seasons: Ramadan (Q1/Q2), Summer (June-Aug), Year-end
- Cultural: Friday/Saturday weekends, Arabic language preference

Remember: You are a fiduciary. The client's budget is sacred. Kill waste, scale winners.`;

class OrchestratorService {
  /**
   * Analyzes multiple campaigns for radar alerts
   * @param {Array} campaigns - Array of campaign data from Meta API
   * @returns {Promise<Array>} Array of decision objects
   */
  async analyzeRadarData(campaigns) {
    try {
      logger.info({ count: campaigns.length }, '[Orchestrator] Analyzing radar data');

      const userPrompt = `Analyze these ${campaigns.length} campaigns and identify which ones are bleeding money (candidates for KILL) or ready to scale.

Campaign Data:
${JSON.stringify(campaigns, null, 2)}

Return a JSON array of alerts. Focus on campaigns that need IMMEDIATE action (either KILL or SCALE). Omit stable performers unless they're exceptional. Maximum 5 alerts.

Remember: Output ONLY valid JSON array. No markdown, no explanations.`;

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      // Extract and parse response
      const responseText = message.content[0].text;
      const alerts = this._parseJSON(responseText);

      // Validate array
      if (!Array.isArray(alerts)) {
        throw new Error('Claude returned non-array response for radar analysis');
      }

      // Enrich with metadata
      const enrichedAlerts = alerts.map(alert => ({
        ...alert,
        timestamp: new Date().toISOString(),
        agentsUsed: ['claude'],
        financialImpact: alert.impact, // Normalize field name
        whyBreakdown: alert.why,
        actionLabel: this._getActionLabel(alert.verdict),
        riskLevel: alert.risk_level,
        modeSpecificData: {},
      }));

      logger.info({ count: enrichedAlerts.length }, '[Orchestrator] Radar analysis complete');
      return enrichedAlerts;
    } catch (error) {
      logger.error({ err: error.message }, '[Orchestrator] Radar analysis failed');
      throw error;
    }
  }

  /**
   * Analyzes a single campaign for detailed verdict
   * @param {Object} data - Campaign data (from CSV or API)
   * @param {string} source - Data source ('csv', 'api', 'radar-alert')
   * @returns {Promise<Object>} Single decision object
   */
  async analyzeCampaignData(data, source = 'csv') {
    try {
      logger.info({ source }, '[Orchestrator] Analyzing single campaign');

      const userPrompt = `Analyze this campaign data and provide a comprehensive verdict.

Campaign Data:
${JSON.stringify(data, null, 2)}

Source: ${source}

Provide a detailed analysis with:
1. Clear verdict (KILL/SCALE/HOLD)
2. Confidence level (0.0-1.0)
3. Financial impact statement (use burn rate format for KILL, scaling potential for SCALE)
4. At least 3 specific reasons
5. Recommended action

Remember: Output ONLY valid JSON object. No markdown, no explanations.`;

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      // Extract and parse response
      const responseText = message.content[0].text;
      const verdict = this._parseJSON(responseText);

      // Validate object
      if (typeof verdict !== 'object' || Array.isArray(verdict)) {
        throw new Error('Claude returned invalid response for campaign analysis');
      }

      // Enrich with metadata
      const enrichedVerdict = {
        ...verdict,
        timestamp: new Date().toISOString(),
        agentsUsed: ['claude'],
        financialImpact: verdict.impact,
        whyBreakdown: verdict.why,
        actionLabel: this._getActionLabel(verdict.verdict),
        riskLevel: verdict.risk_level,
        modeSpecificData: {
          campaignTable: data.campaignTable || [],
        },
      };

      logger.info({ verdict: verdict.verdict }, '[Orchestrator] Campaign analysis complete');
      return enrichedVerdict;
    } catch (error) {
      logger.error({ err: error.message }, '[Orchestrator] Campaign analysis failed');
      throw error;
    }
  }

  /**
   * Parses JSON from Claude response (strips markdown if present)
   * @private
   * @param {string} text - Raw response text
   * @returns {Object|Array} Parsed JSON
   */
  _parseJSON(text) {
    try {
      // Strip markdown code blocks if present
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
      }

      return JSON.parse(cleaned);
    } catch (error) {
      logger.error({ text: text.substring(0, 200) }, '[Orchestrator] JSON parse failed');
      throw new Error(`Failed to parse Claude response as JSON: ${error.message}`);
    }
  }

  /**
   * Gets action label for verdict
   * @private
   * @param {string} verdict - KILL/SCALE/HOLD
   * @returns {string} Action button label
   */
  _getActionLabel(verdict) {
    switch (verdict) {
      case 'KILL':
        return 'Pause Campaign';
      case 'SCALE':
        return 'Increase Budget';
      case 'HOLD':
        return 'Monitor Closely';
      default:
        return 'Review Decision';
    }
  }

  /**
   * Health check - verifies Claude API connectivity
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: 'Respond with: OK',
          },
        ],
      });

      return {
        status: 'healthy',
        model: MODEL,
        response: message.content[0].text,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
export default new OrchestratorService();
