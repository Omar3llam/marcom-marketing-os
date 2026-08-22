// ============================================================
// MARCOM / Lumi — Claude analysis adapters
// ------------------------------------------------------------
// S1-B — THE DUAL-AGENT ORCHESTRATOR IS GONE, and with it this file's original
// reason to exist. `runOrchestration` took a campaignId, loaded the CampaignState
// row as the SUBJECT of the analysis, ran Claude then conditionally GPT for
// creative, and wrote the merged payload onto an Action row.
//
// Both of those populations are unwritable. CampaignState has had no writer
// since R7 deleted temporalObserver, and no code in this repository CREATES an
// Action row — the one remaining `prisma.action` write was an `update` on a row
// nothing mints. So the function threw "campaignState … not found" for every
// campaign in every workspace, and its only caller (the circuit breaker behind
// POST /lumi/orchestrate/:campaignId) could not reach it anyway: that route
// 404s first on the PENDING Action it requires.
//
// Retired rather than repointed. Rebuilding it against the connector entity
// graph would be a new capability wearing a cleanup's clothes, and the
// deliberate decision was to remove, not replace.
//
// WHAT SURVIVES is the set of Claude adapters paidController and
// routes/campaigns/feed.js actually call. They take campaigns as ARGUMENTS —
// they never read a decision or campaign row — which is why they were reachable
// all along while the orchestration around them was not.
// ============================================================
import { runClaudeAgent }                   from './ClaudeAgent.js';
import { logger }                           from '../utils/logger.js';


// ── Compatibility adapters for paidController ─────────────────
// These match the method signatures expected by paidController.js (previously
// from services/orchestrator). Each takes its campaigns as an argument and
// reads no table, which is why S1-B left them intact while removing the
// orchestration that used to sit above them.
// ──────────────────────────────────────────────────────────────

/**
 * Analyzes an array of campaigns and returns alert objects.
 * Adapter for paidController radarHandler.
 * @param {Array} campaigns - Raw campaign objects from Meta MCP or CSV
 * @returns {Promise<Array>} Array of alert objects
 */
export async function analyzeRadarData(campaigns) {
  // 🔍 VERIFICATION LOG — Track analyzeRadarData usage (deprecated path)
  logger.info({
    provider: 'CLAUDE',
    model: 'claude-sonnet-4.5',
    feature: 'analyzeRadarData',
    campaignCount: campaigns.length,
    deprecated: true,
  }, '[orchestrator] deprecated path — routes should use AI Gateway');

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
 * Single-campaign verdict adapter (dual-agent orchestrator).
 * @param {Object} data - Campaign object
 * @param {string} source - 'csv' | 'api' | 'radar-alert'
 * @returns {Promise<Object>} Single verdict object
 */
export async function analyzeCampaignData(data, source = 'csv') {
  // 🔍 VERIFICATION LOG — Track analyzeCampaignData usage (deprecated path)
  logger.info({
    provider: 'CLAUDE',
    model: 'claude-sonnet-4.5',
    feature: 'analyzeCampaignData',
    source,
    deprecated: true,
  }, '[orchestrator] deprecated path — routes should use AI Gateway');

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

Be extremely concise. For each campaign return ONLY:
verdict (KILL/HOLD/SCALE/OPTIMIZE/PAUSE_AND_RELAUNCH), confidence (HIGH/MEDIUM/LOW), one-line reason (max 15 words),
priority (HIGH/MEDIUM/LOW), stage (DYING/FATIGUED/TESTING/STABLE/SCALING).
No long explanations. Total response must be under 4000 tokens.

For each campaign return:
{
  "campaignId": "<string>",
  "verdict": "SCALE" | "HOLD" | "KILL" | "OPTIMIZE" | "PAUSE_AND_RELAUNCH",
  "rootCause": "<max 15 words>",
  "diagnosis": "<single sentence, max 15 words>",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "stage": "DYING" | "FATIGUED" | "TESTING" | "STABLE" | "SCALING",
  "actionPlan": {
    "primaryAction": "<one specific action, max 10 words>",
    "reasoning": "<single sentence, max 10 words>",
    "steps": ["<step 1>", "<step 2>"]
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
    maxTokens: 4000,
    skipRecommendations: true,
  });

  // Parse JSON from response
  const cleaned = text.replace(/```json|```/g, '').trim();

  // Defensive truncation guard (FIX C)
  logger.info({
    responseLength: cleaned.length,
    endsWithBracket: cleaned.endsWith('}') || cleaned.endsWith(']'),
    campaignCount: campaigns.length
  }, '[batch-analysis] About to parse AI response');

  if (!cleaned.endsWith('}') && !cleaned.endsWith(']')) {
    logger.error({
      textLength: cleaned.length,
      lastChars: cleaned.slice(-50)
    }, '[batch-analysis] Response truncated — increase max_tokens');
    throw new Error('AI response truncated mid-JSON — increase max_tokens or reduce batch size');
  }

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
