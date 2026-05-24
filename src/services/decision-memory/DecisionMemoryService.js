// ============================================================
// DecisionMemoryService
// ============================================================
// Append-only write layer for strategic decision outcomes.
//
// RUNTIME ISOLATION CONTRACT:
//   - never calls routes
//   - never enqueues jobs
//   - never mutates ExecutionRequest state
//   - never updates or deletes prior memory rows
// ============================================================
import { prisma }                from '../../lib/prisma.js';
import { logger }                from '../../utils/logger.js';
import { serializeMemoryPayload } from './memorySerializer.js';

/**
 * Persists one decision memory row.  Append-only — never mutates
 * prior rows.  Validates via serializeMemoryPayload first.
 *
 * @param {object} payload  Raw caller-supplied payload
 * @returns {Promise<object>} The created DecisionMemory record
 */
async function recordDecisionMemory(payload) {
  const data = serializeMemoryPayload(payload);

  const record = await prisma.decisionMemory.create({ data });

  logger.info({
    id:           record.id,
    executionId:  data.executionId,
    workspaceId:  data.workspaceId,
    signalType:   data.signalType,
    outcome:      data.outcome,
    confidence:   data.confidence,
  }, '[DecisionMemory] recorded');

  return record;
}

/**
 * Returns the most recent memory rows for a workspace,
 * reverse-chronological, workspace-scoped.
 *
 * @param {string} workspaceId
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
async function getRecentMemories(workspaceId, limit = 20) {
  return prisma.decisionMemory.findMany({
    where:   { workspaceId },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });
}

export const decisionMemoryService = {
  recordDecisionMemory,
  getRecentMemories,
};
