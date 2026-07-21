// ============================================================
// narrativeWorker — unit tests (Phase 8 cadence)
// ============================================================
// Exercises runNarrativeSweepAll in isolation (the BullMQ Worker is never
// instantiated). Asserts the three guarantees:
//   1. Authors a narrative for a workspace WITH a decision in the window.
//   2. SKIPS a workspace with no activity (no empty-report spam).
//   3. A per-workspace failure is contained — the sweep finishes the rest.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('bullmq', () => ({
  Worker: vi.fn(function MockWorker() {
    this.on = vi.fn();
    this.close = vi.fn();
  }),
}));

vi.mock('../queues/connection.js', () => ({
  bullConnection: null,
  QUEUE_PREFIX:   'lumi',
  REDIS_DISABLED: true,
}));

vi.mock('../queues/index.js', () => ({
  NARRATIVE_QUEUE_NAME: 'narrative',
  narrativeQueue:       null,
  scheduleNarratives:   vi.fn(() => Promise.resolve()),
  unscheduleNarratives: vi.fn(() => Promise.resolve(2)),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    workspace: { findMany: vi.fn() },
    decision:  { groupBy: vi.fn() },
  },
}));

vi.mock('../services/narrative-engine/NarrativeService.js', () => ({
  generateNarrative: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { generateNarrative } from '../services/narrative-engine/NarrativeService.js';
import { scheduleNarratives, unscheduleNarratives } from '../queues/index.js';
import { runNarrativeSweepAll, startNarrativeWorker } from './narrativeWorker.js';

const ORIGINAL_AI = process.env.AI_AUTOMATIC_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_AUTOMATIC_ENABLED; // default: automatic AI OFF (manual-only)
});

afterEach(() => {
  if (ORIGINAL_AI === undefined) delete process.env.AI_AUTOMATIC_ENABLED;
  else process.env.AI_AUTOMATIC_ENABLED = ORIGINAL_AI;
});

describe('runNarrativeSweepAll', () => {
  it('authors a LEADERSHIP narrative only for workspaces with a decision in the window', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-active' }, { id: 'ws-quiet' }]);
    // ws-quiet has no row in the grouped result → no activity → skipped.
    prisma.decision.groupBy.mockResolvedValue([{ workspaceId: 'ws-active', _count: { _all: 3 } }]);
    generateNarrative.mockResolvedValue({ id: 'n1' });

    const out = await runNarrativeSweepAll({ period: 'WEEKLY' });

    expect(out).toEqual({ workspaces: 2, generated: 1, skipped: 1 });
    expect(generateNarrative).toHaveBeenCalledTimes(1);
    expect(generateNarrative).toHaveBeenCalledWith('ws-active', expect.objectContaining({
      period: 'WEEKLY', audience: 'LEADERSHIP', actorId: null,
    }));
  });

  it('skips every workspace when nothing happened (no empty-report spam)', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-a' }, { id: 'ws-b' }]);
    prisma.decision.groupBy.mockResolvedValue([]); // no activity anywhere

    const out = await runNarrativeSweepAll({ period: 'MONTHLY' });

    expect(out).toEqual({ workspaces: 2, generated: 0, skipped: 2 });
    expect(generateNarrative).not.toHaveBeenCalled();
  });

  it('contains a per-workspace failure — the rest of the sweep still runs', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-boom' }, { id: 'ws-ok' }]);
    prisma.decision.groupBy.mockResolvedValue([
      { workspaceId: 'ws-boom', _count: { _all: 1 } },
      { workspaceId: 'ws-ok', _count: { _all: 2 } },
    ]);
    generateNarrative
      .mockRejectedValueOnce(new Error('blended truth unavailable'))
      .mockResolvedValueOnce({ id: 'n2' });

    const out = await runNarrativeSweepAll({ period: 'WEEKLY' });

    expect(out).toEqual({ workspaces: 2, generated: 1, skipped: 0 });
    expect(generateNarrative).toHaveBeenCalledTimes(2);
  });
});

// The weekly/monthly cadence is automatic AI spend → OPT-IN behind
// AI_AUTOMATIC_ENABLED (mirrors startAgenticWorker). Manual authoring via
// POST /narratives/generate is unaffected. The BullMQ Worker is mocked.
describe('startNarrativeWorker — cadence opt-in switch (AI_AUTOMATIC_ENABLED)', () => {
  it('default (unset) → NOT scheduled, and removes any persisted repeat', () => {
    startNarrativeWorker();
    expect(scheduleNarratives).not.toHaveBeenCalled();
    expect(unscheduleNarratives).toHaveBeenCalledTimes(1);
  });

  it('AI_AUTOMATIC_ENABLED=true → schedules the weekly/monthly cadence', () => {
    process.env.AI_AUTOMATIC_ENABLED = 'true';
    startNarrativeWorker();
    expect(scheduleNarratives).toHaveBeenCalledTimes(1);
    expect(unscheduleNarratives).not.toHaveBeenCalled();
  });

  it('only the literal "true" enables — "false" stays off + removes the repeat', () => {
    process.env.AI_AUTOMATIC_ENABLED = 'false';
    startNarrativeWorker();
    expect(scheduleNarratives).not.toHaveBeenCalled();
    expect(unscheduleNarratives).toHaveBeenCalledTimes(1);
  });
});
