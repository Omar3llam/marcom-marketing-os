// ============================================================
// Feedback Type System — PR #33: Structured Review Decisions
// ============================================================
// Defines taxonomy for categorizing reviewer feedback.
//
// PURPOSE:
//   Enable intelligent prompt mutation based on feedback type,
//   rather than blindly appending all feedback to every prompt.
//
// USAGE:
//   Frontend sends structured decisions:
//   {
//     decision: "REGENERATE",
//     feedbackType: "HOOK_ANGLE",
//     severity: "HIGH",
//     feedback: "Add urgency in first 5 words",
//     preserveAspects: ["brand_voice", "cta"]
//   }
//
//   Backend routes feedback to specific prompt layers.
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

// ============================================================
// Validation
// ============================================================

/**
 * Validate feedbackType value.
 *
 * @param {string} feedbackType
 * @returns {boolean}
 */
export function isValidFeedbackType(feedbackType) {
  if (!feedbackType) return true; // Optional field
  return Object.values(FEEDBACK_TYPE).includes(feedbackType);
}

/**
 * Validate severity value.
 *
 * @param {string} severity
 * @returns {boolean}
 */
export function isValidSeverity(severity) {
  if (!severity) return true; // Optional field
  return Object.values(SEVERITY).includes(severity);
}

/**
 * Validate preserveAspects array.
 *
 * @param {string[]} preserveAspects
 * @returns {boolean}
 */
export function isValidPreserveAspects(preserveAspects) {
  if (!preserveAspects) return true; // Optional field
  if (!Array.isArray(preserveAspects)) return false;

  const validAspects = Object.values(PRESERVE_ASPECT);
  return preserveAspects.every(aspect => validAspects.includes(aspect));
}

/**
 * Validate full structured feedback object.
 *
 * @param {Object} structuredFeedback - { feedbackType?, severity?, preserveAspects? }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStructuredFeedback(structuredFeedback) {
  const errors = [];

  if (!structuredFeedback) {
    return { valid: true, errors: [] }; // Optional
  }

  if (structuredFeedback.feedbackType && !isValidFeedbackType(structuredFeedback.feedbackType)) {
    errors.push(`Invalid feedbackType: ${structuredFeedback.feedbackType}`);
  }

  if (structuredFeedback.severity && !isValidSeverity(structuredFeedback.severity)) {
    errors.push(`Invalid severity: ${structuredFeedback.severity}`);
  }

  if (structuredFeedback.preserveAspects && !isValidPreserveAspects(structuredFeedback.preserveAspects)) {
    errors.push('Invalid preserveAspects: must be array of valid aspect strings');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================
// Type Guards (for runtime type checking)
// ============================================================

/**
 * Check if feedback is content-related.
 *
 * @param {string} feedbackType
 * @returns {boolean}
 */
export function isContentFeedback(feedbackType) {
  return [
    FEEDBACK_TYPE.HOOK_ANGLE,
    FEEDBACK_TYPE.TONE,
    FEEDBACK_TYPE.CTA,
    FEEDBACK_TYPE.CLARITY,
    FEEDBACK_TYPE.LENGTH,
  ].includes(feedbackType);
}

/**
 * Check if feedback is brand-related.
 *
 * @param {string} feedbackType
 * @returns {boolean}
 */
export function isBrandFeedback(feedbackType) {
  return [
    FEEDBACK_TYPE.BRAND_VOICE,
    FEEDBACK_TYPE.BRAND_GUIDELINES,
  ].includes(feedbackType);
}

/**
 * Check if feedback is strategy-related.
 *
 * @param {string} feedbackType
 * @returns {boolean}
 */
export function isStrategyFeedback(feedbackType) {
  return [
    FEEDBACK_TYPE.AUDIENCE_FIT,
    FEEDBACK_TYPE.MESSAGE_POSITIONING,
    FEEDBACK_TYPE.CREATIVE_ANGLE,
  ].includes(feedbackType);
}

/**
 * Check if feedback is visual-related.
 *
 * @param {string} feedbackType
 * @returns {boolean}
 */
export function isVisualFeedback(feedbackType) {
  return [
    FEEDBACK_TYPE.VISUAL_CONCEPT,
    FEEDBACK_TYPE.COLOR_PALETTE,
    FEEDBACK_TYPE.COMPOSITION,
    FEEDBACK_TYPE.MOBILE_OPTIMIZATION,
  ].includes(feedbackType);
}
