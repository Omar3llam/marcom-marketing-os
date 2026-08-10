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
// What goes into the prompt when the decision-memory read did not return a
// list. Matches the '(none)' convention the other grounding slots already use,
// and is deliberately NOT an empty array — see the RECENT DECISION MEMORY line.
export const MEMORY_UNAVAILABLE = '(unavailable — decision memory could not be read)';

async function analyzeWithClaude({ campaignState, decisionMemory, contextLock, grounding = {} }) {
  const role =
    'You are an Elite Performance Marketing Strategist. ' +
    'You diagnose ad-platform campaigns from raw metrics + the brand context lock + ' +
    'recent decision memory, and return a strict JSON verdict. Deterministic engines have ' +
    'already computed the per-level verdicts, the fatigue forecast, and any guardrail hits — ' +
    'treat those as the source of truth and explain/reconcile them; do not contradict them.';

  const { levelVerdicts = null, fatigueForecast = null, guardrailHits = null } = grounding;

  const task = [
    'Analyze the campaign below and return JSON with this EXACT shape (no markdown fences, no commentary):',
    '{',
    '  "verdict": "KILL" | "HOLD" | "SCALE" | "REFRESH" | "REALLOCATE" | "WATCH",',
    '  "rootCause": "CRITICAL_PERFORMANCE_DECLINE" | "CREATIVE_FATIGUE" | "AUDIENCE_SATURATION" | "SCALING_OPPORTUNITY" | "OTHER",',
    '  "diagnosis": "<2-3 sentence plain-language diagnosis>",',
    '  "levelVerdicts": [ { "level": "CAMPAIGN"|"ADSET"|"CREATIVE", "entityId": "<id>", "verdict": "<verdict>", "rationale": "<one sentence>" } ],',
    '  "fatigueForecast": { "willBreach": <bool>, "metric": "frequency", "daysToBreach": <number|null>, "projectedBreachDate": "<ISO|null>", "note": "<plain-language, e.g. \'breaches frequency 3.5 in ~3 days\'>" },',
    '  "actionPlan": { "action": "<one specific action>", "expectedImpact": "<single sentence>" },',
    '  "confidence": <integer 0-100, your certainty in this verdict>,',
    '  "riskLevel": "High" | "Medium" | "Low",',
    '  "evidenceCount": <integer, number of metrics/signals analyzed>,',
    '  "financialImpact": "<string in EGP, e.g. \'Wasting EGP 2,400/week\' or \'Could gain EGP 15,000/month\'>"',
    '}',
    '',
    'RULES: The top-level "verdict" must equal the CAMPAIGN-level verdict in DETERMINISTIC LEVEL VERDICTS when provided. ',
    'Echo DETERMINISTIC LEVEL VERDICTS into "levelVerdicts" (you may add a rationale). ',
    'Echo the DETERMINISTIC FATIGUE FORECAST into "fatigueForecast" with a human-readable "note". ',
    'AI must be auditable: include confidence (0-100), risk level, evidence count, financial impact in EGP.',
    '',
    'CAMPAIGN STATE:',                 JSON.stringify(campaignState ?? {}, null, 2),
    'DETERMINISTIC LEVEL VERDICTS:',   JSON.stringify(levelVerdicts ?? '(none — derive from state)', null, 2),
    'DETERMINISTIC FATIGUE FORECAST:', JSON.stringify(fatigueForecast ?? '(none)', null, 2),
    'GUARDRAIL HITS:',                 JSON.stringify(guardrailHits ?? '(none)', null, 2),
    // `?? []` was the bug: it turned "we could not read the memory source" into
    // "there is no memory", and the role prompt above tells the model it
    // diagnoses partly FROM recent decision memory — so an empty array reads as
    // a fact about this account rather than a gap in ours. null now gets the
    // same honest-sentinel treatment its three siblings already use. A real
    // empty array still renders "[]", byte-identical to before.
    'RECENT DECISION MEMORY:',         JSON.stringify(decisionMemory ?? MEMORY_UNAVAILABLE, null, 2),
    'BRAND CONTEXT LOCK:',             JSON.stringify(contextLock ?? {}, null, 2),
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
export async function runOrchestration({ campaignId, workspaceId, actionId, userId, grounding = {} }) {
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
      // Decoration, not a precondition. Decision memory colours the diagnosis;
      // it is not what is being diagnosed. A legacy-table read that fails must
      // not take down the orchestration around it — before this, a rejection
      // here failed the whole Promise.all and the Claude call never happened.
      // null (not []) so the prompt can tell "no memory" from "no memory READ";
      // see MEMORY_UNAVAILABLE above.
    }).catch((err) => {
      logger.warn({ err: err.message, workspaceId }, '[orchestrator] decision memory unavailable — continuing without it');
      return null;
    }),
  ]);

  // CampaignState is a different matter and still throws: it is the SUBJECT of
  // the analysis, not context for it. There is nothing to diagnose without it,
  // and inventing one would fabricate the campaign itself.
  if (!campaign) {
    throw new Error(`orchestrator: campaignState ${campaignId} not found`);
  }

  const contextLock = user?.context ?? null;

  // ── Agent 1: Claude (always) ────────────────────────────────
  // 🔍 VERIFICATION LOG — Track orchestrator usage
  logger.info({
    provider: 'CLAUDE',
    model: 'claude-sonnet-4.5',
    feature: 'strategic-analysis',
    campaignId,
  }, '[orchestrator] dual-agent verification');

  let strategicAnalysis;
  try {
    strategicAnalysis = await analyzeWithClaude({
      campaignState:  campaign,
      decisionMemory: memory,
      contextLock,
      grounding, // deterministic levelVerdicts / fatigueForecast / guardrailHits
    });
  } catch (err) {
    logger.error({ err: err.message, campaignId }, '[orchestrator] Claude failed');
    throw new Error(`Strategic analysis failed: ${err.message}`);
  }

  // ── Agent 2: OpenAI (conditional) ───────────────────────────
  let creativeAssets = null;
  // REFRESH verdicts always warrant a creative pass (the whole point of the
  // verdict is to swap creative), in addition to the root-cause triggers.
  const needsCreative =
    CREATIVE_TRIGGERS.has(strategicAnalysis?.rootCause) ||
    strategicAnalysis?.verdict === 'REFRESH';

  if (needsCreative) {
    // 🔍 VERIFICATION LOG — Track orchestrator OpenAI usage
    logger.info({
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      feature: 'creative-generation',
      campaignId,
      trigger: strategicAnalysis?.rootCause,
    }, '[orchestrator] dual-agent verification');

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
