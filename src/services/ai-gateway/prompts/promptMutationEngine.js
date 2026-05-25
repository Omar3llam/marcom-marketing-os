// ============================================================
// Prompt Mutation Engine — PR #34
// ============================================================
// Intelligent prompt modification based on structured feedback.
//
// STRATEGY:
//   Instead of appending feedback to prompts (PR #32/33 approach),
//   this engine surgically modifies specific prompt sections based
//   on feedbackType, creating targeted constraints.
//
// MUTATION POINTS:
//   - REQUIREMENTS section: Add/modify generation constraints
//   - CONTEXT section: Inject additional context
//   - OUTPUT FORMAT: Modify output expectations
//
// EXAMPLES:
//   feedbackType='hook_angle' + severity='HIGH'
//   → Inject "CRITICAL: Change psychological trigger" into REQUIREMENTS
//
//   feedbackType='tone' + preserveAspects=['cta']
//   → Inject "PRESERVE: Keep existing CTA unchanged" into REQUIREMENTS
//
// BACKWARD COMPATIBILITY:
//   Falls back to append-only if mutation rules don't exist for feedbackType.
// ============================================================

/**
 * Mutation rules map feedbackType to prompt modifications.
 * Each rule specifies where and how to inject constraints.
 */
const MUTATION_RULES = {
  // ============================================================
  // Copy/Hook Mutations
  // ============================================================
  hook_angle: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Change the psychological trigger (problem/benefit/curiosity)${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  tone: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Adjust voice/personality (urgent/casual/professional)${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  cta: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Strengthen or clarify the call-to-action${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  clarity: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Improve message clarity and readability${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  length: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Adjust copy length${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  brand_voice: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Align with brand personality${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  brand_guidelines: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Adhere to brand style guide${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  audience_fit: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Improve resonance with target audience${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  message_positioning: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Reposition value proposition or angle${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  // ============================================================
  // Visual Brief Mutations
  // ============================================================
  visual_concept: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Develop new visual concept/metaphor${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  color_palette: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Select new color palette${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  composition: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Improve layout/framing${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  mobile_optimization: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Optimize for mobile viewing${feedback ? ` — ${feedback}` : ''}`;
    },
  },

  // ============================================================
  // Audience/Angle Strategy Mutations
  // ============================================================
  creative_angle: {
    targetSection: 'REQUIREMENTS',
    inject: (severity, feedback) => {
      const priority = severity === 'HIGH' ? 'CRITICAL' : severity === 'MEDIUM' ? 'IMPORTANT' : 'NOTE';
      return `- ${priority}: Change creative angle (problem-solution vs aspirational)${feedback ? ` — ${feedback}` : ''}`;
    },
  },
};

/**
 * Apply selective mutation to a prompt template.
 *
 * @param {string} basePrompt - Original prompt template
 * @param {object} mutationContext - Structured feedback context
 * @param {string} mutationContext.feedbackType - Type of feedback
 * @param {string} mutationContext.severity - Severity level (LOW/MEDIUM/HIGH)
 * @param {string} [mutationContext.feedback] - Optional feedback text
 * @param {string[]} [mutationContext.preserveAspects] - Aspects to preserve
 * @returns {string} Mutated prompt
 */
export function applyPromptMutation(basePrompt, mutationContext) {
  const { feedbackType, severity, feedback, preserveAspects } = mutationContext;

  // No mutation needed if no feedbackType
  if (!feedbackType) {
    return basePrompt;
  }

  // Get mutation rule for this feedbackType
  const rule = MUTATION_RULES[feedbackType];

  // Fallback: no mutation rule exists, return base prompt
  // (backward compatibility with append-only approach)
  if (!rule) {
    return basePrompt;
  }

  // Find the target section in the prompt
  const sectionMarker = `${rule.targetSection}:`;
  const sectionIndex = basePrompt.indexOf(sectionMarker);

  if (sectionIndex === -1) {
    // Target section not found, fallback to appending
    return basePrompt;
  }

  // Find the end of the REQUIREMENTS section (next section or end of prompt)
  const nextSectionMatch = basePrompt.slice(sectionIndex + sectionMarker.length).match(/\n\n[A-Z\s]+:/);
  const sectionEndIndex = nextSectionMatch
    ? sectionIndex + sectionMarker.length + nextSectionMatch.index
    : basePrompt.length;

  // Extract the section content
  const beforeSection = basePrompt.slice(0, sectionIndex + sectionMarker.length);
  const sectionContent = basePrompt.slice(sectionIndex + sectionMarker.length, sectionEndIndex);
  const afterSection = basePrompt.slice(sectionEndIndex);

  // Generate mutation text
  const mutationText = rule.inject(severity, feedback);

  // Generate preservation constraints if needed
  let preservationText = '';
  if (preserveAspects && preserveAspects.length > 0) {
    const aspectsList = preserveAspects
      .map(aspect => `  * ${aspect.replace('_', ' ')}`)
      .join('\n');
    preservationText = `\n- PRESERVE (do not change):\n${aspectsList}`;
  }

  // Inject mutation into section
  const mutatedSection = `${sectionContent.trimEnd()}\n${mutationText}${preservationText}\n`;

  // Reassemble prompt
  return `${beforeSection}${mutatedSection}${afterSection}`;
}

/**
 * Check if a feedbackType has a mutation rule defined.
 *
 * @param {string} feedbackType - Feedback type to check
 * @returns {boolean} True if mutation rule exists
 */
export function hasMutationRule(feedbackType) {
  return !!MUTATION_RULES[feedbackType];
}

/**
 * Get list of all supported mutation types.
 *
 * @returns {string[]} Array of supported feedbackTypes
 */
export function getSupportedMutationTypes() {
  return Object.keys(MUTATION_RULES);
}
