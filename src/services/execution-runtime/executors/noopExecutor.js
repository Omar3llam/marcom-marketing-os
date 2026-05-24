// ============================================================
// No-op Executor — pass-through executor
// ============================================================
// Handles: CONTINUE_MONITORING, CALCULATE_OPTIMAL_BUDGET,
//          GENERATE_REALLOCATION_PLAN, IDENTIFY_WINNING_ATTRIBUTES,
//          GENERATE_DUPLICATION_PLAN
//
// These nodes require no AI generation — they're placeholders
// or data-transformation steps that will be implemented in PR #25+.
//
// DETERMINISM:
//   Always succeeds immediately with minimal output.
// ============================================================

export async function executeNoop(nodeId, nodeType, context) {
  return {
    success: true,
    output: {
      nodeType,
      action: 'no_operation',
      message: `${nodeType} executed successfully (placeholder)`,
    },
    artifacts: [],
  };
}
