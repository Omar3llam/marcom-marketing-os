// T3: existing absolute mathematics survive every unsupported comparison scope.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { rollupVerdicts } from './verdictEngine.js';
import { applyRelativeRanking } from './relativeRanking.js';

const campaign = (id, over = {}) => ({ id, level: 'CAMPAIGN', name: id, revenueExpected: false,
  objective: 'OUTCOME_AWARENESS', metrics: { spendMinor: 5000, revenueMinor: 0, impressions: 10000,
    clicks: 200, conversions: 0, frequency: 1.2, ...over } });
const extremes = () => [60, 200, 300, 500].map((clicks,i) => campaign(`c${i}`, { clicks }));
const assertAbsolute = (children, cohort) => {
  const absolute = rollupVerdicts({ id: 'account', level: 'ACCOUNT', children });
  const result = applyRelativeRanking({ ...absolute, cohort });
  expect(result.children).toEqual(absolute.children);
  expect(result.children.every((c) => c.relativeRank == null && c.relativeContext == null)).toBe(true);
  if (children.length) expect(result.relativeRefusal.reason).toBe('COHORT_COMPLETENESS_UNPROVEN');
  else expect(result.relativeRefusal).toBeUndefined();
  return { absolute, result };
};

describe('T3 / unsupported cohort authority cannot invent ranking or comparison figures', () => {
  for (const membershipCoverage of ['UNKNOWN','INCOMPLETE','FAILED', undefined, 'COMPLETE']) {
    for (const evaluationCoverage of ['UNKNOWN','INCOMPLETE','FAILED', undefined, 'COMPLETE']) {
      it(`preserves every absolute assessment for membership=${membershipCoverage}, coverage=${evaluationCoverage}`, () => {
        assertAbsolute(extremes(), { membershipCoverage, evaluationCoverage });
      });
    }
  }
  it('no cohort descriptor cannot authorize a relative KILL or SCALE', () => { assertAbsolute(extremes()); });
  it.each([0,1,2,3,4,199,200,201])('a bounded subset of %i identities never proves applicable membership', (count) => {
    assertAbsolute(Array.from({ length: count }, (_,i) => campaign(`c${i}`, { clicks: 60 + i * 10 })),
      { identityLimit: 200, traversalExhausted: true, returnedCount: count, membershipCoverage: 'UNKNOWN' });
  });
  it('no children produces no fabricated cohort figures', () => {
    const node = { id: 'account', children: [] }; expect(applyRelativeRanking(node)).toBe(node);
    expect(applyRelativeRanking(null)).toBeNull();
  });
  it('tiny spend, measured revenue and an absolute fatigue assessment retain their original governance', () => {
    assertAbsolute([...extremes(), campaign('tiny', { spendMinor: 500, clicks: 10 }),
      campaign('measured', { revenueMinor: 8000 }), campaign('fatigue', { clicks: 50, frequency: 4 })]);
  });
  it('awareness and conversion groups each retain their independent absolute results', () => {
    assertAbsolute([...extremes(), ...extremes().map((c) => ({ ...c, id: `conversion-${c.id}`, revenueExpected: true, objective: 'OUTCOME_SALES' }))]);
  });
  it('unmeasured and small samples never create a comparative average', () => {
    const { result } = assertAbsolute([campaign('empty', { impressions: 0, clicks: 0 }), campaign('thin', { impressions: 100, clicks: 1 }), ...extremes()]);
    expect(JSON.stringify(result)).not.toContain('group average');
  });
  it('the entity CTR keeps its percent convention without a fabricated cohort CTR', () => {
    const { result } = assertAbsolute(extremes());
    expect(result.children[0].signalInput.ctr).toBe(0.6);
    expect(result.children[0].relativeContext).toBeUndefined();
  });
  it('the refused pass is deterministic and never mutates the absolute input', () => {
    const absolute = rollupVerdicts({ id: 'account', level: 'ACCOUNT', children: extremes() });
    const before = JSON.stringify(absolute);
    expect(applyRelativeRanking(absolute)).toEqual(applyRelativeRanking(absolute));
    expect(JSON.stringify(absolute)).toBe(before);
  });
});
