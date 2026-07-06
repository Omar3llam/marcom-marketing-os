// ============================================================
// temporalObserver.runObserverSweep — correctness + N+1 guard
// ------------------------------------------------------------
// The sweep was refactored to batch-load memories + states (commit 3677764,
// "eliminate N+1 queries") but had NO test. This pins two things:
//   1. A 3-action fixture produces exactly 3 correct DecisionMemory rows.
//   2. The N+1 GUARD: the sweep issues a CONSTANT number of DB reads
//      regardless of how many actions it processes — one action.findMany +
//      one decisionMemory.findMany + one campaignState.findMany, never one
//      pair per action. This is the regression that matters when Phase 5
//      swaps the in-memory fetchKpis stub for real per-campaign Insights
//      calls: a naive per-action fetch inside the loop would reintroduce
//      the N+1 and this test would fail.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hermetic: never touch Redis/BullMQ on import (runObserverSweep needs none).
vi.mock('bullmq', () => ({ Worker: vi.fn() }));
vi.mock('../queues/connection.js', () => ({ bullConnection: null, QUEUE_PREFIX: 'test' }));
vi.mock('../queues/index.js', () => ({ OBSERVER_QUEUE_NAME: 'observer', scheduleObserver: vi.fn() }));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    action:         { findMany: vi.fn() },
    decisionMemory: { findMany: vi.fn(), createMany: vi.fn() },
    campaignState:  { findMany: vi.fn(), upsert: vi.fn() },
    $transaction:   vi.fn((arr) => Promise.all(arr)),
  },
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { runObserverSweep } from './temporalObserver.js';

// Aged well past any impact window so every action is a candidate.
const AGED = new Date(Date.now() - 90 * 60 * 60 * 1000);

function makeActions(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`, workspaceId: 'ws-1', campaignId: `c${i}`, executedAt: AGED,
    payload: { kind: 'SCALE_CAMPAIGN', rationale: `r${i}` },
  }));
}

/** Wire the mocks for a clean sweep of `n` actions (no prior memories/states). */
function primeSweep(n) {
  vi.clearAllMocks();
  prisma.action.findMany.mockResolvedValue(makeActions(n));
  prisma.decisionMemory.findMany.mockResolvedValue([]); // nothing recorded yet
  prisma.campaignState.findMany.mockResolvedValue([]);  // all default to TESTING
  prisma.decisionMemory.createMany.mockResolvedValue({ count: n });
  prisma.campaignState.upsert.mockResolvedValue({});
}

describe('runObserverSweep — 3-action fixture correctness', () => {
  beforeEach(() => primeSweep(3));

  it('learns from all 3 actions', async () => {
    const res = await runObserverSweep();
    expect(res).toEqual({ scanned: 3, learned: 3 });
  });

  it('writes 3 DecisionMemory rows in ONE createMany, each mapped from its action', async () => {
    await runObserverSweep();
    expect(prisma.decisionMemory.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.decisionMemory.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.campaignId).sort()).toEqual(['c0', 'c1', 'c2']);
    for (const r of rows) {
      expect(r.workspaceId).toBe('ws-1');
      expect(r.actionType).toBe('SCALE_CAMPAIGN'); // from payload.kind
      // fetchKpis is time-invariant → before === after → zero deltas → sustained.
      expect(r.deltaCtr).toBe(0);
      expect(r.deltaRoas).toBe(0);
      expect(r.isSustainable).toBe(true);
      expect(r.resultStatus).toBe('sustained_lift');
    }
  });

  it('batch-reads memories with a single findMany over the deduped campaignId set', async () => {
    await runObserverSweep();
    expect(prisma.decisionMemory.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.decisionMemory.findMany.mock.calls[0][0].where;
    expect(where.campaignId.in.sort()).toEqual(['c0', 'c1', 'c2']);
  });
});

describe('runObserverSweep — N+1 guard: DB reads are constant as N grows', () => {
  const readCounts = () => ({
    actions:  prisma.action.findMany.mock.calls.length,
    memories: prisma.decisionMemory.findMany.mock.calls.length,
    states:   prisma.campaignState.findMany.mock.calls.length,
  });

  it('3 actions → exactly 3 reads (1 per table), NOT one pair per action', async () => {
    primeSweep(3);
    await runObserverSweep();
    expect(readCounts()).toEqual({ actions: 1, memories: 1, states: 1 });
  });

  it('doubling to 6 actions issues the SAME number of reads (no per-action query)', async () => {
    primeSweep(6);
    await runObserverSweep();
    // If a per-action DB read crept back into the loop, memories/states would
    // scale with N (→ 6). They must stay at 1.
    expect(readCounts()).toEqual({ actions: 1, memories: 1, states: 1 });
  });
});
