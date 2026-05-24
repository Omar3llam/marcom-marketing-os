// ============================================================
// executionTrace — unit tests
// ============================================================
// Tests the core logic: timeline merge ordering, summary derivation,
// and null-safety for missing metric rows.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    executionRequest:   { findFirst: vi.fn() },
    executionTransition: { findMany: vi.fn() },
    executionMetric:    { findFirst: vi.fn() },
  },
}));

vi.mock('./eventStore.js', () => ({
  eventStore: { getEvents: vi.fn(() => []) },
}));

import { prisma }      from '../../../lib/prisma.js';
import { eventStore }  from './eventStore.js';
import { buildTrace }  from './executionTrace.js';

const EXECUTION_ID  = 'exec-trace-001';
const WORKSPACE_ID  = 'ws-abc-123';

const BASE_REQUEST = {
  id:            EXECUTION_ID,
  status:        'EXECUTED_SUCCESS',
  actionType:    'PAUSE_CAMPAIGN',
  targetId:      'camp-9',
  correlationId: 'corr-X',
  retryMetadata: null,
  createdAt:     new Date('2026-05-20T09:00:00.000Z'),
  updatedAt:     new Date('2026-05-20T09:00:30.000Z'),
};

const TRANSITIONS = [
  {
    id: 't1', fromStatus: 'PENDING', toStatus: 'QUEUED', actor: 'API',
    previousVersion: 0, newVersion: 1, reason: null, metadata: null,
    correlationId: 'corr-X', createdAt: new Date('2026-05-20T09:00:01.000Z'),
  },
  {
    id: 't2', fromStatus: 'QUEUED', toStatus: 'EXECUTING', actor: 'WORKER',
    previousVersion: 1, newVersion: 2, reason: null, metadata: null,
    correlationId: 'corr-X', createdAt: new Date('2026-05-20T09:00:05.000Z'),
  },
  {
    id: 't3', fromStatus: 'EXECUTING', toStatus: 'EXECUTED_SUCCESS', actor: 'WORKER',
    previousVersion: 2, newVersion: 3, reason: null, metadata: null,
    correlationId: 'corr-X', createdAt: new Date('2026-05-20T09:00:28.000Z'),
  },
];

const METRIC = {
  queueWaitMs: 4000, executionMs: 23000, retryCount: 0,
  timeoutOccurred: false, agentUsed: 'claude', finalStatus: 'EXECUTED_SUCCESS',
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.executionRequest.findFirst.mockResolvedValue(BASE_REQUEST);
  prisma.executionTransition.findMany.mockResolvedValue(TRANSITIONS);
  prisma.executionMetric.findFirst.mockResolvedValue(METRIC);
  eventStore.getEvents.mockReturnValue([]);
});

describe('buildTrace', () => {
  it('returns null when execution is not found in workspace', async () => {
    prisma.executionRequest.findFirst.mockResolvedValue(null);
    const result = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    expect(result).toBeNull();
  });

  it('returns structured trace with correct top-level fields', async () => {
    const trace = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    expect(trace.executionId).toBe(EXECUTION_ID);
    expect(trace.workspaceId).toBe(WORKSPACE_ID);
    expect(trace.status).toBe('EXECUTED_SUCCESS');
    expect(trace.correlationId).toBe('corr-X');
    expect(trace.actionType).toBe('PAUSE_CAMPAIGN');
    expect(trace.targetId).toBe('camp-9');
  });

  it('timeline is ordered by timestamp ascending', async () => {
    const trace = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    const timestamps = trace.timeline.map(e => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('transition entries carry source=transition and correct fields', async () => {
    const trace = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    const first = trace.timeline[0];
    expect(first.source).toBe('transition');
    expect(first.toStatus).toBe('QUEUED');
    expect(first.actor).toBe('API');
    expect(first.version).toEqual({ from: 0, to: 1 });
  });

  it('merges graph events from eventStore (sorted by timestamp)', async () => {
    const graphEvt = {
      eventId: 'evt_abc', eventType: 'execution.started',
      timestamp: '2026-05-20T09:00:03.000Z',  // between t1 and t2
      executionId: EXECUTION_ID, workerId: 'w1', graphNodeId: null, attempt: 1,
    };
    eventStore.getEvents.mockReturnValue([graphEvt]);

    const trace = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    expect(trace.timeline).toHaveLength(4);

    const graphEntry = trace.timeline.find(e => e.source === 'graph');
    expect(graphEntry).toBeDefined();
    expect(graphEntry.eventType).toBe('execution.started');
    expect(graphEntry.workerId).toBe('w1');

    // Must appear after t1 (09:00:01) and before t2 (09:00:05)
    const idx = trace.timeline.indexOf(graphEntry);
    expect(idx).toBe(1);
  });

  it('summary uses metric values when available', async () => {
    const trace = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    expect(trace.summary.queueWaitMs).toBe(4000);
    expect(trace.summary.executionMs).toBe(23000);
    expect(trace.summary.retryCount).toBe(0);
    expect(trace.summary.agentUsed).toBe('claude');
    expect(trace.summary.finalStatus).toBe('EXECUTED_SUCCESS');
  });

  it('summary falls back to transition counting when metric is null', async () => {
    prisma.executionMetric.findFirst.mockResolvedValue(null);
    const trace = await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    expect(trace.summary.queueWaitMs).toBeNull();
    expect(trace.summary.executionMs).toBeNull();
    expect(trace.summary.retryCount).toBe(0);
    expect(trace.summary.timeoutOccurred).toBe(false);
  });

  it('passes workspaceId to findFirst for auth boundary', async () => {
    await buildTrace(EXECUTION_ID, WORKSPACE_ID);
    expect(prisma.executionRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXECUTION_ID, workspaceId: WORKSPACE_ID } }),
    );
  });
});
