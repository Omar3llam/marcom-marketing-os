// ============================================================
// RuntimeOrchestrator — execution runtime coordinator
// ============================================================
// Single public API: executeExecutionPlan(plan, context)
//
// DETERMINISM CONTRACT:
//   Given the same plan + context, always produces:
//   - same execution order
//   - same event sequence
//   - same retry behavior
//   - same skip logic
//
// ISOLATION CONTRACT:
//   Executors are pure (no side effects).
//   Orchestrator handles side effects (artifact storage, DB writes).
//
// INPUT:
//   plan: { diagnosis, executionType, priority, graph: { nodes, edges } }
//   context: {
//     diagnosis,
//     executionType,
//     workspaceId?, // Optional: enables artifact storage
//     executionId?, // Optional: enables artifact storage
//     [additionalContext]
//   }
//
// OUTPUT:
//   {
//     status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE',
//     executedNodes: [{ nodeId, nodeType, status, output, artifacts, attempts, storedArtifactIds? }],
//     events: [{ type, nodeId, attempt }],
//     summary: { totalNodes, successful, failed, skipped }
//   }
// ============================================================
import { ExecutionGraph }         from './ExecutionGraph.js';
import { getExecutor }            from './NodeExecutorRegistry.js';
import { RUNTIME_EVENT, EXECUTION_STATUS, NODE_STATUS } from './runtimeEvents.js';
import { logger }                 from '../../utils/logger.js';
import { storeArtifact }          from '../artifact-storage/index.js';
import { createApprovalRequest, artifactRequiresApproval } from '../artifact-approval/index.js';
import { createCheckpoint, getCheckpointById, PAUSE_REASONS } from '../execution-checkpoint/index.js';

const MAX_RETRIES = 3;

// ============================================================
// Artifact storage helper
// ============================================================

async function storeNodeArtifacts({
  workspaceId,
  executionId,
  nodeId,
  nodeType,
  artifacts,
  metadata,
}) {
  const storedIds = [];

  for (const artifact of artifacts) {
    try {
      const stored = await storeArtifact({
        workspaceId,
        executionId,
        nodeId,
        nodeType,
        type: artifact.type,
        content: typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content),
        capability: metadata.capability || 'UNKNOWN',
        provider: metadata.provider || 'UNKNOWN',
        metadata: {
          ...metadata,
          artifactId: artifact.id,
          angle: artifact.angle,
          tone: artifact.tone,
        },
      });

      storedIds.push(stored.id);

      logger.debug({
        artifactId: stored.id,
        nodeId,
        type: artifact.type,
        duplicate: stored.duplicate,
      }, '[RuntimeOrchestrator] artifact stored');

      // Create approval request if artifact type requires approval (PR #28)
      if (artifactRequiresApproval(artifact.type)) {
        try {
          await createApprovalRequest(stored.id, workspaceId);
          logger.debug({
            artifactId: stored.id,
            type: artifact.type,
          }, '[RuntimeOrchestrator] approval request created');
        } catch (approvalError) {
          // Log error but don't fail execution
          logger.error({
            error: approvalError.message,
            artifactId: stored.id,
            type: artifact.type,
          }, '[RuntimeOrchestrator] failed to create approval request');
        }
      }
    } catch (error) {
      // Log error but don't fail execution
      logger.error({
        error: error.message,
        nodeId,
        artifactType: artifact.type,
      }, '[RuntimeOrchestrator] failed to store artifact');
    }
  }

  return storedIds;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('executeExecutionPlan: plan must be a non-null object');
  }

  const { diagnosis, executionType, priority, graph } = plan;

  if (typeof diagnosis !== 'string' || !diagnosis.trim()) {
    throw new Error('executeExecutionPlan: diagnosis must be a non-empty string');
  }

  if (typeof executionType !== 'string' || !executionType.trim()) {
    throw new Error('executeExecutionPlan: executionType must be a non-empty string');
  }

  if (typeof priority !== 'string' || !priority.trim()) {
    throw new Error('executeExecutionPlan: priority must be a non-empty string');
  }

  if (!graph || typeof graph !== 'object') {
    throw new Error('executeExecutionPlan: graph must be a non-null object');
  }

  if (!Array.isArray(graph.nodes)) {
    throw new Error('executeExecutionPlan: graph.nodes must be an array');
  }

  if (!Array.isArray(graph.edges)) {
    throw new Error('executeExecutionPlan: graph.edges must be an array');
  }
}

async function executeNode(node, context, attempt = 1) {
  try {
    const executor = getExecutor(node.type);
    const result = await executor(node.id, node.type, context);

    if (!result || typeof result !== 'object') {
      throw new Error(`Executor for ${node.type} returned invalid result`);
    }

    if (typeof result.success !== 'boolean') {
      throw new Error(`Executor for ${node.type} missing success field`);
    }

    return result;
  } catch (error) {
    logger.error({
      nodeId: node.id,
      nodeType: node.type,
      attempt,
      error: error.message,
    }, '[RuntimeOrchestrator] node execution failed');

    return {
      success: false,
      output: { error: error.message },
      artifacts: [],
    };
  }
}

export async function executeExecutionPlan(plan, context = {}) {
  validatePlan(plan);

  const { diagnosis, executionType, priority, graph } = plan;

  // Build execution graph
  const executionGraph = new ExecutionGraph(graph);
  const sortedNodes = executionGraph.getSortedNodes();

  // Initialize execution state
  const events = [];
  const executedNodes = [];

  // Emit execution start
  events.push({ type: RUNTIME_EVENT.EXECUTION_START });

  logger.debug({
    diagnosis,
    executionType,
    priority,
    nodeCount: sortedNodes.length,
  }, '[RuntimeOrchestrator] execution started');

  // Execute nodes in topological order
  for (const node of sortedNodes) {
    // Check if node should be skipped due to failed dependencies
    if (executionGraph.shouldSkipNode(node.id)) {
      executionGraph.updateNodeStatus(node.id, NODE_STATUS.SKIPPED);
      events.push({ type: RUNTIME_EVENT.NODE_SKIPPED, nodeId: node.id });

      executedNodes.push({
        nodeId: node.id,
        nodeType: node.type,
        status: NODE_STATUS.SKIPPED,
        output: { reason: 'dependency_failed' },
        artifacts: [],
        attempts: 0,
      });

      logger.debug({ nodeId: node.id, nodeType: node.type }, '[RuntimeOrchestrator] node skipped');
      continue;
    }

    // Execute node with retries
    executionGraph.updateNodeStatus(node.id, NODE_STATUS.RUNNING);
    events.push({ type: RUNTIME_EVENT.NODE_START, nodeId: node.id, attempt: 1 });

    let result = null;
    let attempts = 0;
    let finalStatus = NODE_STATUS.FAILURE;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      attempts = attempt;

      if (attempt > 1) {
        events.push({ type: RUNTIME_EVENT.NODE_RETRY, nodeId: node.id, attempt });
        logger.debug({ nodeId: node.id, attempt }, '[RuntimeOrchestrator] retrying node');
      }

      result = await executeNode(node, { diagnosis, executionType, ...context }, attempt);

      if (result.success) {
        finalStatus = NODE_STATUS.SUCCESS;
        executionGraph.updateNodeStatus(node.id, NODE_STATUS.SUCCESS);
        events.push({ type: RUNTIME_EVENT.NODE_SUCCESS, nodeId: node.id, attempt });

        logger.debug({
          nodeId: node.id,
          nodeType: node.type,
          attempt,
        }, '[RuntimeOrchestrator] node succeeded');

        // Store artifacts if workspaceId and executionId provided
        if (context.workspaceId && context.executionId && result.artifacts && result.artifacts.length > 0) {
          const storedArtifactIds = await storeNodeArtifacts({
            workspaceId: context.workspaceId,
            executionId: context.executionId,
            nodeId: node.id,
            nodeType: node.type,
            artifacts: result.artifacts,
            metadata: result.metadata || {},
          });

          // Attach stored artifact IDs to result for tracking
          result.storedArtifactIds = storedArtifactIds;

          // PR #29: Pause execution if node requires approval
          if (node.requiresApproval && storedArtifactIds.length > 0) {
            try {
              // Serialize current execution state for resume
              const serializedState = {
                plan: { diagnosis, executionType, priority, graph },
                context,
                executedNodes,
                currentNodeIndex: sortedNodes.indexOf(node),
                remainingNodes: sortedNodes.slice(sortedNodes.indexOf(node) + 1),
                events,
              };

              // Create checkpoint
              const checkpoint = await createCheckpoint(
                context.executionId,
                context.workspaceId,
                node.id,
                serializedState,
                PAUSE_REASONS.AWAITING_ARTIFACT_APPROVAL
              );

              // Emit events
              events.push({ type: RUNTIME_EVENT.CHECKPOINT_CREATED, nodeId: node.id, checkpointId: checkpoint.id });
              events.push({ type: RUNTIME_EVENT.APPROVAL_REQUESTED, nodeId: node.id, artifactIds: storedArtifactIds });
              events.push({ type: RUNTIME_EVENT.EXECUTION_PAUSED, nodeId: node.id, checkpointId: checkpoint.id });

              logger.info({
                executionId: context.executionId,
                checkpointId: checkpoint.id,
                nodeId: node.id,
                artifactCount: storedArtifactIds.length,
              }, '[RuntimeOrchestrator] execution paused for approval');

              // Return early with paused status
              executedNodes.push({
                nodeId: node.id,
                nodeType: node.type,
                status: NODE_STATUS.SUCCESS,
                output: result?.output || {},
                artifacts: result?.artifacts || [],
                storedArtifactIds: result?.storedArtifactIds || [],
                attempts,
              });

              return {
                status: EXECUTION_STATUS.PAUSED_FOR_APPROVAL,
                executedNodes,
                events,
                summary: {
                  totalNodes: sortedNodes.length,
                  successful: executedNodes.filter(n => n.status === NODE_STATUS.SUCCESS).length,
                  failed: executedNodes.filter(n => n.status === NODE_STATUS.FAILURE).length,
                  skipped: executedNodes.filter(n => n.status === NODE_STATUS.SKIPPED).length,
                  paused: true,
                },
                checkpointId: checkpoint.id,
              };
            } catch (checkpointError) {
              // Log error but continue execution (graceful degradation)
              logger.error({
                error: checkpointError.message,
                nodeId: node.id,
                executionId: context.executionId,
              }, '[RuntimeOrchestrator] failed to create checkpoint, continuing execution');
            }
          }
        }

        break;
      }

      // Failed — check if we should retry
      if (attempt === MAX_RETRIES) {
        finalStatus = NODE_STATUS.FAILURE;
        executionGraph.updateNodeStatus(node.id, NODE_STATUS.FAILURE);
        events.push({ type: RUNTIME_EVENT.NODE_FAILURE, nodeId: node.id, attempt });

        logger.warn({
          nodeId: node.id,
          nodeType: node.type,
          attempts,
        }, '[RuntimeOrchestrator] node failed after max retries');
      }
    }

    executedNodes.push({
      nodeId: node.id,
      nodeType: node.type,
      status: finalStatus,
      output: result?.output || {},
      artifacts: result?.artifacts || [],
      storedArtifactIds: result?.storedArtifactIds || [],
      attempts,
    });
  }

  // Calculate summary
  const summary = {
    totalNodes: sortedNodes.length,
    successful: executedNodes.filter(n => n.status === NODE_STATUS.SUCCESS).length,
    failed: executedNodes.filter(n => n.status === NODE_STATUS.FAILURE).length,
    skipped: executedNodes.filter(n => n.status === NODE_STATUS.SKIPPED).length,
  };

  // Determine overall status
  let status = EXECUTION_STATUS.SUCCESS;
  if (summary.failed > 0) {
    status = summary.successful > 0 ? EXECUTION_STATUS.PARTIAL_SUCCESS : EXECUTION_STATUS.FAILURE;
  } else if (summary.skipped > 0 && summary.successful === 0) {
    status = EXECUTION_STATUS.FAILURE;
  }

  events.push({ type: RUNTIME_EVENT.EXECUTION_SUCCESS, status });

  logger.info({
    status,
    summary,
  }, '[RuntimeOrchestrator] execution completed');

  return {
    status,
    executedNodes,
    events,
    summary,
  };
}

// ============================================================
// PR #29: Resume Execution from Checkpoint
// ============================================================
// Resumes a paused execution from its checkpoint.
//
// INVARIANTS:
//   - Never re-executes completed nodes (deterministic resume)
//   - Idempotent (double resume returns cached result)
//   - Preserves event chronology
//
// PROCESS:
//   1. Load checkpoint from DB
//   2. Validate checkpoint is resumable (PAUSED_FOR_APPROVAL)
//   3. Mark checkpoint as RESUMING
//   4. Restore execution graph state
//   5. Continue from remaining nodes only
//   6. Mark checkpoint as RESUMED on completion
//
// INPUT:
//   checkpointId: string
//
// OUTPUT:
//   Same as executeExecutionPlan
// ============================================================

/**
 * R11 (I64/I70) — `workspaceId` is required and enforced here.
 *
 * This function took a bare checkpointId and did an unscoped findUnique. Its
 * single caller pre-resolved the checkpoint through getLatestCheckpoint(
 * executionId, workspaceId), so no cross-tenant resume was reachable — but the
 * boundary lived in the caller, and "the caller checks it" is not a property of
 * this function. It is now.
 *
 * The replay window is enforced in the same place, for the same reason: a
 * checkpoint that is genuinely owned but months old is a different refusal from
 * one that does not exist, and both belong to the service that resumes it.
 */
export async function resumeExecutionFromCheckpoint(checkpointId, workspaceId) {
  const { getLatestCheckpoint, updateCheckpointStatus, markCheckpointResumed, isCheckpointReplayable, CheckpointExpiredError } =
    await import('../execution-checkpoint/index.js');

  if (!workspaceId) throw new Error('resumeExecutionFromCheckpoint: workspaceId required');

  try {
    // Load checkpoint — scoped. A foreign id reads as absent.
    const checkpoint = await prisma.executionCheckpoint.findFirst({
      where: { id: checkpointId, workspaceId },
    });

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // Idempotency check BEFORE status validation (PR #29 fix)
    // If already resumed, return cached result even if status changed
    if (checkpoint.resumedAt) {
      logger.warn({
        checkpointId,
        executionId: checkpoint.executionId,
        resumedAt: checkpoint.resumedAt,
      }, '[RuntimeOrchestrator] checkpoint already resumed, returning cached result');

      // Idempotency: return success without re-executing
      return {
        status: EXECUTION_STATUS.SUCCESS,
        alreadyResumed: true,
        resumedAt: checkpoint.resumedAt,
      };
    }

    // Validate checkpoint is resumable
    if (checkpoint.status !== 'PAUSED_FOR_APPROVAL') {
      throw new Error(`Checkpoint ${checkpointId} is not in PAUSED_FOR_APPROVAL state (current: ${checkpoint.status})`);
    }

    // R11 (I70) — bounded replay. Checked AFTER the idempotency short-circuit
    // so an already-resumed checkpoint still returns its cached result rather
    // than turning into a new error for callers that legitimately retry.
    if (!isCheckpointReplayable(checkpoint)) {
      logger.warn({
        checkpointId,
        workspaceId,
        createdAt: checkpoint.createdAt,
      }, '[RuntimeOrchestrator] refusing to resume a checkpoint outside its replay window');
      throw new CheckpointExpiredError(checkpointId);
    }

    // Mark checkpoint as RESUMING
    await updateCheckpointStatus(checkpointId, 'RESUMING');

    // Deserialize execution state
    const { plan, context, executedNodes: previousNodes, remainingNodes, events: previousEvents } = checkpoint.serializedState;

    logger.info({
      checkpointId,
      executionId: checkpoint.executionId,
      remainingNodeCount: remainingNodes.length,
    }, '[RuntimeOrchestrator] resuming execution from checkpoint');

    // Initialize resumed execution state
    const events = [...previousEvents];
    const executedNodes = [...previousNodes];

    // Emit resume event
    events.push({ type: RUNTIME_EVENT.EXECUTION_RESUMED, checkpointId });

    // Build execution graph for remaining nodes
    const executionGraph = new ExecutionGraph(plan.graph);

    // Mark already-executed nodes as SUCCESS in graph
    for (const executedNode of previousNodes) {
      if (executedNode.status === NODE_STATUS.SUCCESS) {
        executionGraph.updateNodeStatus(executedNode.nodeId, NODE_STATUS.SUCCESS);
      } else if (executedNode.status === NODE_STATUS.FAILURE) {
        executionGraph.updateNodeStatus(executedNode.nodeId, NODE_STATUS.FAILURE);
      } else if (executedNode.status === NODE_STATUS.SKIPPED) {
        executionGraph.updateNodeStatus(executedNode.nodeId, NODE_STATUS.SKIPPED);
      }
    }

    // Get sorted nodes from graph and filter out already-executed ones
    const sortedNodes = executionGraph.getSortedNodes();
    const nodesToExecute = sortedNodes.filter(
      node => !previousNodes.find(prev => prev.nodeId === node.id)
    );

    logger.debug({
      totalNodes: sortedNodes.length,
      previouslyExecuted: previousNodes.length,
      toExecute: nodesToExecute.length,
    }, '[RuntimeOrchestrator] resume execution plan');

    // Execute remaining nodes
    for (const node of nodesToExecute) {
      // Check if node should be skipped due to failed dependencies
      if (executionGraph.shouldSkipNode(node.id)) {
        executionGraph.updateNodeStatus(node.id, NODE_STATUS.SKIPPED);
        events.push({ type: RUNTIME_EVENT.NODE_SKIPPED, nodeId: node.id });

        executedNodes.push({
          nodeId: node.id,
          nodeType: node.type,
          status: NODE_STATUS.SKIPPED,
          output: { reason: 'dependency_failed' },
          artifacts: [],
          attempts: 0,
        });

        logger.debug({ nodeId: node.id, nodeType: node.type }, '[RuntimeOrchestrator] node skipped during resume');
        continue;
      }

      // Execute node with retries
      executionGraph.updateNodeStatus(node.id, NODE_STATUS.RUNNING);
      events.push({ type: RUNTIME_EVENT.NODE_START, nodeId: node.id, attempt: 1 });

      let result = null;
      let attempts = 0;
      let finalStatus = NODE_STATUS.FAILURE;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        attempts = attempt;

        if (attempt > 1) {
          events.push({ type: RUNTIME_EVENT.NODE_RETRY, nodeId: node.id, attempt });
          logger.debug({ nodeId: node.id, attempt }, '[RuntimeOrchestrator] retrying node during resume');
        }

        result = await executeNode(node, { ...plan, ...context }, attempt);

        if (result.success) {
          finalStatus = NODE_STATUS.SUCCESS;
          executionGraph.updateNodeStatus(node.id, NODE_STATUS.SUCCESS);
          events.push({ type: RUNTIME_EVENT.NODE_SUCCESS, nodeId: node.id, attempt });

          logger.debug({
            nodeId: node.id,
            nodeType: node.type,
            attempt,
          }, '[RuntimeOrchestrator] node succeeded during resume');

          // Store artifacts if workspaceId and executionId provided
          if (context.workspaceId && context.executionId && result.artifacts && result.artifacts.length > 0) {
            const storedArtifactIds = await storeNodeArtifacts({
              workspaceId: context.workspaceId,
              executionId: context.executionId,
              nodeId: node.id,
              nodeType: node.type,
              artifacts: result.artifacts,
              metadata: result.metadata || {},
            });

            result.storedArtifactIds = storedArtifactIds;
          }

          break;
        }

        // Failed — check if we should retry
        if (attempt === MAX_RETRIES) {
          finalStatus = NODE_STATUS.FAILURE;
          executionGraph.updateNodeStatus(node.id, NODE_STATUS.FAILURE);
          events.push({ type: RUNTIME_EVENT.NODE_FAILURE, nodeId: node.id, attempt });

          logger.warn({
            nodeId: node.id,
            nodeType: node.type,
            attempts,
          }, '[RuntimeOrchestrator] node failed during resume after max retries');
        }
      }

      executedNodes.push({
        nodeId: node.id,
        nodeType: node.type,
        status: finalStatus,
        output: result?.output || {},
        artifacts: result?.artifacts || [],
        storedArtifactIds: result?.storedArtifactIds || [],
        attempts,
      });
    }

    // Mark checkpoint as RESUMED
    await markCheckpointResumed(checkpointId, workspaceId);

    // Calculate summary
    // executedNodes already includes previousNodes (initialized at line 467)
    const allNodes = executedNodes;
    const summary = {
      totalNodes: plan.graph.nodes.length,
      successful: allNodes.filter(n => n.status === NODE_STATUS.SUCCESS).length,
      failed: allNodes.filter(n => n.status === NODE_STATUS.FAILURE).length,
      skipped: allNodes.filter(n => n.status === NODE_STATUS.SKIPPED).length,
    };

    // Determine overall status
    let status = EXECUTION_STATUS.SUCCESS;
    if (summary.failed > 0) {
      status = summary.successful > 0 ? EXECUTION_STATUS.PARTIAL_SUCCESS : EXECUTION_STATUS.FAILURE;
    } else if (summary.skipped > 0 && summary.successful === 0) {
      status = EXECUTION_STATUS.FAILURE;
    }

    events.push({ type: RUNTIME_EVENT.EXECUTION_SUCCESS, status });

    logger.info({
      status,
      summary,
      checkpointId,
    }, '[RuntimeOrchestrator] resumed execution completed');

    return {
      status,
      executedNodes: allNodes,
      events,
      summary,
      resumed: true,
      checkpointId,
    };
  } catch (error) {
    logger.error({
      error: error.message,
      checkpointId,
    }, '[RuntimeOrchestrator] failed to resume execution from checkpoint');
    throw error;
  }
}

// ============================================================
// PR #31: Selective Re-execution
// ============================================================

/**
 * Re-execute specific nodes and their dependents based on approval decisions.
 * Used when REGENERATE or REQUEST_REVISION decisions are made.
 *
 * @param {string} checkpointId - Checkpoint ID to resume from
 * @param {string[]} nodeIdsToReExecute - Node IDs marked for regeneration
 * @param {Object} decisionContext - Context from approval decisions (feedback, revisionInstructions, etc.)
 * @param {string} workspaceId - Required (R9, I40); the workspace that owns the checkpoint
 * @returns {Promise<Object>} Execution result
 */
export async function reExecuteNodes(checkpointId, nodeIdsToReExecute, decisionContext = {}, workspaceId) {
  try {
    // Load checkpoint — R9: workspace-scoped, so re-execution cannot be
    // triggered against another workspace's paused run by id alone.
    const checkpoint = await getCheckpointById(checkpointId, workspaceId);

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // Idempotency check
    if (checkpoint.resumedAt) {
      logger.warn({
        checkpointId,
        executionId: checkpoint.executionId,
        resumedAt: checkpoint.resumedAt,
      }, '[RuntimeOrchestrator] checkpoint already resumed, returning cached result');

      return {
        status: EXECUTION_STATUS.SUCCESS,
        alreadyResumed: true,
        resumedAt: checkpoint.resumedAt,
      };
    }

    // Validate checkpoint is resumable
    if (checkpoint.status !== 'PAUSED_FOR_APPROVAL') {
      throw new Error(`Checkpoint ${checkpointId} is not in PAUSED_FOR_APPROVAL state`);
    }

    // Deserialize execution state
    const { plan, context, executedNodes: previousNodes, events: previousEvents } = checkpoint.serializedState;

    // Build execution graph
    const executionGraph = new ExecutionGraph(plan.graph);

    // Calculate all nodes that need re-execution (requested + dependents)
    const nodesToReExecuteSet = new Set(nodeIdsToReExecute);

    for (const nodeId of nodeIdsToReExecute) {
      const dependents = executionGraph.getAllDependents(nodeId);
      dependents.forEach(depId => nodesToReExecuteSet.add(depId));
    }

    logger.info({
      checkpointId,
      requestedNodes: nodeIdsToReExecute.length,
      totalNodesToReExecute: nodesToReExecuteSet.size,
      nodeIds: Array.from(nodesToReExecuteSet),
    }, '[RuntimeOrchestrator] selective re-execution started');

    // Separate previously executed nodes into re-execute vs keep
    const nodesToKeep = previousNodes.filter(n => !nodesToReExecuteSet.has(n.nodeId));
    const nodesToReExecute = previousNodes.filter(n => nodesToReExecuteSet.has(n.nodeId));

    // Initialize execution state
    const events = [...previousEvents];
    const executedNodes = [...nodesToKeep];

    // Emit re-execution event
    events.push({
      type: RUNTIME_EVENT.REEXECUTION_STARTED,
      checkpointId,
      nodeCount: nodesToReExecuteSet.size,
      nodeIds: Array.from(nodesToReExecuteSet),
    });

    // Mark kept nodes as their original status in graph
    for (const node of nodesToKeep) {
      executionGraph.updateNodeStatus(node.nodeId, node.status);
    }

    // Get all nodes in execution order
    const sortedNodes = executionGraph.getSortedNodes();

    // Filter to nodes that need execution (either new or re-execution)
    const nodesToExecute = sortedNodes.filter(node =>
      !nodesToKeep.find(n => n.nodeId === node.id)
    );

    logger.debug({
      totalNodes: sortedNodes.length,
      keptNodes: nodesToKeep.length,
      toExecute: nodesToExecute.length,
    }, '[RuntimeOrchestrator] re-execution plan');

    // Execute nodes (re-execute + remaining)
    for (const node of nodesToExecute) {
      // Check if node should be skipped due to failed dependencies
      if (executionGraph.shouldSkipNode(node.id)) {
        executionGraph.updateNodeStatus(node.id, NODE_STATUS.SKIPPED);
        events.push({ type: RUNTIME_EVENT.NODE_SKIPPED, nodeId: node.id });

        executedNodes.push({
          nodeId: node.id,
          nodeType: node.type,
          status: NODE_STATUS.SKIPPED,
          output: { reason: 'dependency_failed' },
          artifacts: [],
          attempts: 0,
        });

        logger.debug({ nodeId: node.id, nodeType: node.type }, '[RuntimeOrchestrator] node skipped during re-execution');
        continue;
      }

      // Execute node with retries
      executionGraph.updateNodeStatus(node.id, NODE_STATUS.RUNNING);

      const isReExecution = nodesToReExecuteSet.has(node.id);
      const eventType = isReExecution ? RUNTIME_EVENT.NODE_REEXECUTION : RUNTIME_EVENT.NODE_START;

      events.push({ type: eventType, nodeId: node.id, attempt: 1 });

      let result = null;
      let attempts = 0;
      let finalStatus = NODE_STATUS.FAILURE;

      // Merge decision context into execution context
      const enhancedContext = {
        ...plan,
        ...context,
        ...decisionContext,
        isReExecution,
        originalNode: nodesToReExecute.find(n => n.nodeId === node.id),
      };

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        attempts = attempt;

        if (attempt > 1) {
          events.push({ type: RUNTIME_EVENT.NODE_RETRY, nodeId: node.id, attempt });
          logger.debug({ nodeId: node.id, attempt }, '[RuntimeOrchestrator] retrying node during re-execution');
        }

        result = await executeNode(node, enhancedContext, attempt);

        if (result.success) {
          finalStatus = NODE_STATUS.SUCCESS;
          executionGraph.updateNodeStatus(node.id, NODE_STATUS.SUCCESS);
          events.push({ type: RUNTIME_EVENT.NODE_SUCCESS, nodeId: node.id, attempt });

          logger.debug({
            nodeId: node.id,
            nodeType: node.type,
            attempt,
            isReExecution,
          }, '[RuntimeOrchestrator] node succeeded during re-execution');

          // Store artifacts
          if (context.workspaceId && context.executionId && result.artifacts && result.artifacts.length > 0) {
            const storedArtifactIds = await storeNodeArtifacts({
              workspaceId: context.workspaceId,
              executionId: context.executionId,
              nodeId: node.id,
              nodeType: node.type,
              artifacts: result.artifacts,
              metadata: result.metadata || {},
            });

            result.storedArtifactIds = storedArtifactIds;

            logger.debug({
              nodeId: node.id,
              artifactCount: storedArtifactIds.length,
              isReExecution,
            }, '[RuntimeOrchestrator] artifacts stored during re-execution');
          }

          break;
        }

        // Failed — check if we should retry
        if (attempt === MAX_RETRIES) {
          finalStatus = NODE_STATUS.FAILURE;
          executionGraph.updateNodeStatus(node.id, NODE_STATUS.FAILURE);
          events.push({ type: RUNTIME_EVENT.NODE_FAILURE, nodeId: node.id, attempt });

          logger.warn({
            nodeId: node.id,
            nodeType: node.type,
            attempts,
            isReExecution,
          }, '[RuntimeOrchestrator] node failed after max retries during re-execution');
        }
      }

      executedNodes.push({
        nodeId: node.id,
        nodeType: node.type,
        status: finalStatus,
        output: result?.output || {},
        artifacts: result?.artifacts || [],
        storedArtifactIds: result?.storedArtifactIds || [],
        attempts,
        reExecuted: isReExecution,
      });
    }

    // Mark checkpoint as resumed
    await prisma.executionCheckpoint.update({
      where: { id: checkpointId },
      data: {
        status: 'RESUMED',
        resumedAt: new Date(),
      },
    });

    // Calculate summary
    const allNodes = executedNodes;
    const summary = {
      totalNodes: sortedNodes.length,
      successful: allNodes.filter(n => n.status === NODE_STATUS.SUCCESS).length,
      failed: allNodes.filter(n => n.status === NODE_STATUS.FAILURE).length,
      skipped: allNodes.filter(n => n.status === NODE_STATUS.SKIPPED).length,
      reExecuted: allNodes.filter(n => n.reExecuted).length,
    };

    // Determine overall status
    let status = EXECUTION_STATUS.SUCCESS;
    if (summary.failed > 0) {
      status = summary.successful > 0 ? EXECUTION_STATUS.PARTIAL_SUCCESS : EXECUTION_STATUS.FAILURE;
    } else if (summary.skipped > 0 && summary.successful === 0) {
      status = EXECUTION_STATUS.FAILURE;
    }

    events.push({ type: RUNTIME_EVENT.EXECUTION_SUCCESS, status });

    logger.info({
      status,
      summary,
      checkpointId,
    }, '[RuntimeOrchestrator] re-execution completed');

    return {
      status,
      executedNodes: allNodes,
      events,
      summary,
      reExecuted: true,
      checkpointId,
    };
  } catch (error) {
    logger.error({
      error: error.message,
      checkpointId,
      nodeIds: nodeIdsToReExecute,
    }, '[RuntimeOrchestrator] failed to re-execute nodes');
    throw error;
  }
}

// R11 (F26): shared Prisma client — this module used to open its own pool.
import { prisma } from '../../lib/prisma.js';
