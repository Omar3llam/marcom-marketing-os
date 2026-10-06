import { describe, it, expect } from 'vitest';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';
const now = new Date('2026-10-01T00:00:00Z');
const decision = (i, over = {}) => ({ id: `d${i}`, accuracyStatus: 'EXECUTED', verdict: 'KILL', confidence: .15,
  createdAt: '2026-01-03T10:00:00Z', outcome: { sustained: true, spendDeltaMinor: 100, windowEnd: '2026-05-01' }, ...over });
const rows = () => Array.from({ length: 40 }, (_, i) => decision(i, i < 20 ? {} : {
  confidence: .85, createdAt: '2026-04-20T18:00:00Z', outcome: { sustained: true, spendDeltaMinor: -100, windowEnd: '2026-05-01' } }));
const calculate = (decisions, config) => calculateDecisionAccuracy({ decisions, now, config });
describe('P7-07E calibration publication truth', () => {
  it('omits grid holes while preserving exact aggregate math and real means', () => {
    const { calibration: c } = calculate(rows());
    expect(c.bins).toEqual([
      { band: '10-20%', predicted: .15, observed: 0, count: 20, gap: .15 },
      { band: '80-90%', predicted: .85, observed: 1, count: 20, gap: .15 },
    ]);
    expect(c.binEdges).toEqual([0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1]);
    expect(c).toMatchObject({ expectedCalibrationError: .15, brierScore: .0225, accuracy: .5, direction: 'CALIBRATED', sampleSize: 40,
      populationSpan: { basis: 'DECISION_ISSUED_AT', from: '2026-01-03T10:00:00.000Z', to: '2026-04-20T18:00:00.000Z' } });
  });
  it('an empty high-confidence band never publishes midpoint prediction or observed zero', () => {
    const c = calculate(rows().slice(0,20)).calibration;
    expect(c.bins).toHaveLength(1); expect(c.bins.some(b => b.band === '80-90%' || b.count === 0)).toBe(false);
  });
  it('preserves populated predicted, observed and gap zero', () => {
    const c = calculate(Array.from({ length: 20 }, (_, i) => decision(i, { confidence: 0 }))).calibration;
    expect(c.bins).toEqual([{ band: '0-10%', predicted: 0, observed: 0, count: 20, gap: 0 }]);
    expect(c).toMatchObject({ expectedCalibrationError: 0, brierScore: 0, accuracy: 0, direction: 'CALIBRATED' });
  });
  it('keeps the finest grid satisfying the existing nonempty-bin floor and config overrides', () => {
    const decisions = [...rows().slice(0,20), ...rows().slice(0,10).map((d,i) => ({ ...d, id:`x${i}`, confidence: .21 }))];
    const c = calculate(decisions).calibration;
    expect(c.binEdges).toEqual([0,.25,.5,.75,1]); expect(c.bins.map(b=>b.count)).toEqual([30]);
    const overridden = calculate(decisions,{minBinCount:10}).calibration;
    expect(overridden.binEdges).toHaveLength(11); expect(overridden.bins.map(b=>b.count)).toEqual([20,10]);
  });
  it.each([
    { createdAt: '2025-01-01', confidence: null },
    { createdAt: '2027-01-01', outcome: null },
    { createdAt: '2025-01-01', accuracyStatus: 'DISMISSED' },
    { createdAt: '2025-01-01', verdict: 'WATCH' },
    { createdAt: '2025-01-01', outcome: { sustained:true, windowEnd:'2026-05-01' } },
  ])('excluded decision does not widen the scored issuance span: %j', over => {
    expect(calculate([...rows(),decision('excluded',over)]).calibration.populationSpan).toEqual(calculate(rows()).calibration.populationSpan);
  });
  it('keeps same-instant endpoints and no-population null', () => {
    const c = calculate([decision(0)]).calibration;
    expect(c.populationSpan).toEqual({ basis:'DECISION_ISSUED_AT', from:'2026-01-03T10:00:00.000Z', to:'2026-01-03T10:00:00.000Z' });
    expect(calculate([]).calibration).toMatchObject({ bins:[], sampleSize:0, populationSpan:null, expectedCalibrationError:null, brierScore:null, accuracy:null, direction:'CALIBRATED' });
  });
  it.each([null, undefined, 'bad date', new Date(NaN)])('refuses an invalid scored issuance instant without dropping a decision: %s', createdAt => {
    expect(() => calculate([decision(0,{createdAt})])).toThrow('Scored decision requires a valid issuance timestamp');
  });
});
