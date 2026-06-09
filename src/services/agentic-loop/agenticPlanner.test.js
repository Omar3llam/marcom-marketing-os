import { describe, it, expect } from 'vitest';
import { planAgenda } from './agenticPlanner.js';
import { AGENDA_BAND, AGENDA_TYPE, STAGE_STATE, LOOP_HEALTH, HUMAN_ACTION } from './agenticTypes.js';

const now = new Date('2026-06-09T00:00:00.000Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();

const guardrailVerdicts = [
  { id: 'd1', entityId: 'as1', entityLevel: 'ADSET', verdict: 'KILL', rationale: 'Frequency 4.2 over ceiling', status: 'PROPOSED' },
  { id: 'd2', entityId: 'cmp1', entityLevel: 'CAMPAIGN', verdict: 'WATCH', rationale: 'ROAS softening', status: 'PROPOSED' },
];
const fatiguePredictions = [
  { id: 'f1', entityId: 'as2', metric: 'frequency', ceiling: 3.5, projectedBreachDate: daysAgo(-2) }, // 2 days out
];
const pacing = [
  { channelId: 'meta', channel: 'Meta', status: 'OVER', daysEarly: 4 },
  { channelId: 'google', channel: 'Google', status: 'UNDER' },
];
const planTracking = { goals: [{ goalId: 'g1', metric: 'blendedCac', landing: { status: 'OFF_TRACK', basis: 'trend' } }] };
const blended = { portfolio: { blendedRoas: 3.2, gapPct: 38 } };
const labelsById = new Map([['as1', 'Cold #1'], ['cmp1', 'PMax'], ['as2', 'Cold #2']]);

const fullLoop = {
  plans: [{ id: 'p1', createdAt: daysAgo(2) }],
  allocationPlans: [{ id: 'a1', createdAt: daysAgo(3) }],
  executedActions: [{ id: 'e1', executedAt: daysAgo(1) }],
  openTests: [{ id: 't1', dimension: 'HOOK', startedAt: daysAgo(2) }],
  recentOutcomes: [{ id: 'o1', createdAt: daysAgo(1) }],
  recentMemory: [{ id: 'm1', createdAt: daysAgo(1) }],
};

const base = { guardrailVerdicts, fatiguePredictions, pacing, planTracking, blended, labelsById, now, ...fullLoop };

describe('agenticPlanner — banding', () => {
  const out = planAgenda(base);

  it('puts verdicts/fatigue/pacing-over/tests in the BUYER band', () => {
    const types = out.buyerBand.map((i) => i.type);
    expect(out.buyerBand.every((i) => i.band === AGENDA_BAND.BUYER)).toBe(true);
    expect(types).toContain(AGENDA_TYPE.VERDICT);
    expect(types).toContain(AGENDA_TYPE.FATIGUE);
    expect(types).toContain(AGENDA_TYPE.PACING);
  });

  it('puts goal drift / blended gap in the STRATEGIST band', () => {
    expect(out.strategistBand.every((i) => i.band === AGENDA_BAND.STRATEGIST)).toBe(true);
    expect(out.strategistBand.some((i) => i.type === AGENDA_TYPE.PLAN_ADJUSTMENT)).toBe(true);
  });

  it('a guardrail verdict becomes a CONFIRM item citing the decision id', () => {
    const v = out.buyerBand.find((i) => i.evidenceRef === 'd1');
    expect(v.humanAction).toBe(HUMAN_ACTION.CONFIRM);
    expect(v.title).toContain('Cold #1');
  });

  it('orders buyer items by severity (KILL high before WATCH low)', () => {
    const kill = out.buyerBand.findIndex((i) => i.evidenceRef === 'd1');
    const watch = out.buyerBand.findIndex((i) => i.evidenceRef === 'd2');
    expect(kill).toBeLessThan(watch);
  });
});

describe('agenticPlanner — loop status', () => {
  it('reports CLOSED + HEALTHY when every stage has a recent row', () => {
    const out = planAgenda(base);
    expect(out.closed).toBe(true);
    expect(out.staleStages).toEqual([]);
    expect(out.loopHealth).toBe(LOOP_HEALTH.HEALTHY);
    expect(out.stageStatus).toHaveLength(6);
    expect(out.stageStatus.every((s) => s.state === STAGE_STATE.ACTIVE)).toBe(true);
  });

  it('marks a stage STALE when its row is old / missing, and the loop not closed', () => {
    const out = planAgenda({ ...base, executedActions: [], recentMemory: [{ id: 'm1', createdAt: daysAgo(90) }] });
    const execute = out.stageStatus.find((s) => s.stage === 'EXECUTE');
    const learn = out.stageStatus.find((s) => s.stage === 'LEARN');
    expect(execute.state).toBe(STAGE_STATE.STALE);
    expect(learn.state).toBe(STAGE_STATE.STALE);
    expect(out.closed).toBe(false);
    expect(out.staleStages).toContain('EXECUTE');
  });

  it('STALLED when buyers have proposals but EXECUTE has gone stale', () => {
    const out = planAgenda({ ...base, executedActions: [] }); // proposals exist, no recent execution
    expect(out.loopHealth).toBe(LOOP_HEALTH.STALLED);
  });
});

describe('agenticPlanner — honesty + determinism', () => {
  it('an empty account yields empty bands, never fabricated work', () => {
    const out = planAgenda({ now });
    expect(out.buyerBand).toEqual([]);
    expect(out.strategistBand).toEqual([]);
    expect(out.summary).toMatch(/quiet/i);
    // empty account: no rows anywhere → loop is not closed, honestly
    expect(out.closed).toBe(false);
  });

  it('same input → identical output', () => {
    expect(JSON.stringify(planAgenda(base))).toBe(JSON.stringify(planAgenda(base)));
  });

  it('on-track goals do not clutter the strategist band', () => {
    const out = planAgenda({ ...base, planTracking: { goals: [{ goalId: 'g1', metric: 'roas', landing: { status: 'ON_TRACK' } }] }, blended: null, pacing: [] });
    expect(out.strategistBand).toEqual([]);
  });
});
