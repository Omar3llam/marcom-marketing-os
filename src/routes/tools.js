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

  // ── Build system prompt ───────────────────────────────────
  const systemPrompt = `You are an expert B2B Digital Marketing Manager specialising in content strategy.

${projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : ''}Generate a strategic 4-week content calendar for **${targetMonth}** targeting the **${targetSector}** sector with the goal of: ${keyFocus}

CALENDAR REQUIREMENTS:
- Distribute posts logically across LinkedIn, X (Twitter), Facebook, and Instagram
- Each platform gets content appropriate to its format and audience
- Mix content types: thought leadership, product/service highlights, case studies, engagement posts, industry news commentary
- Respect the project's brand voice from context above

FOR EACH POST PROVIDE:
1. **Week / Date** — e.g. "Week 1 — Mon 3rd"
2. **Platform** — LinkedIn / X / Facebook / Instagram
3. **Content Copy** — Full ready-to-publish copy. CRITICAL: Always use "we/our" instead of "I/my" for brand voice. Be specific and avoid generic filler.
4. **Visual Concept** — A brief, actionable description of the visual asset (e.g. "Infographic showing 3-step process with brand colours", "Short-form video: client testimonial 15s")

FORMAT:
Use clear markdown headers per week. Group posts by week, then by day within each week.
Be specific — no placeholders like "[insert stat here]". Use real, contextually appropriate language.

End with a brief **Editorial Note** (2–3 sentences) summarising the strategic logic for this month's content mix.`;

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
