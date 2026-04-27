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

export const toolsRouter = Router();

// ── POST /api/tools/content-calendar ─────────────────────────
// Body: { projectId, targetMonth, targetSector, keyFocus }
// Returns: { status, result }  — plain text / markdown from Claude
toolsRouter.post('/content-calendar', async (req, res) => {
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
    const project = await getProjectById(projectId);
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

${projectContext ? `PROJECT CONTEXT (fetch from database — use to personalise every post):\n${projectContext}\n` : ''}
TARGET: ${targetMonth} | SECTOR: ${targetSector} | GOAL: ${keyFocus}

${platformStrategy}

SECTOR INTELLIGENCE:
Analyse the chosen sector (${targetSector}) and apply these rules:
- If the sector is primarily B2B (GOV, BFSI, Tech): focus content on pain-point-driven insights, ROI framing, decision-maker language, and long-form thought leadership formats. Avoid overly casual or consumer-centric language.
- If the sector is primarily B2C (E-commerce, FMCG, Hospitality): focus on emotional triggers, lifestyle aspiration, social proof, urgency, and short-form entertainment. Avoid corporate jargon.
- If the sector is mixed (EDU, Real Estate, Healthcare): calibrate tone per platform — professional on LinkedIn, conversational on Instagram/Facebook.

CALENDAR REQUIREMENTS:
- Produce exactly 4 weeks of content. Group by week, then by day.
- Mix content types per the platform strategy above: thought leadership, product/service highlights, case studies, engagement/poll posts, cultural moments, industry news commentary
- Every post must serve a clear commercial purpose — no filler, no generic awareness posts
- Hooks must be platform-native (a LinkedIn hook ≠ an Instagram caption)
- Include relevant cultural, national, or industry calendar moments for ${targetMonth} where applicable
- Respect the project's brand voice from the project context above

FOR EACH POST PROVIDE:
1. **Week / Date** — e.g. "Week 1 — Mon 3rd"
2. **Platform** — LinkedIn / X / Instagram / Facebook / TikTok
3. **Content Copy** — Full, ready-to-publish copy using "we/our". No placeholders. Be specific and contextually accurate.
4. **Visual Concept** — Concise, actionable asset description (e.g. "Carousel: 5 stats on sector trend, brand colours", "15s Reel: product in use with text overlay hook")

FORMAT:
Use ## Week N headers. Under each week, list each post clearly.
End with a **## Editorial Note** (2–3 sentences) explaining the strategic logic for this month's content mix and how it drives the stated goal.`;

  // ── Call Claude ───────────────────────────────────────────
  try {
    logger.info({ userId, projectId, targetMonth, targetSector }, '[tools/content-calendar] Generating');

    const result = await callClaude({
      systemPrompt,
      conversationHistory: [],
      userMessage: `Generate the full 4-week content calendar for ${targetMonth}, ${targetSector} sector, goal: ${keyFocus}`,
      maxTokens: 4000,
    });

    logger.info({ userId, projectId }, '[tools/content-calendar] Done');
    return res.json({ status: 'ok', result });

  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[tools/content-calendar] Claude error');
    return res.status(500).json({ status: 'error', message: err.message || 'Calendar generation failed' });
  }
});
