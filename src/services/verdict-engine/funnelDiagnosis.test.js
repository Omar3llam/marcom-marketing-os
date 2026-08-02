// ============================================================
// funnelDiagnosis — WHERE the money is lost, with the receipts
// ============================================================
// The defect these close: with only CTR/CPC/conversions, a broken landing page
// and a bad creative were indistinguishable, and both were answered with
// "refresh the creative" — which destroys the one part that was working.
// ============================================================
import { describe, it, expect } from 'vitest';

import { diagnoseFunnel, FUNNEL_SIGNAL } from './funnelDiagnosis.js';

const SALES = 'OUTCOME_SALES';

describe('diagnoseFunnel — post-click (the landing page, not the creative)', () => {
  const args = { ctr: 2.5, clicks: 1000, actionMetrics: { lpv: 400 }, objective: SALES };

  it('CTR healthy + LPV rate 0.4 → FUNNEL_DROP_POST_CLICK', () => {
    expect(diagnoseFunnel(args).signal).toBe(FUNNEL_SIGNAL.POST_CLICK);
    expect(diagnoseFunnel(args).stage).toBe('LPV');
  });

  it('names the creative as NOT the problem — the counterfactual is the point', () => {
    const r = diagnoseFunnel(args);
    expect(r.counterfactual).toMatch(/not a creative problem/i);
    expect(r.counterfactual).toContain('2.50%'); // cites the real CTR, not a claim
  });

  it('carries evidence with both the value AND the benchmark it was judged against', () => {
    const r = diagnoseFunnel(args);
    expect(r.evidence).toHaveLength(2);
    for (const e of r.evidence) {
      expect(e).toHaveProperty('metric');
      expect(e).toHaveProperty('value');
      expect(e).toHaveProperty('benchmark');
      expect(['healthy', 'weak']).toContain(e.status);
      expect(Number.isFinite(e.value)).toBe(true);
    }
    expect(r.evidence.find((e) => e.metric === 'LPV_RATE').value).toBeCloseTo(0.4, 5);
  });

  it('gives one specific action', () => {
    expect(diagnoseFunnel(args).action).toMatch(/pixel|redirect|speed/i);
  });
});

describe('diagnoseFunnel — post-LPV (the offer, not the audience)', () => {
  const args = { ctr: 1.2, clicks: 1000, actionMetrics: { lpv: 750, atc: 7 }, objective: SALES };

  it('LPV healthy + ATC rate below benchmark → FUNNEL_DROP_POST_LPV', () => {
    const r = diagnoseFunnel(args);
    expect(r.signal).toBe(FUNNEL_SIGNAL.POST_LPV);
    expect(r.stage).toBe('ATC');
  });

  it('rules out the audience explicitly', () => {
    expect(diagnoseFunnel(args).counterfactual).toMatch(/not an audience problem/i);
  });

  it('measures ATC against LPV, not against clicks', () => {
    // Against clicks the rate would be 0.007; against the 750 who actually
    // arrived it is 0.0093. Blaming the offer for traffic that never landed is
    // the misattribution the stage-to-stage rule exists to prevent.
    const r = diagnoseFunnel(args);
    expect(r.evidence.find((e) => e.metric === 'ATC_RATE').value).toBeCloseTo(7 / 750, 5);
  });
});

describe('diagnoseFunnel — checkout (intent proven, friction after)', () => {
  it('ATC healthy + checkout rate below floor → FUNNEL_DROP_CHECKOUT', () => {
    const r = diagnoseFunnel({ ctr: 1.2, clicks: 1000, actionMetrics: { lpv: 700, atc: 100, checkout: 10 }, objective: SALES });
    expect(r.signal).toBe(FUNNEL_SIGNAL.CHECKOUT);
    expect(r.counterfactual).toMatch(/not a creative or audience problem/i);
    expect(r.action).toMatch(/payment|shipping|checkout/i);
  });
});

describe('diagnoseFunnel — refusing to diagnose what it did not measure', () => {
  it('returns null when every measured stage is healthy', () => {
    expect(diagnoseFunnel({ ctr: 2.0, clicks: 1000, actionMetrics: { lpv: 800, atc: 60, checkout: 30 }, objective: SALES })).toBeNull();
  });

  it('returns null (never throws) on zero clicks', () => {
    expect(() => diagnoseFunnel({ ctr: 0, clicks: 0, actionMetrics: { lpv: 10 }, objective: SALES })).not.toThrow();
    expect(diagnoseFunnel({ ctr: 0, clicks: 0, actionMetrics: { lpv: 10 }, objective: SALES })).toBeNull();
  });

  it('returns null when the funnel was never measured — blind is not "zero drop-off"', () => {
    expect(diagnoseFunnel({ ctr: 2.5, clicks: 1000, actionMetrics: null, objective: SALES })).toBeNull();
    expect(diagnoseFunnel({ ctr: 2.5, clicks: 1000, objective: SALES })).toBeNull();
  });

  it('an unmeasured ATC does not become a 0% add-to-cart rate', () => {
    // The whole account would otherwise report a catastrophic offer failure.
    const r = diagnoseFunnel({ ctr: 1.2, clicks: 1000, actionMetrics: { lpv: 800 }, objective: SALES });
    expect(r).toBeNull();
  });

  it('never diagnoses a cart stage on an awareness campaign (benchmark is null)', () => {
    const r = diagnoseFunnel({ ctr: 1.2, clicks: 1000, actionMetrics: { lpv: 900, atc: 1 }, objective: 'OUTCOME_AWARENESS' });
    expect(r).toBeNull();
  });

  it('survives being called with nothing', () => {
    expect(() => diagnoseFunnel()).not.toThrow();
    expect(diagnoseFunnel()).toBeNull();
  });
});

describe('signal provenance — the contract every funnel signal honours', () => {
  const cases = [
    { ctr: 2.5, clicks: 1000, actionMetrics: { lpv: 400 }, objective: SALES },
    { ctr: 1.2, clicks: 1000, actionMetrics: { lpv: 750, atc: 7 }, objective: SALES },
    { ctr: 1.2, clicks: 1000, actionMetrics: { lpv: 700, atc: 100, checkout: 10 }, objective: SALES },
  ];

  it('every signal carries evidence[], a counterfactual, and an action', () => {
    for (const c of cases) {
      const r = diagnoseFunnel(c);
      expect(r).not.toBeNull();
      expect(Array.isArray(r.evidence)).toBe(true);
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(typeof r.counterfactual).toBe('string');
      expect(r.counterfactual.length).toBeGreaterThan(0);
      expect(typeof r.action).toBe('string');
      expect(r.action.length).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThan(1);
    }
  });

  it('is deterministic', () => {
    expect(diagnoseFunnel(cases[0])).toEqual(diagnoseFunnel(cases[0]));
  });

  it('diagnoses the EARLIEST broken stage — later rates ride on leaked traffic', () => {
    // Both post-click and checkout look broken; the page must be fixed first,
    // because every downstream rate is computed off traffic that never arrived.
    const r = diagnoseFunnel({ ctr: 2.5, clicks: 1000, actionMetrics: { lpv: 300, atc: 100, checkout: 5 }, objective: SALES });
    expect(r.signal).toBe(FUNNEL_SIGNAL.POST_CLICK);
  });
});
