// ============================================================
// R10 · Phase C — learning happens whether or not anyone is looking
// ============================================================
// The defect this closes had no error, no log line and no failing test: pattern
// extraction lived inside a plan-gated GET, so a workspace nobody opened simply
// never learned, and a FREE or PRO workspace never could. Every surface kept
// reporting honestly on the zero patterns it had.
//
// So the controls here are about WIRING — that the sweep exists, that it is
// reachable without the route, that one workspace's failure cannot silence the
// rest, and that the route no longer writes.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { workspace: { findMany: vi.fn() } },
}));
vi.mock('./PatternService.js', () => ({ getBriefing: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { getBriefing } from './PatternService.js';
import { runLearningSweep } from './learningSweep.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const codeOf = (p) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const ROUTE_SRC   = codeOf(path.join(HERE, '../../routes/lumi/memory.js'));
const WORKER_SRC  = codeOf(path.join(HERE, '../../workers/maintenanceWorker.js'));
const QUEUES_SRC  = codeOf(path.join(HERE, '../../queues/index.js'));

beforeEach(() => {
  vi.clearAllMocks();
  getBriefing.mockResolvedValue({ patterns: [], promotableCount: 0, conflicts: [] });
});

describe('runLearningSweep — every workspace, on a schedule', () => {
  it('extracts for each workspace', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }, { id: 'ws-3' }]);

    const out = await runLearningSweep();

    expect(getBriefing).toHaveBeenCalledTimes(3);
    expect(getBriefing.mock.calls.map(([id]) => id)).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(out).toMatchObject({ workspaces: 3, learned: 3, failed: 0 });
  });

  // Per-workspace isolation. Without it, one account with a malformed row
  // freezes learning for every account behind it in the loop — silently, since
  // the job would simply end early and report nothing unusual.
  it('one workspace failing does not stop the others, and is counted', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }, { id: 'ws-3' }]);
    getBriefing
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('bad row'))
      .mockResolvedValueOnce({});

    const out = await runLearningSweep();

    expect(getBriefing).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ workspaces: 3, learned: 2, failed: 1 });
  });

  // A sweep that quietly did nothing must be distinguishable from one that
  // worked — the failure mode this whole phase exists to end.
  it('reports its counts rather than returning void', async () => {
    prisma.workspace.findMany.mockResolvedValue([]);
    await expect(runLearningSweep()).resolves.toEqual({ workspaces: 0, learned: 0, failed: 0 });
  });

  it('is bounded — an unbounded workspace table cannot produce an unbounded sweep', async () => {
    prisma.workspace.findMany.mockResolvedValue([]);
    await runLearningSweep({ maxWorkspaces: 42 });
    expect(prisma.workspace.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 42 }));
  });

  // Serial by design: each extraction reads a 365-day evidence window and opens
  // a transaction. Promise.all over every workspace is how a background sweep
  // becomes an incident.
  it('runs workspaces serially, not fanned out', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    let concurrent = 0;
    let peak = 0;
    getBriefing.mockImplementation(async () => {
      concurrent += 1; peak = Math.max(peak, concurrent);
      await Promise.resolve();
      concurrent -= 1;
      return {};
    });

    await runLearningSweep();
    expect(peak).toBe(1);
  });
});

describe('Phase C wiring — extraction is worker-owned', () => {
  // THE CONTROL FOR THE WHOLE PHASE. Point the route back at getBriefing and
  // this fails: learning would once again be a side effect of a plan-gated page
  // view. The route may only read.
  it('the briefing route reads, and never extracts', () => {
    expect(ROUTE_SRC).toMatch(/readBriefing/);
    expect(ROUTE_SRC).not.toMatch(/getBriefing/);
  });

  it('the maintenance worker dispatches the extraction job', () => {
    expect(WORKER_SRC).toMatch(/LEARNING_EXTRACTION_JOB/);
    expect(WORKER_SRC).toMatch(/runLearningSweep/);
  });

  it('the job is registered on the existing maintenance queue — no new queue', () => {
    expect(QUEUES_SRC).toMatch(/LEARNING_EXTRACTION_JOB/);
    expect(QUEUES_SRC).toMatch(/maintenanceQueue\.add\(\s*LEARNING_EXTRACTION_JOB/);
    // A new Queue() for learning would mean a new Redis surface and a new
    // worker process, which §7 forbids.
    expect(QUEUES_SRC).not.toMatch(/LEARNING_QUEUE_NAME/);
  });

  // The schedule must not sit behind an AI-spend flag. Extraction is
  // deterministic; gating it the way the agentic cron is gated would recreate
  // the starvation one config key later.
  it('the schedule is always-on — no enable flag gates whether an account learns', () => {
    expect(QUEUES_SRC).not.toMatch(/LEARNING_EXTRACTION_ENABLED/);
    expect(WORKER_SRC).not.toMatch(/LEARNING_EXTRACTION_ENABLED/);
  });

  // BullMQ repeatables persist in Redis keyed by their pattern; adding without
  // removing would leave an old cron firing alongside the new one forever.
  it('re-registers rather than stacking a second schedule', () => {
    const fn = QUEUES_SRC.slice(QUEUES_SRC.indexOf('export async function scheduleLearningExtraction'));
    expect(fn).toMatch(/removeRepeatableByKey/);
  });
});
