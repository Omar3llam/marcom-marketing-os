// ============================================================
// Feedback Type System — PR #33/36: Structured Review Decisions
// ============================================================
// Frontend copy of backend feedbackTypes.js for UI forms.
// Defines taxonomy for categorizing reviewer feedback.
//
// USAGE:
//   Approval UI sends structured decisions:
//   {
//     decision: "REGENERATE",
//     feedbackType: FEEDBACK_TYPE.HOOK_ANGLE,
//     severity: SEVERITY.HIGH,
//     feedback: "Add urgency in first 5 words",
//     preserveAspects: [PRESERVE_ASPECT.BRAND_VOICE, PRESERVE_ASPECT.CTA]
//   }
// ============================================================

/**
 * Feedback taxonomy — categorizes what aspect needs change.
 *
 * @enum {string}
 */
export const FEEDBACK_TYPE = Object.freeze({
  // ──────────────────────────────────────────────────────────
  // Content Quality
  // ──────────────────────────────────────────────────────────
  HOOK_ANGLE: 'hook_angle',           // Hook's psychological trigger (problem/benefit/curiosity)
  TONE: 'tone',                       // Voice/personality (urgent/casual/professional)
  CTA: 'cta',                         // Call-to-action strength/clarity
  CLARITY: 'clarity',                 // Message understandability
  LENGTH: 'length',                   // Too long/short

  // ──────────────────────────────────────────────────────────
  // Brand Compliance
  // ──────────────────────────────────────────────────────────
  BRAND_VOICE: 'brand_voice',         // Doesn't match brand personality
  BRAND_GUIDELINES: 'brand_guidelines', // Violates style guide rules

  // ──────────────────────────────────────────────────────────
  // Strategy
  // ──────────────────────────────────────────────────────────
  AUDIENCE_FIT: 'audience_fit',       // Doesn't resonate with target audience
  MESSAGE_POSITIONING: 'message_positioning', // Wrong value prop/angle
  CREATIVE_ANGLE: 'creative_angle',   // Problem-solution vs aspirational focus

  // ──────────────────────────────────────────────────────────
  // Visual (briefs only)
  // ──────────────────────────────────────────────────────────
  VISUAL_CONCEPT: 'visual_concept',   // Core visual idea/metaphor
  COLOR_PALETTE: 'color_palette',     // Color choices
  COMPOSITION: 'composition',         // Layout/framing
  MOBILE_OPTIMIZATION: 'mobile_optimization', // Not mobile-friendly

  // ──────────────────────────────────────────────────────────
  // Technical
  // ──────────────────────────────────────────────────────────
  FORMAT: 'format',                   // Structural issues (JSON/markdown/etc)
  PLATFORM_COMPLIANCE: 'platform_compliance', // Violates Meta ad policies

  // ──────────────────────────────────────────────────────────
  // Meta (system-level issues)
  // ──────────────────────────────────────────────────────────
  INSUFFICIENT_CONTEXT: 'insufficient_context', // AI needs more input data
  WRONG_CAPABILITY: 'wrong_capability', // Wrong AI capability used

  // ──────────────────────────────────────────────────────────
  // Generic fallback
  // ──────────────────────────────────────────────────────────
  OTHER: 'other',                     // Free-form feedback (backward compat)
});

/**
 * Severity levels — how critical is the issue?
 *
 * @enum {string}
 */
export const SEVERITY = Object.freeze({
  LOW: 'LOW',       // Minor tweak, cosmetic change
  MEDIUM: 'MEDIUM', // Noticeable issue, should fix
  HIGH: 'HIGH',     // Critical flaw, must fix before publishing
});

/**
 * Preservable aspects — what should NOT change during regeneration.
 * These map to prompt construction layers.
 *
 * @enum {string}
 */
export const PRESERVE_ASPECT = Object.freeze({
  // Content layers
  BRAND_VOICE: 'brand_voice',
  TONE: 'tone',
  CTA: 'cta',
  HOOK_ANGLE: 'hook_angle',
  LENGTH: 'length',

  // Strategy layers
  AUDIENCE: 'audience',
  MESSAGE_POSITIONING: 'message_positioning',
  CREATIVE_ANGLE: 'creative_angle',

  // Visual layers
  COLOR_PALETTE: 'color_palette',
  COMPOSITION: 'composition',
  VISUAL_CONCEPT: 'visual_concept',
});

/**
 * Approval decisions — reviewer outcomes.
 *
 * @enum {string}
 */
export const DECISION = Object.freeze({
  APPROVED: 'APPROVED',               // Artifact is good to use
  REJECTED: 'REJECTED',               // Artifact is unacceptable, don't use
  REGENERATE: 'REGENERATE',           // Generate completely new artifact
  REQUEST_REVISION: 'REQUEST_REVISION', // Modify existing artifact
  ESCALATE: 'ESCALATE',               // Send to senior reviewer
});

// ============================================================
// Human-Readable Labels
// ============================================================

export const FEEDBACK_TYPE_LABELS = {
  [FEEDBACK_TYPE.HOOK_ANGLE]: 'Hook Angle',
  [FEEDBACK_TYPE.TONE]: 'Tone/Voice',
  [FEEDBACK_TYPE.CTA]: 'Call to Action',
  [FEEDBACK_TYPE.CLARITY]: 'Clarity',
  [FEEDBACK_TYPE.LENGTH]: 'Length',
  [FEEDBACK_TYPE.BRAND_VOICE]: 'Brand Voice',
  [FEEDBACK_TYPE.BRAND_GUIDELINES]: 'Brand Guidelines',
  [FEEDBACK_TYPE.AUDIENCE_FIT]: 'Audience Fit',
  [FEEDBACK_TYPE.MESSAGE_POSITIONING]: 'Message Positioning',
  [FEEDBACK_TYPE.CREATIVE_ANGLE]: 'Creative Angle',
  [FEEDBACK_TYPE.VISUAL_CONCEPT]: 'Visual Concept',
  [FEEDBACK_TYPE.COLOR_PALETTE]: 'Color Palette',
  [FEEDBACK_TYPE.COMPOSITION]: 'Composition',
  [FEEDBACK_TYPE.MOBILE_OPTIMIZATION]: 'Mobile Optimization',
  [FEEDBACK_TYPE.FORMAT]: 'Format',
  [FEEDBACK_TYPE.PLATFORM_COMPLIANCE]: 'Platform Compliance',
  [FEEDBACK_TYPE.INSUFFICIENT_CONTEXT]: 'Insufficient Context',
  [FEEDBACK_TYPE.WRONG_CAPABILITY]: 'Wrong Capability',
  [FEEDBACK_TYPE.OTHER]: 'Other',
};

export const PRESERVE_ASPECT_LABELS = {
  [PRESERVE_ASPECT.BRAND_VOICE]: 'Brand Voice',
  [PRESERVE_ASPECT.TONE]: 'Tone',
  [PRESERVE_ASPECT.CTA]: 'Call to Action',
  [PRESERVE_ASPECT.HOOK_ANGLE]: 'Hook Angle',
  [PRESERVE_ASPECT.LENGTH]: 'Length',
  [PRESERVE_ASPECT.AUDIENCE]: 'Target Audience',
  [PRESERVE_ASPECT.MESSAGE_POSITIONING]: 'Message Positioning',
  [PRESERVE_ASPECT.CREATIVE_ANGLE]: 'Creative Angle',
  [PRESERVE_ASPECT.COLOR_PALETTE]: 'Color Palette',
  [PRESERVE_ASPECT.COMPOSITION]: 'Composition',
  [PRESERVE_ASPECT.VISUAL_CONCEPT]: 'Visual Concept',
};

/**
 * Get feedback types relevant to artifact type.
 *
 * @param {string} artifactType - Artifact type (e.g., 'visual_brief', 'ad_copy')
 * @returns {string[]} Relevant feedback types
 */
export function getFeedbackTypesForArtifact(artifactType) {
  const visualTypes = ['visual_brief', 'image', 'video'];
  const copyTypes = ['ad_copy', 'hook', 'caption', 'headline'];

  if (visualTypes.includes(artifactType)) {
    return [
      FEEDBACK_TYPE.VISUAL_CONCEPT,
      FEEDBACK_TYPE.COLOR_PALETTE,
      FEEDBACK_TYPE.COMPOSITION,
      FEEDBACK_TYPE.MOBILE_OPTIMIZATION,
      FEEDBACK_TYPE.BRAND_GUIDELINES,
      FEEDBACK_TYPE.AUDIENCE_FIT,
      FEEDBACK_TYPE.OTHER,
    ];
  }

  if (copyTypes.includes(artifactType)) {
    return [
      FEEDBACK_TYPE.HOOK_ANGLE,
      FEEDBACK_TYPE.TONE,
      FEEDBACK_TYPE.CTA,
      FEEDBACK_TYPE.CLARITY,
      FEEDBACK_TYPE.LENGTH,
      FEEDBACK_TYPE.BRAND_VOICE,
      FEEDBACK_TYPE.AUDIENCE_FIT,
      FEEDBACK_TYPE.MESSAGE_POSITIONING,
      FEEDBACK_TYPE.OTHER,
    ];
  }

  // Generic fallback
  return Object.values(FEEDBACK_TYPE);
}
