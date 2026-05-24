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

export function buildCaptionPrompt(capability, variables) {
  const promptTemplate = CAPTION_PROMPTS[capability];
  if (!promptTemplate) {
    throw new Error(`Unknown caption capability: ${capability}`);
  }

  let prompt = promptTemplate.template;

  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || 'N/A');
  }

  return prompt;
}
