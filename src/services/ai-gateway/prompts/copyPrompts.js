// ============================================================
// AI Gateway — copy generation prompts
// ============================================================
// Prompt templates for generating ad copy, hooks, and captions.
//
// INPUT VARIABLES:
//   {diagnosis}, {brandVoice}, {targetAudience}, {currentCTR}
//   GENERATE_COPY (v1.2) also: {industry}, {objective}, {tone}, {angle}
//   GENERATE_HOOKS (v1.2) also: {objective}, {tone}
//   GENERATE_COPY (v1.2) + GENERATE_HOOKS (v1.2): {campaignIntel} — an OPTIONAL
//     freeform block of live campaign performance (Content Lab auto-injects it);
//     absent → renders as nothing, never the 'N/A' placeholder.
//
// VERSIONING:
//   Never modify existing prompts — create new versions.
//
// PR #34: Integrated with Selective Prompt Mutation Engine
// ============================================================
import { applyPromptMutation, hasMutationRule } from './promptMutationEngine.js';

export const COPY_PROMPTS = Object.freeze({
  GENERATE_HOOKS: {
    version: 'v1.2',
    template: `Generate 3 high-converting ad hooks for Meta ads.

CONTEXT:
Diagnosis: {diagnosis}
Campaign Objective: {objective}
Brand Voice: {brandVoice}
Tone for this piece: {tone}
Target Audience: {targetAudience}
Current CTR: {currentCTR}%

{campaignIntel}

REQUIREMENTS:
- 40-60 characters per hook
- Scroll-stopping and curiosity-driven
- Test different psychological triggers:
  * Hook 1: Problem-focused
  * Hook 2: Benefit-focused
  * Hook 3: Curiosity-driven
- No emojis in hooks
- Mobile-first readability

OUTPUT FORMAT:
Return JSON array:
[
  {
    "hook": "text here",
    "angle": "problem | benefit | curiosity",
    "rationale": "why this works"
  }
]`,
  },

  GENERATE_CAPTIONS: {
    version: 'v1.0',
    template: `Generate 2 ad caption variants optimized for engagement.

CONTEXT:
Diagnosis: {diagnosis}
Brand Voice: {brandVoice}
Target Audience: {targetAudience}
Goal: {goal}

REQUIREMENTS:
- 125-150 characters per caption
- Include clear CTA
- Max 2 emojis per caption
- One variant: direct/urgent
- One variant: story-driven/relatable
- Must complement the hook (not repeat it)

OUTPUT FORMAT:
Return JSON array:
[
  {
    "caption": "text here",
    "cta": "Shop Now | Learn More | Sign Up",
    "tone": "urgent | relatable",
    "rationale": "why this works"
  }
]`,
  },

  // v1.1 — grounded in the workspace's onboarding profile (industry, objective,
  // brand tone) and the picked campaign's real CTR, plus a per-variant {angle}
  // so STORY/PROOF/URGENCY actually diverge. New placeholders resolve to 'N/A'
  // for any caller that omits them (buildCopyPrompt default), so this stays
  // backward-compatible. GENERATE_COPY is Content-Lab-exclusive — no other
  // capability consumer is affected.
  GENERATE_COPY: {
    version: 'v1.2',
    template: `Generate complete ad copy (hook + body) for Meta ads.

CONTEXT:
Diagnosis: {diagnosis}
Industry: {industry}
Campaign Objective: {objective}
Brand Voice: {brandVoice}
Tone for this piece: {tone}
Target Audience: {targetAudience}
Current CTR: {currentCTR}%
Product/Service: {productName}
Key Benefits: {benefits}

{campaignIntel}

ANGLE FOR THIS VARIANT:
{angle}

REQUIREMENTS:
- Hook: 40-60 characters
- Body: 125-150 characters
- Lead with the angle above — each variant must take a distinct angle
- Match the brand voice and the tone specified for this piece
- Clear value proposition
- Strong CTA
- Mobile-optimized formatting

OUTPUT FORMAT:
Return JSON object:
{
  "hook": "text here",
  "body": "text here",
  "cta": "text here",
  "rationale": "strategic approach"
}`,
  },
});

export function buildCopyPrompt(capability, variables, decisionContext = {}) {
  const promptTemplate = COPY_PROMPTS[capability];
  if (!promptTemplate) {
    throw new Error(`Unknown copy capability: ${capability}`);
  }

  let prompt = promptTemplate.template;

  // {campaignIntel} is an OPTIONAL freeform block (Content Lab auto-injects live
  // campaign performance). Handled first + specially: absent → render NOTHING
  // (never the 'N/A' the generic pass would emit for a whole omitted section),
  // and a function replacement so a literal '$' in a campaign name / ROAS figure
  // can't be read as a regex replacement token.
  prompt = prompt.replace(/\{campaignIntel\}/g, () => variables.campaignIntel || '');

  // Replace variables
  for (const [key, value] of Object.entries(variables)) {
    if (key === 'campaignIntel') continue; // already handled above
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || 'N/A');
  }

  // Any placeholder the caller didn't supply resolves to N/A rather than leaking
  // a raw {token} into the model prompt. Matches only bare {identifier} tokens —
  // the JSON braces in OUTPUT FORMAT (which wrap quoted, multi-line content) are
  // never bare identifiers, so they are untouched.
  prompt = prompt.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, 'N/A');

  // PR #34: Apply selective prompt mutation if structured feedback exists
  if (decisionContext.isReExecution && decisionContext.feedbackType && hasMutationRule(decisionContext.feedbackType)) {
    // Use mutation engine for surgical modifications
    prompt = applyPromptMutation(prompt, {
      feedbackType: decisionContext.feedbackType,
      severity: decisionContext.severity,
      feedback: decisionContext.feedback,
      preserveAspects: decisionContext.preserveAspects,
    });

    // Add re-execution context header
    prompt += '\n\n---\n\n**RE-EXECUTION CONTEXT:**\n';
    prompt += 'This is a regeneration based on structured reviewer feedback. ';
    prompt += 'See modified REQUIREMENTS section above for targeted constraints.\n';

  } else if (decisionContext.isReExecution) {
    // PR #32/33: Fallback to append-only approach (backward compatibility)
    // Used when: (1) no feedbackType, or (2) feedbackType has no mutation rule
    prompt += '\n\n---\n\n**RE-EXECUTION CONTEXT:**\n';
    prompt += 'This is a regeneration based on reviewer feedback.\n\n';

    if (decisionContext.feedbackType) {
      // Structured feedback without mutation rule (shouldn't happen, but defensive)
      prompt += _buildStructuredFeedbackGuidance(decisionContext);
    } else {
      // Unstructured feedback (PR #32 compatibility)
      prompt += _buildUnstructuredFeedbackGuidance(decisionContext);
    }

    // Legacy preservation constraints (append-only)
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
 * PR #33: Build targeted prompt guidance based on structured feedback type.
 * Routes feedback to specific copy layers (hook/tone/CTA/etc).
 *
 * @private
 */
function _buildStructuredFeedbackGuidance(decisionContext) {
  const { feedbackType, severity, feedback } = decisionContext;

  let guidance = '';

  // Severity header
  const severityLabel = severity ? `**[${severity} PRIORITY]** ` : '';

  switch (feedbackType) {
    case 'hook_angle':
      guidance += `${severityLabel}**Issue: Hook Angle**\n`;
      guidance += 'The psychological trigger in the hook needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: changing the hook angle (problem/benefit/curiosity) while keeping tone and CTA.\n\n';
      break;

    case 'tone':
      guidance += `${severityLabel}**Issue: Tone**\n`;
      guidance += 'The voice/personality needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: adjusting tone (urgent/casual/professional) while keeping hook and CTA.\n\n';
      break;

    case 'cta':
      guidance += `${severityLabel}**Issue: Call-to-Action**\n`;
      guidance += 'The CTA needs to be stronger or clearer.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: improving CTA strength and clarity while keeping hook and tone.\n\n';
      break;

    case 'clarity':
      guidance += `${severityLabel}**Issue: Message Clarity**\n`;
      guidance += 'The message is unclear or confusing.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: improving clarity and readability while keeping the core angle.\n\n';
      break;

    case 'length':
      guidance += `${severityLabel}**Issue: Length**\n`;
      guidance += 'The copy is too long or too short.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: adjusting length while keeping the core message and tone.\n\n';
      break;

    case 'brand_voice':
      guidance += `${severityLabel}**Issue: Brand Voice**\n`;
      guidance += 'The copy doesn\'t match the brand personality.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: aligning with brand voice while keeping the hook structure.\n\n';
      break;

    case 'brand_guidelines':
      guidance += `${severityLabel}**Issue: Brand Guidelines**\n`;
      guidance += 'The copy violates brand style guide rules.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: adhering to brand guidelines while keeping the strategy.\n\n';
      break;

    case 'audience_fit':
      guidance += `${severityLabel}**Issue: Audience Fit**\n`;
      guidance += 'The copy doesn\'t resonate with the target audience.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: improving audience resonance while keeping the hook angle.\n\n';
      break;

    case 'message_positioning':
      guidance += `${severityLabel}**Issue: Message Positioning**\n`;
      guidance += 'The value proposition or angle needs adjustment.\n';
      if (feedback) guidance += `Specific feedback: ${feedback}\n`;
      guidance += 'Focus regeneration on: repositioning the message while keeping tone and format.\n\n';
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
