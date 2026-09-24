// ============================================================
// AgentHomeService.getHome — loop-state failure is not a first run
// ------------------------------------------------------------
// Regression: a schema change added `ai_insight` to LoopRun; the regenerated
// getLoopState already selects only the columns it needs. If that read still
// fails, publishing null timing as though no loop had run would erase failure
// truth and could lead to a false Home status.
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

// A failed timing read must stop composition before any agenda is planned.
vi.mock('./AgenticLoopService.js', () => ({
  getLoopState: vi.fn().mockRejectedValue(new Error('column loop_runs.ai_insight does not exist')),
  runSweep: vi.fn().mockRejectedValue(new Error('column loop_runs.ai_insight does not exist')),
  buildLoopInputs: vi.fn().mockResolvedValue({ verdicts: [], goals: [], plans: [] }),
  readRequiredLoopSource: async (source, read) => {
    try { return await read(); } catch (cause) {
      const error = new Error(`Home ${source} read failed`, { cause });
      error.source = source;
      throw error;
    }
  },
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
import { buildLoopInputs } from './AgenticLoopService.js';

describe('getHome — fails closed when the loop-state read fails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects with source identity before calling the planner input loader', async () => {
    await expect(getHome('ws1', 'STRATEGIST')).rejects.toMatchObject({ source: 'LOOP_STATE' });
    expect(buildLoopInputs).not.toHaveBeenCalled();
  });
});
