// ============================================================
// AI Gateway — caption & audience prompts
// ============================================================
// Prompt templates for caption variants and audience hypotheses.
// ============================================================

export const CAPTION_PROMPTS = Object.freeze({
  GENERATE_AUDIENCE_HYPOTHESES: {
    version: 'v1.0',
    template: `Generate 2 audience hypotheses based on campaign performance.

CONTEXT:
Diagnosis: {diagnosis}
Current Audience: {currentAudience}
Performance Data: {performanceData}

REQUIREMENTS:
- Hypothesis 1: Refined targeting (narrower)
- Hypothesis 2: Expansion targeting (broader)
- Include demographic/psychographic attributes
- Provide rationale based on data

OUTPUT FORMAT:
Return JSON array:
[
  {
    "hypothesis": "description",
    "targeting": "refined | expansion",
    "demographics": {...},
    "rationale": "data-driven reasoning"
  }
]`,
  },

  GENERATE_ANGLE_VARIANTS: {
    version: 'v1.0',
    template: `Generate 2 creative angle variants to test.

CONTEXT:
Diagnosis: {diagnosis}
Current Angle: {currentAngle}
Target Audience: {targetAudience}
Product: {productName}

REQUIREMENTS:
- Angle 1: Problem-solution focus
- Angle 2: Aspirational/transformational focus
- Must resonate with target audience pain points
- Include messaging direction for each angle

OUTPUT FORMAT:
Return JSON array:
[
  {
    "angle": "angle name",
    "focus": "problem-solution | aspirational",
    "messagingDirection": "description",
    "rationale": "why this angle"
  }
]`,
  },
});

export function buildCaptionPrompt(capability, variables, decisionContext = {}) {
  const promptTemplate = CAPTION_PROMPTS[capability];
  if (!promptTemplate) {
    throw new Error(`Unknown caption capability: ${capability}`);
  }

  let prompt = promptTemplate.template;

  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || 'N/A');
  }

  // PR #32/33: Append decision context if present (re-execution guidance)
  if (decisionContext.isReExecution) {
    prompt += '\n\n---\n\n**RE-EXECUTION CONTEXT:**\n';
    prompt += 'This is a regeneration based on reviewer feedback.\n\n';

    // PR #33: Build targeted guidance based on feedbackType
    if (decisionContext.feedbackType) {
      prompt += _buildStructuredStrategyFeedbackGuidance(decisionContext);
    } else {
      // PR #32: Fallback to unstructured feedback (backward compat)
      prompt += _buildUnstructuredFeedbackGuidance(decisionContext);
    }

    // PR #33: Specify what to preserve
    if (decisionContext.preserveAspects && decisionContext.preserveAspects.length > 0) {
      prompt += '\n**DO NOT CHANGE:**\n';
      decisionContext.preserveAspects.forEach(aspect => {
        prompt += `- ${aspect.replace('_', ' ')}\n`;
      });
      prompt += '\n';
    }

    prompt += 'Incorporate the feedback while maintaining the original requirements and constraints.';
  }

  return prompt;
}

/**
 * PR #33: Build targeted prompt guidance for audience/angle strategy based on feedback type.
 *
 * @private
 */
function _buildStructuredStrategyFeedbackGuidance(decisionContext) {
  const { feedbackType, severity, feedback } = decisionContext;

  let guidance = '';

  // Severity header
  const severityLabel = severity ? `**[${severity} PRIORITY]** ` : '';

  switch (feedbackType) {
    case 'audience_fit':
      guidance += `${severityLabel}**Issue: Audience Fit**\n`;
      guidance += 'The targeting doesn\'t resonate with the intended audience.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: adjusting demographic/psychographic attributes while keeping the targeting strategy.\n\n';
      break;

    case 'message_positioning':
      guidance += `${severityLabel}**Issue: Message Positioning**\n`;
      guidance += 'The value proposition needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: repositioning the message angle while keeping the audience.\n\n';
      break;

    case 'creative_angle':
      guidance += `${severityLabel}**Issue: Creative Angle**\n`;
      guidance += 'The problem-solution vs aspirational focus needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: changing the creative angle while keeping the messaging direction.\n\n';
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
