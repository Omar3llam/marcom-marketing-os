// ============================================================
// MARCOM — Tools Router  (/api/tools)
// Standalone AI-powered tools that run outside the main chat
// session flow. Each tool fetches project context from PostgreSQL,
// constructs a purpose-specific system prompt, and calls Claude.
// ============================================================
import { Router }        from 'express';
import { getProjectById } from '../models/project.js';
import { callClaude }    from '../utils/claude.js';
import { logger }        from '../utils/logger.js';
import { generateContent, listContentGenerations } from './tools/content-generate.js';
import { validate, contentGenerateSchema, contentCalendarSchema, campaignBriefSchema } from '../middleware/validate.js';

export const toolsRouter = Router();

// ── POST /api/tools/content-generate ─────────────────────────
// Content Lab: generate ad copy, headlines, CTAs, visuals, video
toolsRouter.post('/content-generate', validate(contentGenerateSchema), generateContent);

// ── GET /api/tools/content-generations ───────────────────────
// Content Lab history: workspace-scoped, newest first, last 50.
toolsRouter.get('/content-generations', listContentGenerations);

// ── POST /api/tools/content-calendar ─────────────────────────
// Body: { projectId, targetMonth, targetSector, keyFocus }
// Returns: { status, result }  — plain text / markdown from Claude
toolsRouter.post('/content-calendar', validate(contentCalendarSchema), async (req, res) => {
  const userId = req.userId;
  const { projectId, targetMonth, targetSector, keyFocus } = req.body;

  // ── Validation ────────────────────────────────────────────
  if (!projectId) {
    return res.status(400).json({ status: 'error', message: 'projectId is required' });
  }
  if (!targetMonth || !targetSector || !keyFocus) {
    return res.status(400).json({
      status: 'error',
      message: 'targetMonth, targetSector, and keyFocus are all required',
    });
  }

  // ── Load project context (with ownership check) ───────────
  let projectContext = '';
  try {
    // SECURITY: Ownership validated in query — returns null if user doesn't own project
    const project = await getProjectById(projectId, userId);
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }
    projectContext = project.context || '';
  } catch (err) {
    logger.warn({ err: err.message, userId, projectId }, '[tools/content-calendar] project lookup failed — proceeding without context');
  }

  // ── Determine B2B vs B2C orientation from sector string ──
  // The sector value includes a parenthetical label set by the dropdown
  // (e.g. "Tech (B2B)", "E-commerce & Retail (B2C)", "Healthcare (B2B/B2C)").
  const sectorUpper   = targetSector.toUpperCase();
  const isB2B         = /\(B2B/.test(targetSector) || /^(GOV|BFSI|TECH)/.test(sectorUpper);
  const isB2C         = /B2C\)/.test(targetSector) || /^(E-COMM|FMCG|HOSP)/.test(sectorUpper);
  const isMixed       = isB2B && isB2C;

  const platformStrategy = isMixed
    ? `PLATFORM STRATEGY (Mixed B2B + B2C sector):
- LinkedIn (35 %): Professional thought leadership, case studies, decision-maker targeting
- Instagram (25 %): Visual storytelling, lifestyle/aspirational content, consumer-facing
- Facebook (20 %): Community building, educational posts, broad audience reach
- X / Twitter (15 %): Industry commentary, real-time engagement, news-jacking
- TikTok / Shorts concepts (5 %): Short-form hooks where relevant to consumer segment
Tone: balance authoritative professional voice for B2B audiences with warm, relatable language for B2C audiences.`
    : isB2B
    ? `PLATFORM STRATEGY (B2B / B2G sector):
- LinkedIn (50 %): Dominant channel. Thought leadership, long-form insights, executive POVs, data-backed posts, case studies
- X / Twitter (25 %): Industry commentary, trend reaction, engagement with decision-makers
- Facebook (15 %): Professional groups, community content, event promotion
- Instagram (10 %): Brand culture, team moments, light product awareness
Tone: professional, authoritative, insight-led. Every post earns credibility before asking for action.`
    : `PLATFORM STRATEGY (B2C sector):
- Instagram (35 %): Hero channel. High-impact visuals, Reels, Stories, UGC reposts, product lifestyle
- Facebook (25 %): Community management, targeted offers, event-based content, broader reach
- TikTok / Shorts concepts (20 %): Short-form hooks, entertainment-first, trend participation, product demos
- X / Twitter (10 %): Real-time engagement, brand personality, reactive content
- LinkedIn (10 %): Brand credibility, employer brand, behind-the-scenes
Tone: energetic, consumer-centric, emotionally resonant. Lead with aspiration and social proof.`;

  // ── Build system prompt ───────────────────────────────────
  // NOTE: This string goes exclusively into the Anthropic `system` parameter
  // via callClaude({ systemPrompt }). It is NEVER injected into the messages
  // array — that array contains only the user/assistant conversation turns.
  const systemPrompt = `You are an expert Digital Marketing Strategist specialising in content calendar planning for both B2B and B2C brands.

UNIVERSAL BRAND VOICE RULE:
Always use "we/our/us" when writing copy or strategies on behalf of the brand. Never use "I/my/me". This rule applies to every post, caption, and recommendation without exception.

${projectContext ? `PROJECT CONTEXT (use to personalise every post — brand voice, differentiators, audience):\n${projectContext}\n` : ''}
TARGET: ${targetMonth} | SECTOR: ${targetSector} | GOAL: ${keyFocus}

${platformStrategy}

SECTOR INTELLIGENCE:
Analyse the chosen sector (${targetSector}) and apply these rules:
- B2B (GOV, BFSI, Tech): pain-point-driven insights, ROI framing, decision-maker language, thought leadership. Avoid casual language.
- B2C (E-commerce, FMCG, Hospitality): emotional triggers, lifestyle aspiration, social proof, urgency, short-form entertainment. Avoid corporate jargon.
- Mixed (EDU, Real Estate, Healthcare): calibrate tone per platform — professional on LinkedIn, conversational on Instagram/Facebook.

CALENDAR REQUIREMENTS:
- Produce exactly 4 weeks of content (16–20 posts total across all platforms).
- Mix content types: thought leadership, product/service highlights, case studies, engagement/poll posts, cultural moments, industry commentary.
- Every post must serve a clear commercial purpose — no filler.
- Hooks must be platform-native (a LinkedIn hook is NOT an Instagram caption).
- Include relevant cultural, national, or industry calendar moments for ${targetMonth} where applicable.
- All copy uses "we/our" — never "I/my".

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — CRITICAL REQUIREMENT
═══════════════════════════════════════════════════════════════
You MUST respond with ONLY a valid JSON object. No markdown fences, no preamble, no explanation.
Do NOT wrap in \`\`\`json ... \`\`\`. Start directly with { and end with }.

The JSON must follow this EXACT structure:

{
  "month": "${targetMonth}",
  "sector": "${targetSector}",
  "goal": "${keyFocus}",
  "editorial_note": "2-3 sentence strategic summary of the content mix logic.",
  "calendar": [
    {
      "week": 1,
      "date": "Mon 4th Aug",
      "platform": "LinkedIn",
      "copy": "Full ready-to-publish post copy using we/our. No placeholders.",
      "visual": "Concise visual concept description e.g. Carousel: 5 stats, brand colours"
    }
  ]
}

Rules for the "calendar" array:
- "week" is an integer 1–4.
- "date" is a short human-readable date string e.g. "Tue 6th Aug".
- "platform" is exactly one of: LinkedIn, X, Instagram, Facebook, TikTok.
- "copy" is the full post text — specific, no placeholder brackets, brand-voice correct.
- "visual" is a concise asset brief — one sentence maximum.
- Include 16–20 entries total spread across weeks 1–4.
ABSOLUTE OUTPUT RULE: Return ONLY the JSON object. No markdown, no intro text, no explanation, no backticks.
Your response must start with { and end with }. Any character outside the JSON will break the parser.`;

  // ── Call Claude ───────────────────────────────────────────
  try {
    logger.info({ userId, projectId, targetMonth, targetSector }, '[tools/content-calendar] Generating');

    const result = await callClaude({
      systemPrompt,
      conversationHistory: [],
      userMessage: `Generate the full 4-week content calendar for ${targetMonth}, ${targetSector} sector, goal: ${keyFocus}`,
      maxTokens: 5000,
    });

    logger.info({ userId, projectId }, '[tools/content-calendar] Done');
    return res.json({ status: 'ok', result });

  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[tools/content-calendar] Claude error');
    return res.status(500).json({ status: 'error', message: 'Calendar generation failed' });
  }
});

// ── POST /api/tools/campaign-brief ───────────────────────────
// Body: { projectId, objective, duration, budget, keyMessage, competitor }
// Returns: { status, result } — strict JSON campaign brief
toolsRouter.post('/campaign-brief', validate(campaignBriefSchema), async (req, res) => {
  const userId = req.userId;
  const { projectId, objective, duration, budget, keyMessage, competitor } = req.body;

  if (!projectId)  return res.status(400).json({ status: 'error', message: 'projectId is required' });
  if (!objective)  return res.status(400).json({ status: 'error', message: 'Campaign objective is required' });
  if (!keyMessage) return res.status(400).json({ status: 'error', message: 'Key message is required' });

  let projectContext = '';
  let projectName    = '';
  try {
    // SECURITY: Ownership validated in query — returns null if user doesn't own project
    const project = await getProjectById(projectId, userId);
    projectContext = project?.context || '';
    projectName    = project?.name    || '';
    if (!project) {
      logger.warn({ userId, projectId }, '[tools/campaign-brief] project not found or access denied — proceeding without context');
    }
  } catch (err) {
    logger.warn({ err: err.message, userId, projectId }, '[tools/campaign-brief] project lookup failed — proceeding without context');
  }

  const systemPrompt = `You are a Senior Campaign Strategist generating a full strategic campaign brief.
You write with precision, commercial clarity, and zero filler. Every section must be actionable and specific to this brand.

BRAND VOICE RULE: Always use "we/our/us" — never "I/my/me" when writing brand copy.

${projectContext ? `PROJECT CONTEXT (use throughout — brand voice, audience, differentiators, goals):\n${projectContext}\n` : ''}
CAMPAIGN INPUTS:
- Project / Brand: ${projectName || 'The client brand'}
- Objective: ${objective}
- Duration: ${duration || '4 weeks'}
- Budget range: ${budget || 'Not specified'}
- Key message: ${keyMessage}
${competitor ? `- Competitor to beat: ${competitor}` : ''}

ABSOLUTE OUTPUT RULE: Return ONLY a valid JSON object. No markdown fences, no intro text, no backticks, no explanation.
Start with { and end with }. Any character outside the JSON breaks the parser.

OUTPUT SCHEMA — return exactly this structure, fully populated, no null values:

{
  "campaignName": "<Punchy memorable campaign name — specific to this brand and objective>",
  "bigIdea": "<The single core creative concept in one sentence — the why this, why now>",
  "audience": [
    { "segment": "<Primary role/profile — specific>", "pain": "<Their real pain point>", "color": "#6366F1" },
    { "segment": "<Secondary role/profile>", "pain": "<Their pain point>", "color": "#8B5CF6" },
    { "segment": "<Tertiary role/profile>", "pain": "<Their pain point>", "color": "#A855F7" }
  ],
  "platformMix": [
    { "name": "<Platform>", "pct": <integer 1-100>, "color": "<hex color for that platform>" },
    { "name": "<Platform>", "pct": <integer>, "color": "<hex color>" },
    { "name": "<Platform>", "pct": <integer>, "color": "<hex color>" },
    { "name": "<Platform>", "pct": <integer>, "color": "<hex color>" }
  ],
  "contentPillars": [
    { "num": "01", "topic": "<Pillar name>", "sub": "<One-line description of content type>" },
    { "num": "02", "topic": "<Pillar name>", "sub": "<Description>" },
    { "num": "03", "topic": "<Pillar name>", "sub": "<Description>" },
    { "num": "04", "topic": "<Pillar name>", "sub": "<Description>" }
  ],
  "creativeDirection": {
    "visualStyle": ["<Style tag 1>", "<Style tag 2>", "<Style tag 3>"],
    "hooks": ["<Specific hook line 1 — no bracket placeholders>", "<Specific hook line 2>"]
  },
  "kpis": [
    { "label": "<Metric name>", "value": "<Target — e.g. ≤ $120>", "color": "#6366F1" },
    { "label": "<Metric>", "value": "<Target>", "color": "#22C55E" },
    { "label": "<Metric>", "value": "<Target>", "color": "#F59E0B" },
    { "label": "<Metric>", "value": "<Target>", "color": "#EF4444" },
    { "label": "<Metric>", "value": "<Target>", "color": "#8B5CF6" },
    { "label": "<Metric>", "value": "<Target>", "color": "#06B6D4" }
  ]
}

Platform color guidance (use these exact hex values):
- LinkedIn: #0077B5  · Meta/Facebook/Instagram: #1877F2  · Google: #34A853
- TikTok: #010101   · X/Twitter: #1DA1F2              · Email/Newsletter: #F59E0B
- YouTube: #FF0000  · Other: #64748B

Rules: pct values across platformMix must sum to 100. No placeholder brackets in any string field. All arrays fully populated.`;

  try {
    logger.info({ userId, projectId, objective }, '[tools/campaign-brief] Generating');
    const result = await callClaude({
      systemPrompt,
      conversationHistory: [],
      userMessage: `Generate the full campaign brief for objective: ${objective}, duration: ${duration || '4 weeks'}, key message: ${keyMessage}`,
      maxTokens: 4000,
    });
    logger.info({ userId, projectId }, '[tools/campaign-brief] Done');
    return res.json({ status: 'ok', result });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[tools/campaign-brief] Claude error');
    return res.status(500).json({ status: 'error', message: 'Brief generation failed' });
  }
});
