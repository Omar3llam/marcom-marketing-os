// ============================================================
// Visual Brief Executor — AI-powered visual/validation
// ============================================================
// Handles: GENERATE_VISUAL_BRIEF, VALIDATE_HOOKS, RANK_HOOKS
//
// Wires execution-runtime to AI Provider Gateway.
// Routes to Claude API for visual briefs and content validation.
//
// DETERMINISM:
//   Request IDs are deterministic (same input → same ID).
//   Provider responses may vary (AI non-determinism).
// ============================================================
import { execute, CAPABILITY, ERROR_TYPE } from '../../ai-gateway/index.js';
import { NODE_TYPE } from '../../execution-planner/index.js';
import { logger } from '../../../utils/logger.js';

// Map nodeType → capability
const NODE_TO_CAPABILITY = {
  [NODE_TYPE.GENERATE_VISUAL_BRIEF]: CAPABILITY.GENERATE_VISUAL_BRIEF,
  [NODE_TYPE.VALIDATE_HOOKS]:        CAPABILITY.VALIDATE_CONTENT,
  [NODE_TYPE.RANK_HOOKS]:            CAPABILITY.VALIDATE_CONTENT,
};

export async function executeVisualBrief(nodeId, nodeType, context) {
  const capability = NODE_TO_CAPABILITY[nodeType];

  if (!capability) {
    logger.error({ nodeId, nodeType }, '[visualBriefExecutor] unknown nodeType');
    return {
      success: false,
      output: { error: `Unknown nodeType: ${nodeType}` },
      artifacts: [],
    };
  }

  // Call AI Provider Gateway
  const result = await execute({
    capability,
    input: {
      diagnosis: context.diagnosis || 'UNKNOWN',
      executionType: context.executionType || 'CONTENT_OPTIMIZATION',
      brandGuidelines: context.brandGuidelines || {},
      content: context.content || [],
    },
  });

  // Handle provider errors
  if (!result.success) {
    logger.error({
      nodeId,
      nodeType,
      capability,
      errorType: result.error?.type,
      errorMessage: result.error?.message,
    }, '[visualBriefExecutor] provider error');

    return {
      success: false,
      output: {
        error: result.error?.message || 'Provider error',
        errorType: result.error?.type || ERROR_TYPE.PROVIDER_ERROR,
      },
      artifacts: [],
    };
  }

  // Success — return artifacts + metadata
  logger.debug({
    nodeId,
    nodeType,
    capability,
    provider: result.metadata?.provider,
    requestId: result.metadata?.requestId,
  }, '[visualBriefExecutor] generation successful');

  return {
    success: true,
    output: result.output,
    artifacts: result.artifacts,
    metadata: {
      capability,
      provider: result.metadata?.provider,
      requestId: result.metadata?.requestId,
      tokens: result.metadata?.tokens,
      latency: result.metadata?.latency,
      model: result.metadata?.model,
    },
  };
}
