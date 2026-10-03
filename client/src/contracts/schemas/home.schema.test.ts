import { describe, expect, it } from 'vitest';
import { AgentHomeSchema } from './home.schema';

const band = { title: 'Valid band', items: [], count: 0, empty: true };
const homeFixture = {
  role: 'STRATEGIST', summary: 'Valid agenda', buyerBand: band, strategistBand: band,
  loop: { stageStatus: [], closed: false, staleStages: [], loopHealth: 'HEALTHY',
    lastRunAt: null, nextRunAt: null, intervalMs: 900000 },
  aiInsight: null, aiInsightStatus: 'EMPTY',
};

describe('Home briefing publication contract', () => {
  it.each([
    ['PRESENT', 'Exact briefing'], ['EMPTY', null], ['UNAVAILABLE', null],
  ])('accepts %s with %s', (aiInsightStatus, aiInsight) => {
    expect(AgentHomeSchema.parse({ ...homeFixture, aiInsightStatus, aiInsight }))
      .toMatchObject({ aiInsightStatus, aiInsight });
  });
  it.each([
    ['PRESENT', null], ['EMPTY', 'invented'], ['UNAVAILABLE', 'invented'],
    ['UNKNOWN', null], [undefined, null], ['EMPTY', undefined],
  ])('rejects contradictory or missing status/value %s/%s', (aiInsightStatus, aiInsight) => {
    expect(AgentHomeSchema.safeParse({ ...homeFixture, aiInsightStatus, aiInsight }).success).toBe(false);
  });
  it('retains an observable distinction between successful absence and failed source', () => {
    const empty = AgentHomeSchema.parse(homeFixture);
    const unavailable = AgentHomeSchema.parse({ ...homeFixture, aiInsightStatus: 'UNAVAILABLE' });
    expect(empty.aiInsight).toBeNull(); expect(unavailable.aiInsight).toBeNull();
    expect(unavailable).not.toEqual(empty);
  });
});
