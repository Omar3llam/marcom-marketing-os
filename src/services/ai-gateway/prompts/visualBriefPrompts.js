// ============================================================
// AI Gateway — visual brief prompts
// ============================================================
// Prompt templates for visual strategy and image generation briefs.
// ============================================================

export const VISUAL_BRIEF_PROMPTS = Object.freeze({
  GENERATE_VISUAL_BRIEF: {
    version: 'v1.0',
    template: `Generate a detailed visual brief for Meta ad creative.

CONTEXT:
Diagnosis: {diagnosis}
Brand Style: {brandStyle}
Target Audience: {targetAudience}
Copy Hook: {hook}

REQUIREMENTS:
- Visual concept description
- Color palette (3-5 colors)
- Composition guidelines
- Typography suggestions
- Mobile-first framing
- Platform: Meta (Feed + Stories)

OUTPUT FORMAT:
Return JSON object:
{
  "concept": "visual concept description",
  "colorPalette": ["#hex1", "#hex2", ...],
  "composition": "composition guidelines",
  "typography": "font style suggestions",
  "mobileOptimization": "mobile-specific notes",
  "rationale": "strategic reasoning"
}`,
  },

  GENERATE_VISUAL_PROMPT: {
    version: 'v1.0',
    template: `Generate a visual generation prompt for image AI (DALL·E, Midjourney).

CONTEXT:
Visual Brief: {visualBrief}
Brand Style: {brandStyle}
Output Format: {format}

REQUIREMENTS:
- Detailed scene description
- Lighting and mood
- Art style/technique
- Camera angle/framing
- Specific details to include/exclude
- Output dimensions: {dimensions}

OUTPUT FORMAT:
Return JSON object:
{
  "prompt": "detailed prompt text",
  "negativePrompt": "things to avoid",
  "styleModifiers": ["realistic", "vibrant", ...],
  "technicalParams": {
    "aspectRatio": "16:9",
    "quality": "high"
  }
}`,
  },

  GENERATE_VIDEO_PROMPT: {
    version: 'v1.0',
    template: `Generate a video generation prompt for Higgsfield/Runway.

CONTEXT:
Visual Brief: {visualBrief}
Duration: {duration} seconds
Platform: {platform}

REQUIREMENTS:
- Scene-by-scene breakdown
- Motion/animation notes
- Audio/music direction
- Pacing guidelines
- Platform-specific format (Stories/Reels/Feed)

OUTPUT FORMAT:
Return JSON object:
{
  "scenes": [
    {
      "duration": "2s",
      "description": "scene description",
      "motion": "camera/subject motion"
    }
  ],
  "audioDirection": "music/voiceover notes",
  "pacing": "fast-cut | smooth | build-up",
  "format": "9:16 | 16:9 | 1:1"
}`,
  },

  VALIDATE_CONTENT: {
    version: 'v1.0',
    template: `Validate generated content against brand guidelines and best practices.

CONTENT TO VALIDATE:
{content}

BRAND GUIDELINES:
{brandGuidelines}

VALIDATION CHECKS:
- Brand voice consistency
- Meta ad policy compliance
- Mobile readability
- CTA clarity
- Engagement potential

OUTPUT FORMAT:
Return JSON object:
{
  "isValid": true/false,
  "score": 0-100,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["improvement 1", "improvement 2"],
  "approved": true/false
}`,
  },

  RANK_VARIANTS: {
    version: 'v1.0',
    template: `Rank content variants by predicted performance.

VARIANTS:
{variants}

CONTEXT:
Target Audience: {targetAudience}
Goal: {goal}
Historical Data: {historicalData}

RANKING CRITERIA:
- Scroll-stopping power
- Message clarity
- CTA strength
- Audience fit
- Mobile optimization

OUTPUT FORMAT:
Return JSON array (sorted by rank):
[
  {
    "variant": "text",
    "rank": 1,
    "score": 0-100,
    "strengths": ["..."],
    "weaknesses": ["..."],
    "predictedCTR": "estimated %"
  }
]`,
  },
});

export function buildVisualBriefPrompt(capability, variables, decisionContext = {}) {
  const promptTemplate = VISUAL_BRIEF_PROMPTS[capability];
  if (!promptTemplate) {
    throw new Error(`Unknown visual brief capability: ${capability}`);
  }

  let prompt = promptTemplate.template;

  for (const [key, value] of Object.entries(variables)) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value || 'N/A');
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), stringValue);
  }

  // PR #32/33: Append decision context if present (re-execution guidance)
  if (decisionContext.isReExecution) {
    prompt += '\n\n---\n\n**RE-EXECUTION CONTEXT:**\n';
    prompt += 'This is a regeneration based on reviewer feedback.\n\n';

    // PR #33: Build targeted guidance based on feedbackType
    if (decisionContext.feedbackType) {
      prompt += _buildStructuredVisualFeedbackGuidance(decisionContext);
    } else {
      // PR #32: Fallback to unstructured feedback (backward compat)
      prompt += _buildUnstructuredFeedbackGuidance(decisionContext);
    }

    // PR #33: Specify what to preserve
    if (decisionContext.preserveAspects?.length > 0) {
      const aspectsList = decisionContext.preserveAspects
        .map(aspect => `- ${aspect.replace('_', ' ')}`)
        .join('\n');
      prompt += `\n**DO NOT CHANGE:**\n${aspectsList}\n\n`;
    }

    prompt += 'Incorporate the feedback while maintaining the original requirements and constraints.';
  }

  return prompt;
}

/**
 * PR #33: Build targeted prompt guidance for visual briefs based on feedback type.
 *
 * @private
 */
function _buildStructuredVisualFeedbackGuidance(decisionContext) {
  const { feedbackType, severity, feedback } = decisionContext;

  let guidance = '';

  // Severity header
  const severityLabel = severity ? `**[${severity} PRIORITY]** ` : '';

  switch (feedbackType) {
    case 'visual_concept':
      guidance += `${severityLabel}**Issue: Visual Concept**\n`;
      guidance += 'The core visual idea/metaphor needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: developing a new visual concept while keeping color palette and composition.\n\n';
      break;

    case 'color_palette':
      guidance += `${severityLabel}**Issue: Color Palette**\n`;
      guidance += 'The color choices need adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: selecting new colors while keeping the visual concept and composition.\n\n';
      break;

    case 'composition':
      guidance += `${severityLabel}**Issue: Composition**\n`;
      guidance += 'The layout/framing needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: improving composition while keeping the visual concept and color palette.\n\n';
      break;

    case 'mobile_optimization':
      guidance += `${severityLabel}**Issue: Mobile Optimization**\n`;
      guidance += 'The visual doesn\'t work well on mobile.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: optimizing for mobile viewing while keeping the core visual concept.\n\n';
      break;

    case 'brand_voice':
      guidance += `${severityLabel}**Issue: Brand Voice**\n`;
      guidance += 'The visual doesn\'t match the brand personality.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: aligning with brand voice while keeping the composition.\n\n';
      break;

    case 'brand_guidelines':
      guidance += `${severityLabel}**Issue: Brand Guidelines**\n`;
      guidance += 'The visual violates brand style guide rules.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: adhering to brand guidelines while keeping the core concept.\n\n';
      break;

    default:
      // Fallback for unknown feedbackType
      guidance += `${severityLabel}**Feedback Type: ${feedbackType}**\n`;
      if (feedback) guidance += `${feedback}\n\n`;
      break;
  }

  return guidance;
}

/**
 * PR #32: Build unstructured feedback guidance (backward compatibility).
 *
 * @private
 */
function _buildUnstructuredFeedbackGuidance(decisionContext) {
  let guidance = '';

  if (decisionContext.feedback) {
    guidance += `**Reviewer Feedback:**\n${decisionContext.feedback}\n\n`;
  }

  if (decisionContext.revisionInstructions) {
    guidance += `**Revision Instructions:**\n${decisionContext.revisionInstructions}\n\n`;
  }

  if (decisionContext.regenerationHint) {
    guidance += `**Regeneration Hint:**\n${decisionContext.regenerationHint}\n\n`;
  }

  return guidance;
}
