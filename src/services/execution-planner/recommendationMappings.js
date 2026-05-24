// ============================================================
// Execution Planner — recommendation → execution mappings
// ============================================================
// Maps each recommendation type to its execution graph template.
// Each mapping defines:
//   - executionType: high-level category
//   - priority: inherited from recommendation
//   - nodes: ordered list of execution steps
//   - edges: dependencies between nodes
//
// These templates are deterministic — same recommendation always
// produces the same graph structure.
// ============================================================
import { REC_TYPE }                            from '../recommendation-engine/index.js';
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY } from './planTypes.js';

export const RECOMMENDATION_TO_EXECUTION = Object.freeze({
  [REC_TYPE.REFRESH_HOOK]: {
    executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
    priority:      PLAN_PRIORITY.HIGH,
    nodes: [
      NODE_TYPE.GENERATE_HOOK_VARIANTS,
      NODE_TYPE.VALIDATE_HOOKS,
      NODE_TYPE.RANK_HOOKS,
    ],
    edges: [
      { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
      { from: NODE_TYPE.VALIDATE_HOOKS,         to: NODE_TYPE.RANK_HOOKS },
    ],
  },

  [REC_TYPE.ROTATE_CREATIVE]: {
    executionType: EXECUTION_TYPE.VISUAL_GENERATION,
    priority:      PLAN_PRIORITY.HIGH,
    nodes: [
      NODE_TYPE.GENERATE_VISUAL_BRIEF,
      NODE_TYPE.GENERATE_CAPTION_VARIANTS,
    ],
    edges: [
      { from: NODE_TYPE.GENERATE_VISUAL_BRIEF, to: NODE_TYPE.GENERATE_CAPTION_VARIANTS },
    ],
  },

  [REC_TYPE.TEST_NEW_ANGLE]: {
    executionType: EXECUTION_TYPE.STRATEGY_EXPERIMENT,
    priority:      PLAN_PRIORITY.MEDIUM,
    nodes: [
      NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES,
      NODE_TYPE.GENERATE_ANGLE_VARIANTS,
    ],
    edges: [
      { from: NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES, to: NODE_TYPE.GENERATE_ANGLE_VARIANTS },
    ],
  },

  [REC_TYPE.REDUCE_BUDGET]: {
    executionType: EXECUTION_TYPE.BUDGET_REALLOCATION,
    priority:      PLAN_PRIORITY.HIGH,
    nodes: [
      NODE_TYPE.CALCULATE_OPTIMAL_BUDGET,
      NODE_TYPE.GENERATE_REALLOCATION_PLAN,
    ],
    edges: [
      { from: NODE_TYPE.CALCULATE_OPTIMAL_BUDGET, to: NODE_TYPE.GENERATE_REALLOCATION_PLAN },
    ],
  },

  [REC_TYPE.DUPLICATE_WINNER]: {
    executionType: EXECUTION_TYPE.SCALING_ACTION,
    priority:      PLAN_PRIORITY.MEDIUM,
    nodes: [
      NODE_TYPE.IDENTIFY_WINNING_ATTRIBUTES,
      NODE_TYPE.GENERATE_DUPLICATION_PLAN,
    ],
    edges: [
      { from: NODE_TYPE.IDENTIFY_WINNING_ATTRIBUTES, to: NODE_TYPE.GENERATE_DUPLICATION_PLAN },
    ],
  },

  [REC_TYPE.HOLD_STEADY]: {
    executionType: EXECUTION_TYPE.HOLD,
    priority:      PLAN_PRIORITY.LOW,
    nodes:         [NODE_TYPE.CONTINUE_MONITORING],
    edges:         [],
  },
});
