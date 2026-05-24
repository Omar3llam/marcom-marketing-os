// ============================================================
// Caption Executor — mock caption generation
// ============================================================
// Handles: GENERATE_ANGLE_VARIANTS, GENERATE_AUDIENCE_HYPOTHESES
//
// This is a MOCK executor for PR #24.
// Real implementation (PR #25+) will call Claude API.
//
// DETERMINISM:
//   Given same input, returns same output (no randomness).
// ============================================================

export async function executeCaptionGeneration(nodeId, nodeType, context) {
  const { diagnosis } = context;

  // Mock captions/angles (deterministic)
  const items = [
    `${nodeType}_option_A_${diagnosis}`,
    `${nodeType}_option_B_${diagnosis}`,
  ];

  return {
    success: true,
    output: {
      items,
      count: items.length,
      nodeType,
    },
    artifacts: items.map((text, index) => ({
      type: 'caption',
      id: `${nodeId}_caption_${index}`,
      content: text,
    })),
  };
}
