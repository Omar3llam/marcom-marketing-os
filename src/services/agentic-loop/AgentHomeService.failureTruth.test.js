import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { loopRun: { findFirst: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./AgenticLoopService.js', () => ({
  getLoopState: vi.fn(), runSweep: vi.fn(), buildLoopInputs: vi.fn(),
  readRequiredLoopSource: async (source, read) => {
    try { return await read(); } catch (cause) {
      const error = new Error(`Home ${source} read failed`, { cause });
      error.source = source;
      throw error;
    }
  },
  LOOP_MIN_INTERVAL_MS: 900000,
}));
vi.mock('./agenticPlanner.js', () => ({ planAgenda: vi.fn() }));
vi.mock('../decision-accuracy/DecisionAccuracyService.js', () => ({ getAccuracy: vi.fn() }));
vi.mock('../decision-accuracy/accuracyTypes.js', () => ({ accuracySurface: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getLoopState, runSweep, buildLoopInputs } from './AgenticLoopService.js';
import { planAgenda } from './agenticPlanner.js';
import { getAccuracy } from '../decision-accuracy/DecisionAccuracyService.js';
import { accuracySurface } from '../decision-accuracy/accuracyTypes.js';
import { getHome } from './AgentHomeService.js';

const emptyAgenda = {
  summary: 'Nothing needs a decision right now — the loop is quiet.',
  buyerBand: [], strategistBand: [], stageStatus: [], staleStages: [],
  closed: false, loopHealth: 'STALLED',
};

beforeEach(() => {
  vi.resetAllMocks();
  getLoopState.mockResolvedValue({ lastRun: { createdAt: new Date() }, intervalMs: 900000 });
  buildLoopInputs.mockResolvedValue({ verdicts: [] });
  planAgenda.mockReturnValue(emptyAgenda);
  getAccuracy.mockResolvedValue({});
  accuracySurface.mockReturnValue(null);
  prisma.loopRun.findFirst.mockResolvedValue(null);
});

describe('getHome only plans from successfully read inputs', () => {
  it.each(['BUYER', 'STRATEGIST'])('%s keeps a genuine empty agenda successful', async (role) => {
    const home = await getHome('ws1', role);
    expect(home.summary).toMatch(/quiet/);
    expect(home.buyerBand).toMatchObject({ items: [], count: 0, empty: true });
    expect(planAgenda).toHaveBeenCalledWith({ verdicts: [] });
  });

  it('keeps populated buyer and strategist bands on success', async () => {
    const buyer = { id: 'd1' };
    const strategist = { id: 'g1' };
    planAgenda.mockReturnValue({ ...emptyAgenda, buyerBand: [buyer], strategistBand: [strategist], summary: '1 to decide, 1 to steer.' });
    const home = await getHome('ws1', 'STRATEGIST');
    expect(home.buyerBand.items).toEqual([buyer]);
    expect(home.strategistBand.items).toEqual([strategist]);
    expect(home.summary).toBe('1 to decide, 1 to steer.');
  });

  it('does not invoke the planner when a required input read fails', async () => {
    const failure = Object.assign(new Error('Home OUTCOMES read failed'), { source: 'OUTCOMES' });
    buildLoopInputs.mockRejectedValue(failure);
    await expect(getHome('ws1', 'STRATEGIST')).rejects.toBe(failure);
    expect(planAgenda).not.toHaveBeenCalled();
  });

  it('does not retry a failed required read through the on-read sweep fallback', async () => {
    const failure = Object.assign(new Error('Home MEMORY read failed'), { source: 'MEMORY' });
    getLoopState.mockResolvedValue({ lastRun: null, intervalMs: 900000 });
    runSweep.mockRejectedValue(failure);
    await expect(getHome('ws1', 'BUYER')).rejects.toBe(failure);
    expect(buildLoopInputs).not.toHaveBeenCalled();
    expect(planAgenda).not.toHaveBeenCalled();
  });

  it('keeps independent accuracy and briefing failures out of agenda truth and logs each source', async () => {
    getAccuracy.mockRejectedValue(new Error('accuracy failed'));
    prisma.loopRun.findFirst.mockRejectedValue(new Error('briefing failed'));
    const home = await getHome('ws1', 'STRATEGIST');
    expect(home.proof).toBeNull();
    expect(home.aiInsight).toBeNull();
    expect(home.summary).toMatch(/quiet/);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ source: 'ACCURACY' }), expect.any(String));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ source: 'BRIEFING' }), expect.any(String));
  });
});
