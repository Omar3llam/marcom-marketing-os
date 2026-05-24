// ============================================================
// AI Gateway — copy generation prompts
// ============================================================
// Prompt templates for generating ad copy, hooks, and captions.
//
// INPUT VARIABLES:
//   {diagnosis}, {brandVoice}, {targetAudience}, {performanceData}
//
// VERSIONING:
//   Never modify existing prompts — create new versions.
// ============================================================

export const COPY_PROMPTS = Object.freeze({
  GENERATE_HOOKS: {
    version: 'v1.0',
    template: `Generate 3 high-converting ad hooks for Meta ads.

CONTEXT:
Diagnosis: {diagnosis}
Brand Voice: {brandVoice}
Target Audience: {targetAudience}
Current CTR: {currentCTR}%

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

  GENERATE_COPY: {
    version: 'v1.0',
    template: `Generate complete ad copy (hook + body) for Meta ads.

CONTEXT:
Diagnosis: {diagnosis}
Brand Voice: {brandVoice}
Target Audience: {targetAudience}
Product/Service: {productName}
Key Benefits: {benefits}

REQUIREMENTS:
- Hook: 40-60 characters
- Body: 125-150 characters
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

export function buildCopyPrompt(capability, variables) {
  const promptTemplate = COPY_PROMPTS[capability];
  if (!promptTemplate) {
    throw new Error(`Unknown copy capability: ${capability}`);
  }

  let prompt = promptTemplate.template;

  // Replace variables
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || 'N/A');
  }

  return prompt;
}
