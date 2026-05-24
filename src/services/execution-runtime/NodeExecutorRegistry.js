// ============================================================
// Node Executor Registry — nodeType → executor mapping
// ============================================================
// Maps each NODE_TYPE to its executor function.
//
// Executors must return:
//   { success: boolean, output: object, artifacts: array }
//
// DETERMINISM:
//   - Executors are pure-ish (same input → same output)
//   - No randomness, no timestamps, no side effects
//   - All mutations happen in RuntimeOrchestrator
// ============================================================
import { NODE_TYPE } from '../execution-planner/index.js';
import { executeCopyGeneration }     from './executors/copyExecutor.js';
import { executeVisualBrief }        from './executors/visualBriefExecutor.js';
import { executeCaptionGeneration }  from './executors/captionExecutor.js';
import { executeNoop }               from './executors/noopExecutor.js';

export const NODE_EXECUTOR_REGISTRY = Object.freeze({
  // Copy generation
  [NODE_TYPE.GENERATE_HOOK_VARIANTS]:    executeCopyGeneration,
  [NODE_TYPE.GENERATE_CAPTION_VARIANTS]: executeCopyGeneration,

  // Visual/validation
  [NODE_TYPE.GENERATE_VISUAL_BRIEF]: executeVisualBrief,
  [NODE_TYPE.VALIDATE_HOOKS]:        executeVisualBrief,
  [NODE_TYPE.RANK_HOOKS]:            executeVisualBrief,

  // Audience/angle
  [NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES]: executeCaptionGeneration,
  [NODE_TYPE.GENERATE_ANGLE_VARIANTS]:      executeCaptionGeneration,

  // Budget/scaling (noop for now)
  [NODE_TYPE.CALCULATE_OPTIMAL_BUDGET]:        executeNoop,
  [NODE_TYPE.GENERATE_REALLOCATION_PLAN]:      executeNoop,
  [NODE_TYPE.IDENTIFY_WINNING_ATTRIBUTES]:     executeNoop,
  [NODE_TYPE.GENERATE_DUPLICATION_PLAN]:       executeNoop,

  // Monitoring
  [NODE_TYPE.CONTINUE_MONITORING]: executeNoop,
});

export function getExecutor(nodeType) {
  const executor = NODE_EXECUTOR_REGISTRY[nodeType];
  if (!executor) {
    throw new Error(`NodeExecutorRegistry: no executor for nodeType "${nodeType}"`);
  }
  return executor;
}
