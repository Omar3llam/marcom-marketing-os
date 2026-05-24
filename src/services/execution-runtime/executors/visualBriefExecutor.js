// ============================================================
// Visual Brief Executor — mock visual brief generation
// ============================================================
// Handles: GENERATE_VISUAL_BRIEF, VALIDATE_HOOKS, RANK_HOOKS
//
// This is a MOCK executor for PR #24.
// Real implementation (PR #25+) will call Claude API.
//
// DETERMINISM:
//   Given same input, returns same output (no randomness).
// ============================================================

export async function executeVisualBrief(nodeId, nodeType, context) {
  const { diagnosis, executionType } = context;

  // Mock visual brief (deterministic)
  const brief = {
    theme: `${executionType}_theme`,
    style: 'modern_minimal',
    colorPalette: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
    mood: diagnosis === 'CREATIVE_FATIGUE' ? 'energetic' : 'aspirational',
    requirements: [
      'high-contrast',
      'mobile-first',
      'brand-aligned',
    ],
  };

  return {
    success: true,
    output: {
      brief,
      nodeType,
      diagnosis,
    },
    artifacts: [{
      type: 'visual_brief',
      id: `${nodeId}_brief`,
      content: brief,
    }],
  };
}
