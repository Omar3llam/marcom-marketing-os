// ============================================================
// AgentHomeService.getHome — resilience to a failing loop-state read
// ------------------------------------------------------------
// Regression: a schema change added `ai_insight` to LoopRun; the regenerated
// Prisma client then pulled that column in getLoopState's default projection.
// On a DB where the migration hadn't been applied, the read threw
// ("column loop_runs.ai_insight does not exist") and — because getLoopState was
// called unguarded — getHome threw a 500, blanking the WHOLE agenda with
// "Couldn't load your agenda". The fix: getLoopState now uses an explicit select
// (never auto-pulls a new column) AND getHome guards the call with
// `.catch(() => null)` + null-safe reads. This test locks that in: even when
// every loop_runs read fails, getHome still composes a home from planAgenda.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Every loop_runs read rejects — simulates the un-migrated ai_insight column.
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    loopRun: { findFirst: vi.fn().mockRejectedValue(new Error('column loop_runs.ai_insight does not exist')) },
  },
}));

// getLoopState throws (the un-guarded read that used to crash getHome). runSweep
// also throws (the sweep write hits the same missing column). buildLoopInputs +
// planAgenda are the fallback path that must still produce a usable agenda.
vi.mock('./AgenticLoopService.js', () => ({
  getLoopState: vi.fn().mockRejectedValue(new Error('column loop_runs.ai_insight does not exist')),
  runSweep: vi.fn().mockRejectedValue(new Error('column loop_runs.ai_insight does not exist')),
  buildLoopInputs: vi.fn().mockResolvedValue({ verdicts: [], goals: [], plans: [] }),
  LOOP_MIN_INTERVAL_MS: 900000,
}));

vi.mock('./agenticPlanner.js', () => ({
  planAgenda: vi.fn().mockReturnValue({
    summary: 'Portfolio steady.',
    buyerBand: [],
    strategistBand: [{ id: 'goal:g1', band: 'STRATEGIST', type: 'PLAN_ADJUSTMENT', title: 'Goal', severity: 'LOW', humanAction: 'review' }],
    stageStatus: [],
    closed: false,
    staleStages: ['EXECUTE'],
    loopHealth: 'STALLED',
  }),
}));

vi.mock('../decision-accuracy/DecisionAccuracyService.js', () => ({ getAccuracy: vi.fn().mockResolvedValue({}) }));
vi.mock('../decision-accuracy/accuracyTypes.js', () => ({ accuracySurface: vi.fn().mockReturnValue(null) }));

import { getHome } from './AgentHomeService.js';

describe('getHome — degrades gracefully when the loop-state read fails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes a home from planAgenda instead of throwing', async () => {
    const home = await getHome('ws1', 'STRATEGIST');
    expect(home).toBeTruthy();
    // The agenda still renders — the whole point of the fix.
    expect(home.strategistBand.count).toBe(1);
    expect(home.summary).toBe('Portfolio steady.');
  });

  it('reports honest null timing + null briefing rather than blanking', async () => {
    const home = await getHome('ws1', 'STRATEGIST');
    expect(home.loop.loopHealth).toBe('STALLED');
    expect(home.loop.lastRunAt).toBeNull();
    expect(home.loop.nextRunAt).toBeNull();
    expect(home.loop.intervalMs).toBe(900000); // fallback interval, not a crash
    expect(home.aiInsight).toBeNull();
  });
});
