// ============================================================
// Caption Executor — AI-powered audience/angle generation
// ============================================================
// Handles: GENERATE_ANGLE_VARIANTS, GENERATE_AUDIENCE_HYPOTHESES
//
// Wires execution-runtime to AI Provider Gateway.
// Routes to OpenAI API for audience hypotheses and angle variants.
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
  [NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES]: CAPABILITY.GENERATE_AUDIENCE,
  [NODE_TYPE.GENERATE_ANGLE_VARIANTS]:      CAPABILITY.GENERATE_ANGLE,
};

export async function executeCaptionGeneration(nodeId, nodeType, context) {
  const capability = NODE_TO_CAPABILITY[nodeType];

  if (!capability) {
    logger.error({ nodeId, nodeType }, '[captionExecutor] unknown nodeType');
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
      campaignData: context.campaignData || {},
      currentAudience: context.currentAudience || 'general',
      performanceMetrics: context.performanceMetrics || {},
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
    }, '[captionExecutor] provider error');

    return {
      success: false,
      output: {
        error: result.error?.message || 'Provider error',
        errorType: result.error?.type || ERROR_TYPE.PROVIDER_ERROR,
      },
      artifacts: [],
    };
  }

  // Success — return artifacts
  logger.debug({
    nodeId,
    nodeType,
    capability,
    provider: result.metadata?.provider,
    requestId: result.metadata?.requestId,
  }, '[captionExecutor] generation successful');

  return {
    success: true,
    output: result.output,
    artifacts: result.artifacts,
  };
}
