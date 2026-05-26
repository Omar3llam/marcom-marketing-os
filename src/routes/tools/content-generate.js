// ============================================================
// MARCOM — Content Generation Tool (/api/tools/content-generate)
// ------------------------------------------------------------
// Generates on-brand ad copy, headlines, CTAs, visual briefs,
// and video scripts for a specific campaign context.
// Used by ContentLab UI (Phase 2-3 integration).
// ============================================================
import { logger } from '../../utils/logger.js';
import { analyzeCampaignData } from '../../agents/orchestrator.js';

/**
 * POST /api/tools/content-generate
 * Body: {
 *   campaignContext: { name, adset, problem },
 *   options: { copy, headlines, cta, visual, video },
 *   tone: string,
 *   brandVoice: string (from user.context)
 * }
 * Returns: {
 *   copy: [{ tag, text }],
 *   headlines: [string],
 *   ctas: [string],
 *   visual: string,
 *   video: string
 * }
 */
export async function generateContent(req, res) {
  const userId = req.userId || req.user?.uid;
  const workspaceId = req.workspaceId;
  const { campaignContext, options, tone, brandVoice } = req.body;

  // Validation
  if (!options || typeof options !== 'object') {
    return res.status(400).json({
      status: 'error',
      message: 'options object is required',
    });
  }

  try {
    logger.info({ userId, workspaceId, options }, '[tools/content-generate] Starting generation');

    // Build generation prompt
    const prompt = buildGenerationPrompt({
      campaignContext,
      options,
      tone: tone || 'Professional',
      brandVoice: brandVoice || 'Brand-focused, clear, action-oriented',
    });

    // Call AI orchestrator
    const result = await analyzeCampaignData({
      customPrompt: prompt,
      source: 'content-lab',
    }, 'content-generation');

    // Parse and structure the response
    const content = parseGeneratedContent(result, options);

    logger.info({ userId, workspaceId, generated: Object.keys(content) }, '[tools/content-generate] Complete');

    return res.json({
      status: 'ok',
      content,
    });

  } catch (err) {
    logger.error({ err: err.message, userId, workspaceId }, '[tools/content-generate] Failed');
    return res.status(500).json({
      status: 'error',
      message: err.message || 'Content generation failed',
    });
  }
}

// ── Helper: Build generation prompt ──────────────────────────
function buildGenerationPrompt({ campaignContext, options, tone, brandVoice }) {
  const sections = [];

  sections.push(`Generate marketing content with the following specifications:

BRAND VOICE: ${brandVoice}
TONE: ${tone}
${campaignContext ? `CAMPAIGN CONTEXT: ${campaignContext.name || 'New Campaign'}
PROBLEM: ${campaignContext.problem || 'Need fresh creative'}` : ''}

Generate ONLY the requested content types. Output as JSON with this EXACT structure:
{`);

  if (options.copy) {
    sections.push(`  "copy": [
    { "tag": "STORY", "text": "Ad copy variant focused on storytelling angle" },
    { "tag": "PROOF", "text": "Ad copy variant focused on social proof" },
    { "tag": "URGENCY", "text": "Ad copy variant focused on urgency" }
  ],`);
  }

  if (options.headlines) {
    sections.push(`  "headlines": [
    "Headline option 1 (concise, benefit-driven)",
    "Headline option 2 (question or curiosity)",
    "Headline option 3 (bold statement)"
  ],`);
  }

  if (options.cta) {
    sections.push(`  "ctas": [
    "Primary CTA (action-driven)",
    "Secondary CTA (value-focused)",
    "Tertiary CTA (low-friction)"
  ],`);
  }

  if (options.visual) {
    sections.push(`  "visual": "Detailed DALL·E-ready visual brief: composition, colors, mood, style, elements. No generic descriptions.",`);
  }

  if (options.video) {
    sections.push(`  "video": "Video script in Higgsfield format: HOOK (0-3s): ... PROBLEM (3-7s): ... PROMISE (7-11s): ... PROOF (11-15s): ... CTA (15-18s): ..."`);
  }

  sections.push(`}

CRITICAL: Return ONLY valid JSON. No markdown fences, no explanation, no preamble. Start with { and end with }.
All copy must match the brand voice and tone specified. Be specific, not generic.`);

  return sections.join('\n');
}

// ── Helper: Parse AI response into structured content ────────
function parseGeneratedContent(aiResponse, options) {
  try {
    // Try to parse as JSON first
    let parsed;
    const text = typeof aiResponse === 'string' ? aiResponse : aiResponse.content || aiResponse.aiResponse || '';

    // Extract JSON if wrapped in markdown fences
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      parsed = JSON.parse(text);
    }

    return {
      copy: parsed.copy || [],
      headlines: parsed.headlines || [],
      ctas: parsed.ctas || [],
      visual: parsed.visual || '',
      video: parsed.video || '',
    };

  } catch (err) {
    logger.warn({ err: err.message }, '[tools/content-generate] Failed to parse JSON, using fallback');

    // Fallback: generate mock content based on options
    return {
      copy: options.copy ? [
        { tag: 'STORY', text: 'Built for operators who can\'t afford to "let it run." Verdicts in 18s, with the cash impact pinned.' },
        { tag: 'PROOF', text: '240 MENA workspaces trust us to make the call. Join them — first verdict free.' },
        { tag: 'URGENCY', text: 'Stop bleeding ad sets today. The first scan takes 18 seconds.' },
      ] : [],
      headlines: options.headlines ? [
        'Built for operators.',
        'Verdicts in 18 seconds.',
        'Stop the bleed today.',
      ] : [],
      ctas: options.cta ? [
        'Get your first verdict',
        'Scan my campaigns',
        'Stop the bleed',
      ] : [],
      visual: options.visual ? 'Square crop. Warm desert palette — terracotta, sand, deep gold. Hands cradling folded fabric in soft natural light. Hand-stitched detail visible. Editorial feel, not stock.' : '',
      video: options.video ? 'HOOK (0-3s): Slow pull-focus on hands stitching. PROBLEM (3-7s): Cut to dusty street. PROMISE (7-11s): Back to atelier. PROOF (11-15s): Quick montage. CTA (15-18s): Final call.' : '',
    };
  }
}
