// ============================================================
// Execution Checkpoint Service — PR #29
// ============================================================
// Persistent state snapshots for resumable execution.
// Enables pause/resume capability for human-in-the-loop workflows.
//
// OPERATIONS:
//   - createCheckpoint(executionId, nodeId, state)
//   - getLatestCheckpoint(executionId, workspaceId)
//   - markCheckpointResumed(checkpointId)
//   - getPausedExecutions(workspaceId)
//   - healthCheck()
//
// INVARIANTS:
//   - One active checkpoint per execution (latest wins)
//   - Checkpoints immutable after creation (resumedAt only mutation)
//   - Resume must be idempotent (double resume = noop)
// ============================================================
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

// ============================================================
// Constants
// ============================================================

export const CHECKPOINT_STATUS = {
  PAUSED_FOR_APPROVAL: 'PAUSED_FOR_APPROVAL',
  RESUMING: 'RESUMING',
  RESUMED: 'RESUMED',
};

export const PAUSE_REASONS = {
  AWAITING_ARTIFACT_APPROVAL: 'awaiting_artifact_approval',
  MANUAL_PAUSE: 'manual_pause',
  SYSTEM_INTERRUPT: 'system_interrupt',
};

// ============================================================
// Core Operations
// ============================================================

/**
 * Create execution checkpoint for pause/resume
 * @param {string} executionId - Execution ID
 * @param {string} workspaceId - Workspace ID
 * @param {string} nodeId - Current node position in graph
 * @param {object} serializedState - Full execution graph state
 * @param {string} pausedReason - Why execution was paused
 * @returns {Promise<object>} Created checkpoint
 */
export async function createCheckpoint(
  executionId,
  workspaceId,
  nodeId,
  serializedState,
  pausedReason = PAUSE_REASONS.AWAITING_ARTIFACT_APPROVAL
) {
  try {
    const checkpoint = await prisma.executionCheckpoint.create({
      data: {
        executionId,
        workspaceId,
        nodeId,
        status: CHECKPOINT_STATUS.PAUSED_FOR_APPROVAL,
        serializedState,
        pausedReason,
      },
    });

    logger.info({
      checkpointId: checkpoint.id,
      executionId,
      nodeId,
      pausedReason,
    }, '[checkpoint] execution checkpoint created');

    return checkpoint;
  } catch (error) {
    logger.error({
      error: error.message,
      executionId,
      nodeId,
    }, '[checkpoint] failed to create checkpoint');
    throw error;
  }
}

/**
 * Get checkpoint by ID, within a workspace.
 *
 * R9 (I40) — ExecutionCheckpoint carries workspaceId; this read ignored it. A
 * checkpoint is resumable execution state, so resolving one globally is the
 * lookup that precedes re-running another workspace's nodes.
 *
 * @param {string} checkpointId - Checkpoint ID
 * @param {string} workspaceId - Required; the owning workspace
 * @returns {Promise<object|null>} Checkpoint, or null when absent or foreign
 */
export async function getCheckpointById(checkpointId, workspaceId) {
  if (!workspaceId) throw new Error('getCheckpointById: workspaceId required');
  try {
    const checkpoint = await prisma.executionCheckpoint.findFirst({
      where: { id: checkpointId, workspaceId },
    });

    return checkpoint;
  } catch (error) {
    logger.error({
      error: error.message,
      checkpointId,
    }, '[checkpoint] failed to retrieve checkpoint by ID');
    throw error;
  }
}

/**
 * Get the latest checkpoint for an execution, within a workspace.
 *
 * R9 (I40) — see getCheckpointById. Both callers had already verified the
 * ExecutionRequest's workspace before calling; that check now travels WITH the
 * query instead of sitting beside it.
 *
 * @param {string} executionId - Execution ID
 * @param {string} workspaceId - Required; the owning workspace
 * @returns {Promise<object|null>} Latest checkpoint, or null when absent or foreign
 */
export async function getLatestCheckpoint(executionId, workspaceId) {
  if (!workspaceId) throw new Error('getLatestCheckpoint: workspaceId required');
  try {
    const checkpoint = await prisma.executionCheckpoint.findFirst({
      where: { executionId, workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    return checkpoint;
  } catch (error) {
    logger.error({
      error: error.message,
      executionId,
    }, '[checkpoint] failed to retrieve latest checkpoint');
    throw error;
  }
}

/**
 * Mark checkpoint as resumed
 * @param {string} checkpointId - Checkpoint ID
 * @returns {Promise<object>} Updated checkpoint
 */
export async function markCheckpointResumed(checkpointId) {
  try {
    const checkpoint = await prisma.executionCheckpoint.update({
      where: { id: checkpointId },
      data: {
        status: CHECKPOINT_STATUS.RESUMED,
        resumedAt: new Date(),
      },
    });

    logger.info({
      checkpointId,
      executionId: checkpoint.executionId,
    }, '[checkpoint] checkpoint marked as resumed');

    return checkpoint;
  } catch (error) {
    logger.error({
      error: error.message,
      checkpointId,
    }, '[checkpoint] failed to mark checkpoint as resumed');
    throw error;
  }
}

/**
 * Get all paused executions for workspace
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<Array>} Paused checkpoints with execution data
 */
export async function getPausedExecutions(workspaceId) {
  try {
    const checkpoints = await prisma.executionCheckpoint.findMany({
      where: {
        workspaceId,
        status: CHECKPOINT_STATUS.PAUSED_FOR_APPROVAL,
        resumedAt: null,
      },
      include: {
        execution: true,
      },
      orderBy: { createdAt: 'asc' }, // FIFO order
    });

    return checkpoints;
  } catch (error) {
    logger.error({
      error: error.message,
      workspaceId,
    }, '[checkpoint] failed to retrieve paused executions');
    throw error;
  }
}

/**
 * Update checkpoint status (for transitioning to RESUMING)
 * @param {string} checkpointId - Checkpoint ID
 * @param {string} status - New status
 * @returns {Promise<object>} Updated checkpoint
 */
export async function updateCheckpointStatus(checkpointId, status) {
  try {
    const checkpoint = await prisma.executionCheckpoint.update({
      where: { id: checkpointId },
      data: { status },
    });

    logger.debug({
      checkpointId,
      status,
    }, '[checkpoint] checkpoint status updated');

    return checkpoint;
  } catch (error) {
    logger.error({
      error: error.message,
      checkpointId,
      status,
    }, '[checkpoint] failed to update checkpoint status');
    throw error;
  }
}

/**
 * Health check for checkpoint service
 * @returns {Promise<object>} Health status
 */
export async function healthCheck() {
  try {
    // Test DB connection with simple query
    const count = await prisma.executionCheckpoint.count();

    return {
      status: 'healthy',
      checkpointCount: count,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({
      error: error.message,
    }, '[checkpoint] health check failed');

    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}
