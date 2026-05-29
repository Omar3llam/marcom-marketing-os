// ============================================================
// MARCOM / Lumi — Dual-Agent Orchestrator
// ------------------------------------------------------------
// Coordinates Agent 1 (runClaudeAgent — strategic analysis)
// then conditionally Agent 2 (runChatGPTAgent — creative
// generation), persists the combined result onto the Action row,
// and returns the merged payload to the caller.
//
// Per Decision C2: this file uses the EXISTING agent exports
// (runClaudeAgent, runChatGPTAgent) directly — no rename of
// upstream files. The spec's analyzeWithClaude / generateCreativeAssets
// names live only as adapter functions inside this module.
//
// Per Decision B3: brand context is read from User.context (Json
// column added to the Prisma User model in this batch). No
// separate Project model is used.
// ============================================================
import { prisma }                           from '../lib/prisma.js';
import { runClaudeAgent }                   from './ClaudeAgent.js';
import { runChatGPTAgent }                  from './ChatGPTAgent.js';
import { logger }                           from '../utils/logger.js';
import { trackDegradedState }               from '../lib/errorTelemetry.js';

// Root causes that warrant a creative pass. Anything outside this
// list gets strategic analysis only — saves OpenAI quota and
// keeps the UI fast for low-stakes alerts.
const CREATIVE_TRIGGERS = new Set([
  'CRITICAL_PERFORMANCE_DECLINE',
  'CREATIVE_FATIGUE',
]);

/**
 * Adapter — wraps runClaudeAgent and forces a strict JSON output
 * shape the orchestrator can consume programmatically.
 */
async function analyzeWithClaude({ campaignState, decisionMemory, contextLock }) {
  const role =
    'You are an Elite Performance Marketing Strategist. ' +
    'You diagnose ad-platform campaigns from raw metrics + the brand context lock + ' +
    'recent decision memory, and return a strict JSON verdict.';

  const task = [
    'Analyze the campaign below and return JSON with this EXACT shape (no markdown fences, no commentary):',
    '{',
    '  "verdict": "KILL" | "HOLD" | "SCALE" | "REFRESH",',
    '  "rootCause": "CRITICAL_PERFORMANCE_DECLINE" | "CREATIVE_FATIGUE" | "AUDIENCE_SATURATION" | "SCALING_OPPORTUNITY" | "OTHER",',
    '  "diagnosis": "<2-3 sentence plain-language diagnosis>",',
    '  "actionPlan": { "action": "<one specific action>", "expectedImpact": "<single sentence>" },',
    '  "confidence": <integer 0-100, your certainty in this verdict>,',
    '  "riskLevel": "High" | "Medium" | "Low",',
    '  "evidenceCount": <integer, number of metrics/signals analyzed>,',
    '  "financialImpact": "<string in EGP, e.g. \'Wasting EGP 2,400/week\' or \'Could gain EGP 15,000/month\'>"',
    '}',
    '',
    'IMPORTANT: AI must be auditable. Include confidence (0-100), risk level, evidence count, and financial impact in EGP.',
    '',
    'CAMPAIGN STATE:',         JSON.stringify(campaignState ?? {}, null, 2),
    'RECENT DECISION MEMORY:', JSON.stringify(decisionMemory ?? [], null, 2),
    'BRAND CONTEXT LOCK:',     JSON.stringify(contextLock ?? {}, null, 2),
  ].join('\n');

  const { text } = await runClaudeAgent({
    campaignId: campaignState?.campaignId ?? null,
    role,
    task,
    maxTokens: 800,
  });

  return safeParseJson(text);
}

/**
 * Adapter — wraps runChatGPTAgent for creative generation. Asks
 * for a strict JSON object with N variants matching the schema
 * the DecisionTheater UI consumes.
 */
async function generateCreativeAssets({ contextLock, strategicBrief }) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const role =
    'You are an Elite Creative Director and Direct-Response Copywriter. ' +
    'You execute advertising strategies based on a Strategic Brief, while ' +
    'STRICTLY adhering to the client\'s Context Lock. You write platform-native ' +
    'copy and visual direction precise enough that a designer or Midjourney can ' +
    'execute it without follow-up questions.';

  const task = [
    'Generate exactly 3 creative variants to address the strategic brief below.',
    'Return ONLY a valid JSON object — no markdown fences, no commentary.',
    'Schema (exact):',
    '{',
    '  "creative_strategy_rationale": "<2 sentences explaining the angle mix>",',
    '  "variants": [',
    '    {',
    '      "angle_name": "<short name>",',
    '      "primary_text": "<≤125 chars for Meta feed>",',
    '      "headline": "<≤40 chars>",',
    '      "description": "<one sentence>",',
    '      "visual_direction": "<designer brief or Midjourney prompt>",',
    '      "platform_notes": "<any platform-specific adjustment>"',
    '    }',
    '  ]',
    '}',
    '',
    'CONTEXT LOCK (never violate):', JSON.stringify(contextLock ?? {}, null, 2),
    'STRATEGIC BRIEF:',              JSON.stringify(strategicBrief ?? {}, null, 2),
  ].join('\n');

  const { text } = await runChatGPTAgent({
    campaignId: strategicBrief?.campaignId ?? null,
    role,
    task,
    maxTokens: 1500,
  });

  return safeParseJson(text);
}

/**
 * Main entry point. Runs Claude → conditionally OpenAI → persists
 * onto the supplied Action row → returns the merged result.
 *
 * @param {object} args
 * @param {string} args.campaignId   — CampaignState.campaignId
 * @param {string} args.workspaceId  — request workspace (for memory + context lookup)
 * @param {string} [args.actionId]   — Action row to persist onto (optional; if absent, no DB write)
 * @param {string} [args.userId]     — for fetching the user's context lock
 */
export async function runOrchestration({ campaignId, workspaceId, actionId, userId }) {
  if (!campaignId) throw new Error('orchestrator: campaignId required');

  // ── Gather the three inputs in parallel ─────────────────────
  const [campaign, user, memory] = await Promise.all([
    prisma.campaignState.findUnique({ where: { campaignId } }),
    userId
      ? prisma.user.findUnique({ where: { id: userId }, select: { context: true } })
      : Promise.resolve(null),
    prisma.decisionMemory.findMany({
      where:   { workspaceId },
      orderBy: { createdAt: 'desc' },
      take:    3,
    }),
  ]);

  if (!campaign) {
    throw new Error(`orchestrator: campaignState ${campaignId} not found`);
  }

  const contextLock = user?.context ?? null;

  // ── Agent 1: Claude (always) ────────────────────────────────
  let strategicAnalysis;
  try {
    strategicAnalysis = await analyzeWithClaude({
      campaignState:  campaign,
      decisionMemory: memory,
      contextLock,
    });
  } catch (err) {
    logger.error({ err: err.message, campaignId }, '[orchestrator] Claude failed');
    throw new Error(`Strategic analysis failed: ${err.message}`);
  }

  // ── Agent 2: OpenAI (conditional) ───────────────────────────
  let creativeAssets = null;
  const needsCreative = CREATIVE_TRIGGERS.has(strategicAnalysis?.rootCause);

  if (needsCreative) {
    try {
      creativeAssets = await generateCreativeAssets({
        contextLock,
        strategicBrief: {
          campaignId,
          problem:        strategicAnalysis.rootCause,
          stage:          campaign.stage,
          verdict:        strategicAnalysis.verdict,
          requiredAction: strategicAnalysis?.actionPlan?.action,
          metrics: {
            healthScore: campaign.healthScore,
            stage:       campaign.stage,
          },
        },
      });
    } catch (err) {
      // Creative is best-effort — log and continue with strategic only.
      logger.warn({ err: err.message, campaignId }, '[orchestrator] OpenAI creative failed — returning strategic only');

      // Track degraded state for observability (Phase 11D)
      trackDegradedState({
        feature: 'creative_generation',
        degradationType: 'openai_failure',
        cause: err.code || err.name || 'OPENAI_ERROR',
        metadata: {
          campaignId,
          rootCause: strategicAnalysis?.rootCause,
          errorMessage: err.message,
          hasApiKey: !!process.env.OPENAI_API_KEY,
        },
      });

      creativeAssets = { error: err.message };
    }
  }

  const merged = {
    strategicAnalysis,
    creativeAssets,
    orchestratedAt:   new Date().toISOString(),
    creativeSkipped:  !needsCreative,
    creativeProvider: process.env.OPENAI_API_KEY ? 'openai' : 'unconfigured',
  };

  // ── Persist onto the Action row if provided ─────────────────
  if (actionId) {
    try {
      await prisma.action.update({
        where: { id: actionId },
        data:  { payload: merged },
      });
    } catch (err) {
      logger.warn({ err: err.message, actionId }, '[orchestrator] action.update failed — returning result anyway');
    }
  }

  return merged;
}

// ── helpers ──────────────────────────────────────────────────
function safeParseJson(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); }
  catch { return { _raw: cleaned }; }
}

// ── Compatibility adapters for paidController ─────────────────
// These wrap the dual-agent pipeline to match the method signatures
// expected by paidController.js (previously from services/orchestrator).
// They use the SAME ClaudeAgent that runOrchestration uses — no new
// Anthropic calls, same dual-agent quality.
// ──────────────────────────────────────────────────────────────

/**
 * Analyzes an array of campaigns and returns alert objects.
 * Adapter for paidController radarHandler.
 * @param {Array} campaigns - Raw campaign objects from Meta MCP or CSV
 * @returns {Promise<Array>} Array of alert objects
 */
export async function analyzeRadarData(campaigns) {
  const userPrompt = [
    `Analyze these ${campaigns.length} campaigns and identify which need`,
    'IMMEDIATE action (KILL or SCALE). Omit stable performers.',
    'Return a JSON array of alerts (max 5). Each alert:',
    '{ campaign_id, verdict, rootCause, diagnosis, impact, risk_level, actionPlan }',
    'No markdown. Valid JSON array only.',
    '',
    'CAMPAIGN DATA:',
    JSON.stringify(campaigns, null, 2),
  ].join('\n');

  const { text } = await runClaudeAgent({
    system: 'You are an Elite Performance Marketing Strategist. Return only valid JSON.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Parse and enrich
  let alerts;
  try {
    const raw = text.replace(/```json|```/g, '').trim();
    alerts = JSON.parse(raw);
    if (!Array.isArray(alerts)) throw new Error('Non-array response');
  } catch {
    logger.warn('[agents/orchestrator] analyzeRadarData parse failed — empty alerts');
    return [];
  }

  return alerts.map(a => ({
    ...a,
    timestamp:       new Date().toISOString(),
    agentsUsed:      ['claude', 'gpt'],
    financialImpact: a.impact,
    whyBreakdown:    a.why,
    actionLabel:     a.verdict === 'KILL' ? 'Pause immediately'
                   : a.verdict === 'SCALE' ? 'Scale budget'
                   : 'Review creative',
    riskLevel:       a.risk_level,
    modeSpecificData: {},
  }));
}

/**
 * Analyzes a single campaign for a detailed verdict.
 * Adapter for paidController analyzeHandler.
 * @param {Object} data - Campaign object
 * @param {string} source - 'csv' | 'api' | 'radar-alert'
 * @returns {Promise<Object>} Single verdict object
 */
export async function analyzeCampaignData(data, source = 'csv') {
  // ── Validation Checkpoint 1: Input Data ─────────────────────
  if (!data || typeof data !== 'object') {
    logger.error({ data }, '[orchestrator] analyzeCampaignData: invalid data parameter');
    throw new Error('analyzeCampaignData requires a valid data object');
  }

  // ── Validation Checkpoint 2: Build User Prompt ──────────────
  const userPrompt = [
    'Analyze this campaign and return a single verdict JSON:',
    '{ verdict, rootCause, diagnosis, confidence, actionPlan, whyBreakdown, creativeVariants }',
    `Source: ${source}`,
    '',
    'CAMPAIGN DATA:',
    JSON.stringify(data, null, 2),
  ].join('\n');

  if (!userPrompt || userPrompt.trim().length === 0) {
    logger.error('[orchestrator] analyzeCampaignData: generated empty prompt');
    throw new Error('Failed to build analysis prompt');
  }

  logger.debug({ promptLength: userPrompt.length, source }, '[orchestrator] analyzeCampaignData: prompt built');

  // ── Validation Checkpoint 3: Call ClaudeAgent (correct params) ───
  const { text } = await runClaudeAgent({
    role: 'You are an Elite Performance Marketing Strategist. Return only valid JSON.',
    task: userPrompt,
    campaignId: null,  // No campaign context needed for CSV analysis
    maxTokens: 2000,
  });

  // ── Validation Checkpoint 4: Response Validation ────────────
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    logger.error({ text }, '[orchestrator] analyzeCampaignData: empty response from Claude');
    return { verdict: 'HOLD', diagnosis: 'Analysis failed: empty response', source, agentsUsed: ['claude'] };
  }

  try {
    const raw = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    // ── Validation Checkpoint 5: Parsed Result ──────────────────
    if (!parsed.verdict) {
      logger.warn({ parsed }, '[orchestrator] analyzeCampaignData: missing verdict in response');
      parsed.verdict = 'HOLD';
    }

    logger.info({ verdict: parsed.verdict, source }, '[orchestrator] analyzeCampaignData: success');
    return { ...parsed, source, agentsUsed: ['claude'], timestamp: new Date().toISOString() };
  } catch (parseError) {
    logger.warn({ err: parseError.message, text: text.slice(0, 200) }, '[orchestrator] analyzeCampaignData: JSON parse failed');
    return { verdict: 'HOLD', diagnosis: 'Analysis unavailable: invalid JSON', source, agentsUsed: ['claude'] };
  }
}

/**
 * Batch analysis for CSV uploads — single Claude call for all campaigns.
 * Prevents timeout by replacing N parallel API calls with one batched call.
 * @param {Array} campaigns - Array of campaign objects from CSV parser
 * @returns {Promise<Object>} { decisions: Array<Object> }
 */
export async function analyzeCampaignsBatch(campaigns) {
  if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0) {
    throw new Error('analyzeCampaignsBatch requires non-empty campaigns array');
  }

  const prompt = `Analyze these ${campaigns.length} Meta Ads campaigns and return a JSON array of decisions.

For each campaign return:
{
  "campaignId": "<string>",
  "verdict": "SCALE" | "HOLD" | "KILL" | "OPTIMIZE" | "PAUSE_AND_RELAUNCH",
  "rootCause": "<string>",
  "diagnosis": "<2-3 sentence plain-language diagnosis>",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "actionPlan": {
    "primaryAction": "<one specific action>",
    "reasoning": "<single sentence>",
    "steps": ["<step 1>", "<step 2>", ...]
  }
}

CAMPAIGNS:
${JSON.stringify(campaigns.map(c => ({
  campaignId: c.campaignId,
  campaignName: c.campaignName,
  adsetName: c.adsetName,
  metrics: c.metrics,
  deliveryStatus: c.deliveryStatus,
})), null, 2)}

Return ONLY valid JSON in this exact format:
{ "decisions": [ ... ] }`;

  const { text } = await runClaudeAgent({
    role: 'You are an Elite Performance Marketing Strategist. Analyze campaigns and return only valid JSON.',
    task: prompt,
    campaignId: null,
    maxTokens: 4096,
  });

  // Parse JSON from response
  const cleaned = text.replace(/```json|```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error({ text: text.slice(0, 200) }, '[orchestrator] analyzeCampaignsBatch: no JSON found in response');
    throw new Error('No JSON found in batch analysis response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.decisions || !Array.isArray(parsed.decisions)) {
    logger.error({ parsed }, '[orchestrator] analyzeCampaignsBatch: invalid response structure');
    throw new Error('Invalid batch analysis response: missing decisions array');
  }

  logger.info({ campaignCount: campaigns.length, decisionsCount: parsed.decisions.length }, '[orchestrator] analyzeCampaignsBatch: success');
  return parsed;
}

/**
 * Health check for the dual-agent system.
 * Adapter for paidController healthHandler.
 * @returns {Promise<Object>} Health status
 */
export async function healthCheck() {
  const anthropicOk = !!process.env.ANTHROPIC_API_KEY;
  const openaiOk    = !!process.env.OPENAI_API_KEY;
  return {
    status:    anthropicOk && openaiOk ? 'healthy' : 'degraded',
    claude:    anthropicOk ? 'ok' : 'missing key',
    chatgpt:   openaiOk    ? 'ok' : 'missing key',
    mode:      'dual-agent',
    timestamp: new Date().toISOString(),
  };
}
