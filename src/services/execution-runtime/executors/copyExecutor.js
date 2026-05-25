// ============================================================
// Copy Executor — AI-powered copy generation
// ============================================================
// Handles: GENERATE_HOOK_VARIANTS, GENERATE_CAPTION_VARIANTS
//
// Wires execution-runtime to AI Provider Gateway.
// Routes to Claude API for hook/caption generation.
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
  [NODE_TYPE.GENERATE_HOOK_VARIANTS]:    CAPABILITY.GENERATE_HOOKS,
  [NODE_TYPE.GENERATE_CAPTION_VARIANTS]: CAPABILITY.GENERATE_CAPTIONS,
};

export async function executeCopyGeneration(nodeId, nodeType, context) {
  const capability = NODE_TO_CAPABILITY[nodeType];

  if (!capability) {
    logger.error({ nodeId, nodeType }, '[copyExecutor] unknown nodeType');
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
      brandVoice: context.brandVoice || 'professional',
      targetAudience: context.targetAudience || 'general',
      currentCTR: context.currentCTR || 0,
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
    }, '[copyExecutor] provider error');

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
  }, '[copyExecutor] generation successful');

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
