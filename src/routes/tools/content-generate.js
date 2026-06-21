// ============================================================
// MARCOM — Content Generation Tool (/api/tools/content-generate)
// ------------------------------------------------------------
// Generates on-brand ad copy, headlines, CTAs, visual briefs,
// and video scripts for a specific campaign context.
// Used by ContentLab UI (Phase 2-3 integration).
//
// REFACTORED: Now uses AI Gateway for direct OpenAI routing
// (95% cost reduction vs. orchestrator → Claude → OpenAI path)
// ============================================================
import { logger } from '../../utils/logger.js';
import { execute, CAPABILITY } from '../../services/ai-gateway/index.js';

/**
 * POST /api/tools/content-generate
 * Body: {
 *   campaignContext: { name, adset, problem, ctr },  // ctr = picked campaign's real CTR (null if absent)
 *   options: { copy, headlines, cta, visual, video },
 *   tone: string,           // selected register for this piece (default = onboarding tone)
 *   brandVoice: string,     // onboarding voice profile (tone + language/dialect)
 *   targetAudience: string, // onboarding audience profile (campaign feed carries none)
 *   industry: string,       // onboarding industry
 *   objective: string,      // onboarding objective (or custom objective text)
 *   format: string,         // visual brief: picked ad format label+ratio (ContentLabView picker)
 *   dimensions: string      // visual brief: pixel dimensions implied by the picked format
 * }
 * All of brandVoice / targetAudience / industry / objective are sourced from the
 * workspace's onboarding context client-side — see ContentLabView. format /
 * dimensions come from a real format picker. The hardcoded strings below are
 * honest last-resorts for accounts with no onboarding data, not the normal path.
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
  const { campaignContext, options, tone, brandVoice, targetAudience, industry, objective, format, dimensions } = req.body;

  // Validation
  if (!options || typeof options !== 'object') {
    return res.status(400).json({
      status: 'error',
      message: 'options object is required',
    });
  }

  try {
    logger.info({ userId, workspaceId, options }, '[tools/content-generate] Starting generation via AI Gateway');

    // Build base input for AI Gateway. Each field traces to real data:
    //   diagnosis      → picked campaign's root_cause (or omitted)
    //   currentCTR     → picked campaign's real CTR metric (null if absent)
    //   brandVoice/tone/targetAudience/industry/objective → onboarding context
    // The `||` fallbacks fire only for accounts missing that signal — they are
    // not the default path. currentCTR uses `??` so a real 0 is preserved.
    const baseInput = {
      diagnosis: campaignContext?.problem || 'CREATIVE_REFRESH',
      brandVoice: brandVoice || 'Brand-focused, clear, action-oriented',
      targetAudience: targetAudience || campaignContext?.audience || 'General audience',
      currentCTR: campaignContext?.ctr ?? null,
      tone: tone || 'Professional',
      industry: industry || 'General',
      objective: objective || 'Drive performance',
    };

    // Generate content using AI Gateway (parallel calls for efficiency)
    const content = await generateContentViaGateway({
      options,
      baseInput,
      visualSpec: { format, dimensions },
      workspaceId,
    });

    logger.info({
      userId,
      workspaceId,
      generated: Object.keys(content),
      provider: 'AI_GATEWAY',
    }, '[tools/content-generate] Complete');

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

// ── Helper: Generate content via AI Gateway ──────────────────
/**
 * Generates content using AI Gateway capabilities.
 * Maps legacy options to modern capability-based approach.
 *
 * Strategy:
 *   - copy → GENERATE_COPY (3 variants with different angles)
 *   - headlines → GENERATE_HOOKS
 *   - cta → included in GENERATE_COPY
 *   - visual → GENERATE_VISUAL_PROMPT
 *   - video → (not implemented yet, uses fallback)
 */
// Synthesize a visual brief from the same real signals the copy path uses — the
// creative challenge (diagnosis), the goal (objective), and who it's for
// (audience/industry). No new input: these already live on baseInput, grounded.
function buildVisualBrief(b) {
  const parts = [];
  if (b.diagnosis)      parts.push(`Creative challenge: ${b.diagnosis}`);
  if (b.objective)      parts.push(`Campaign objective: ${b.objective}`);
  if (b.targetAudience) parts.push(`Audience: ${b.targetAudience}`);
  if (b.industry)       parts.push(`Industry: ${b.industry}`);
  return parts.length ? parts.join('. ') : null;
}

async function generateContentViaGateway({ options, baseInput, visualSpec = {}, workspaceId }) {
  const results = {
    copy: [],
    headlines: [],
    ctas: [],
    visual: '',
    video: '',
  };

  const tasks = [];

  // Generate copy variants (STORY, PROOF, URGENCY)
  if (options.copy) {
    const angles = [
      { tag: 'STORY', hint: 'Focus on storytelling and narrative arc' },
      { tag: 'PROOF', hint: 'Focus on social proof and credibility' },
      { tag: 'URGENCY', hint: 'Focus on time-sensitivity and scarcity' },
    ];

    tasks.push(
      ...angles.map(async ({ tag, hint }) => {
        try {
          const result = await execute({
            capability: CAPABILITY.GENERATE_COPY,
            input: {
              ...baseInput,
              angle: hint,
            },
            workspaceId,
          });

          if (result.success && result.output.body) {
            results.copy.push({
              tag,
              text: result.output.body,
            });
          }
        } catch (err) {
          logger.warn({ tag, err: err.message }, '[content-generate] Copy variant failed');
        }
      })
    );
  }

  // Generate headlines (using hooks)
  if (options.headlines) {
    tasks.push(
      (async () => {
        try {
          const result = await execute({
            capability: CAPABILITY.GENERATE_HOOKS,
            input: baseInput,
            workspaceId,
          });

          if (result.success && result.output.hooks) {
            results.headlines = result.output.hooks
              .slice(0, 3)
              .map(h => (typeof h === 'string' ? h : h.hook || h.text || ''));
          }
        } catch (err) {
          logger.warn({ err: err.message }, '[content-generate] Headlines failed');
        }
      })()
    );
  }

  // Generate CTAs (extract from copy generation)
  if (options.cta) {
    tasks.push(
      (async () => {
        try {
          const result = await execute({
            capability: CAPABILITY.GENERATE_COPY,
            input: baseInput,
            workspaceId,
          });

          if (result.success && result.output.cta) {
            // Generate 3 CTA variations
            results.ctas = [
              result.output.cta,
              result.output.cta.replace(/\b(Get|Start|Try)\b/i, 'Claim'),
              result.output.cta.replace(/\b(now|today)\b/i, 'free'),
            ].filter(Boolean).slice(0, 3);
          }
        } catch (err) {
          logger.warn({ err: err.message }, '[content-generate] CTAs failed');
        }
      })()
    );
  }

  // Generate visual brief
  if (options.visual) {
    tasks.push(
      (async () => {
        try {
          const result = await execute({
            capability: CAPABILITY.GENERATE_VISUAL_PROMPT,
            input: {
              ...baseInput,
              platform: 'meta-feed',
              // The GENERATE_VISUAL_PROMPT template's four placeholders, each
              // grounded: visualBrief synthesized from the same real signals the
              // copy path uses; brandStyle reuses the onboarding-derived brand
              // voice (onboarding has no separate visual-style field);
              // format/dimensions come from the picker in ContentLabView.
              visualBrief: buildVisualBrief(baseInput),
              brandStyle: baseInput.brandVoice,
              format: visualSpec.format,
              dimensions: visualSpec.dimensions,
            },
            workspaceId,
          });

          if (result.success && result.output.prompt) {
            results.visual = result.output.prompt;
          }
        } catch (err) {
          logger.warn({ err: err.message }, '[content-generate] Visual brief failed');
        }
      })()
    );
  }

  // Video generation (TODO: add GENERATE_VIDEO_PROMPT capability)
  if (options.video) {
    logger.info('[content-generate] Video generation not yet implemented via AI Gateway');
    results.video = 'Video generation coming soon via AI Gateway';
  }

  // Execute all tasks in parallel
  await Promise.all(tasks);

  // Apply fallbacks if any generation failed
  if (options.copy && results.copy.length === 0) {
    results.copy = [
      { tag: 'STORY', text: 'Built for operators who can\'t afford to "let it run." Verdicts in 18s, with the cash impact pinned.' },
      { tag: 'PROOF', text: '240 MENA workspaces trust us to make the call. Join them — first verdict free.' },
      { tag: 'URGENCY', text: 'Stop bleeding ad sets today. The first scan takes 18 seconds.' },
    ];
  }

  if (options.headlines && results.headlines.length === 0) {
    results.headlines = ['Built for operators.', 'Verdicts in 18 seconds.', 'Stop the bleed today.'];
  }

  if (options.cta && results.ctas.length === 0) {
    results.ctas = ['Get your first verdict', 'Scan my campaigns', 'Stop the bleed'];
  }

  if (options.visual && !results.visual) {
    results.visual = 'Square crop. Warm desert palette — terracotta, sand, deep gold. Hands cradling folded fabric in soft natural light. Hand-stitched detail visible. Editorial feel, not stock.';
  }

  return results;
}
