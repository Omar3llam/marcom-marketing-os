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
  }, '[visualBriefExecutor] execution context');

  // Call AI Provider Gateway
  const result = await execute({
    capability,
    input: {
      diagnosis: context.diagnosis || 'UNKNOWN',
      executionType: context.executionType || 'CONTENT_OPTIMIZATION',
      brandGuidelines: context.brandGuidelines || {},
      content: context.content || [],
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
    artifactVersion,
    isReExecution,
  }, '[visualBriefExecutor] generation successful');

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
