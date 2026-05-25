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

  // PR #32: Extract decision context for re-execution
  const isReExecution = context.isReExecution || false;
  const feedback = context.feedback?.[nodeId];
  const revisionInstructions = context.revisionInstructions?.[nodeId];
  const regenerationHint = context.regenerationHints?.[nodeId];
  const originalNode = context.originalNode;

  // PR #33: Extract structured feedback
  const feedbackType = context.feedbackType?.[nodeId];
  const severity = context.severity?.[nodeId];
  const preserveAspects = context.preserveAspects?.[nodeId] || [];

  // PR #32: Determine artifact version (v1 for new, v2+ for re-execution)
  const artifactVersion = isReExecution && originalNode?.artifacts?.[0]?.version
    ? originalNode.artifacts[0].version + 1
    : 1;

  logger.debug({
    nodeId,
    nodeType,
    isReExecution,
    hasFeedback: !!feedback,
    hasRevisionInstructions: !!revisionInstructions,
    artifactVersion,
  }, '[captionExecutor] execution context');

  // Call AI Provider Gateway
  const result = await execute({
    capability,
    input: {
      diagnosis: context.diagnosis || 'UNKNOWN',
      campaignData: context.campaignData || {},
      currentAudience: context.currentAudience || 'general',
      performanceMetrics: context.performanceMetrics || {},
    },
    // PR #32: Pass decision context to AI gateway
    feedback,
    revisionInstructions,
    regenerationHint,
    isReExecution,
    // PR #33: Pass structured feedback
    feedbackType,
    severity,
    preserveAspects,
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

  // Success — return artifacts + metadata
  logger.debug({
    nodeId,
    nodeType,
    capability,
    provider: result.metadata?.provider,
    requestId: result.metadata?.requestId,
    artifactVersion,
    isReExecution,
  }, '[captionExecutor] generation successful');

  // PR #32: Attach version and re-execution metadata to artifacts
  const versionedArtifacts = result.artifacts.map(artifact => ({
    ...artifact,
    version: artifactVersion,
    isRegeneration: isReExecution,
    regenerationContext: isReExecution ? {
      hasFeedback: !!feedback,
      hasRevisionInstructions: !!revisionInstructions,
      hasRegenerationHint: !!regenerationHint,
    } : undefined,
  }));

  return {
    success: true,
    output: result.output,
    artifacts: versionedArtifacts,
    metadata: {
      capability,
      provider: result.metadata?.provider,
      requestId: result.metadata?.requestId,
      tokens: result.metadata?.tokens,
      latency: result.metadata?.latency,
      model: result.metadata?.model,
      artifactVersion,
      isReExecution,
    },
  };
}
