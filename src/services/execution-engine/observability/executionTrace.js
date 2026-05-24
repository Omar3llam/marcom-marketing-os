// Builds a deterministic execution timeline by merging:
//   1. ExecutionTransition rows (durable DB truth)
//   2. Live graph events from eventStore (in-memory, ephemeral)
//
// Answerable question: "Why was node X skipped 3 days ago?"
// → load transitions from DB, merge with any surviving graph events, sort by timestamp.

import { prisma } from '../../../lib/prisma.js';
import { eventStore } from './eventStore.js';

export async function buildTrace(executionId, workspaceId) {
  const [request, transitions, metric] = await Promise.all([
    prisma.executionRequest.findFirst({
      where:  { id: executionId, workspaceId },
      select: {
        id: true, status: true, createdAt: true, updatedAt: true,
        correlationId: true, retryMetadata: true, actionType: true, targetId: true,
      },
    }),
    prisma.executionTransition.findMany({
      where:   { executionId, workspaceId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.executionMetric.findFirst({
      where:  { executionId },
      select: {
        queueWaitMs: true, executionMs: true, retryCount: true,
        timeoutOccurred: true, agentUsed: true, finalStatus: true,
      },
    }),
  ]);

  if (!request) return null;

  const graphEvents = eventStore.getEvents(executionId);
  const timeline    = _mergeTimeline(transitions, graphEvents);
  const summary     = _buildSummary(transitions, metric);

  return {
    executionId:   request.id,
    workspaceId,
    actionType:    request.actionType,
    targetId:      request.targetId,
    correlationId: request.correlationId ?? null,
    status:        request.status,
    createdAt:     request.createdAt,
    updatedAt:     request.updatedAt,
    timeline,
    summary,
  };
}

function _mergeTimeline(transitions, graphEvents) {
  const transitionEntries = transitions.map(t => ({
    eventId:       t.id,
    eventType:     `execution.transition.${t.toStatus.toLowerCase()}`,
    timestamp:     t.createdAt.toISOString(),
    source:        'transition',
    actor:         t.actor,
    fromStatus:    t.fromStatus,
    toStatus:      t.toStatus,
    reason:        t.reason ?? null,
    correlationId: t.correlationId ?? null,
    version:       { from: t.previousVersion, to: t.newVersion },
    metadata:      t.metadata ?? null,
  }));

  const graphEntries = graphEvents.map(e => ({
    eventId:     e.eventId,
    eventType:   e.eventType,
    timestamp:   e.timestamp,
    source:      'graph',
    actor:       null,
    graphNodeId: e.graphNodeId ?? null,
    executionId: e.executionId ?? null,
    workerId:    e.workerId ?? null,
    attempt:     e.attempt ?? 1,
    metadata:    null,
  }));

  return [...transitionEntries, ...graphEntries]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function _buildSummary(transitions, metric) {
  const retried = transitions.filter(
    t => t.toStatus === 'QUEUED' && t.fromStatus !== null && t.fromStatus !== 'PENDING',
  );

  return {
    totalTransitions: transitions.length,
    retryCount:       metric?.retryCount   ?? retried.length,
    timeoutOccurred:  metric?.timeoutOccurred ?? false,
    queueWaitMs:      metric?.queueWaitMs  ?? null,
    executionMs:      metric?.executionMs  ?? null,
    agentUsed:        metric?.agentUsed    ?? null,
    finalStatus:      metric?.finalStatus  ?? null,
  };
}
