// ============================================================
// Copy Executor — mock copy generation
// ============================================================
// Handles: GENERATE_HOOK_VARIANTS, GENERATE_CAPTION_VARIANTS
//
// This is a MOCK executor for PR #24.
// Real implementation (PR #25+) will call Claude API.
//
// DETERMINISM:
//   Given same input, returns same output (no randomness).
// ============================================================

export async function executeCopyGeneration(nodeId, nodeType, context) {
  const { diagnosis, executionType } = context;

  // Mock copy variants (deterministic based on node type)
  const variants = [
    `${nodeType}_variant_1_for_${diagnosis}`,
    `${nodeType}_variant_2_for_${diagnosis}`,
    `${nodeType}_variant_3_for_${diagnosis}`,
  ];

  return {
    success: true,
    output: {
      variants,
      count: variants.length,
      nodeType,
      diagnosis,
    },
    artifacts: variants.map((text, index) => ({
      type: 'text',
      id: `${nodeId}_copy_${index}`,
      content: text,
    })),
  };
}
