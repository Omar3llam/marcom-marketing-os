// ============================================================
// VerdictEngine — data-sufficiency gates + composed confidence (PR #307)
// ============================================================
// The defect: the only sample gate was `impressions > 0`, so a 12-impression
// campaign received a 0.9-confidence KILL. Layer 7 of the domain model says
// "< 1000 impressions = no verdict possible" and "< 3 days = too early".
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { evaluateVerdict, rollupVerdicts, MIN_IMPRESSIONS, MIN_DAYS } from './verdictEngine.js';
import { VERDICT, ROOT_CAUSE } from './verdictTypes.js';
import { FUNNEL_SIGNAL } from './funnelDiagnosis.js';

// A set of metrics that WOULD be a confident KILL if the sample were adequate.
const killable = (over = {}) => ({
  ctr: 0.4, cpc: 2, cpm: 10, frequency: 4.2, spend: 1000, conversions: 2, roas: 0.6,
  impressions: 50_000, clicks: 200, ...over,
});

describe('GATE 1 — minimum sample', () => {
  it('120 impressions → WATCH, never KILL', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: killable({ impressions: 120 }) });
    expect(r.verdict).toBe(VERDICT.WATCH);
    expect(r.verdict).not.toBe(VERDICT.KILL);
    expect(r.rootCause).toBe(ROOT_CAUSE.INSUFFICIENT_DATA);
  });

  it('says exactly what is missing, with real numbers', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: killable({ impressions: 120 }) });
    expect(r.rationale).toMatch(/insufficient data/i);
    expect(r.rationale).toContain('120');
    expect(r.rationale).toContain('1,000');
  });

  it('the SAME metrics above the floor do reach KILL — the gate is the only difference', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: killable({ impressions: 50_000 }) });
    expect(r.verdict).toBe(VERDICT.KILL);
  });

  it('exactly MIN_IMPRESSIONS passes the gate (the boundary is inclusive)', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: killable({ impressions: MIN_IMPRESSIONS }) });
    expect(r.verdict).toBe(VERDICT.KILL);
  });

  it('no SCALE from a thin sample either — the gate is verdict-agnostic', () => {
    const r = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { ctr: 5, cpc: 0.5, cpm: 5, frequency: 1.2, spend: 50, conversions: 9, roas: 8, impressions: 400, clicks: 20 },
    });
    expect(r.verdict).toBe(VERDICT.WATCH);
  });

  it('SKIPS when impressions is unknown — we never claim "insufficient data" about data we were not given', () => {
    // A legacy direct caller passes ratios without a denominator. Treating the
    // absent field as 0 would silently convert every such verdict into WATCH.
    const r = evaluateVerdict({ level: 'ADSET', metrics: { ctr: 0.4, cpc: 2, cpm: 10, frequency: 4.2, spend: 1000, conversions: 2, roas: 0.6 } });
    expect(r.verdict).toBe(VERDICT.KILL);
    expect(r.confidence).toBeGreaterThan(0.8);
  });
});

describe('GATE 2 — minimum days', () => {
  const young = (daysRunning) => evaluateVerdict({ level: 'CAMPAIGN', metrics: killable(), daysRunning });

  it('day 1 → WATCH with a "day 1 of 3" reason', () => {
    const r = young(1);
    expect(r.verdict).toBe(VERDICT.WATCH);
    expect(r.rootCause).toBe(ROOT_CAUSE.TOO_EARLY);
    expect(r.rationale).toMatch(/day 1 of 3/i);
  });

  it('day 3 clears the gate', () => {
    expect(young(MIN_DAYS).verdict).toBe(VERDICT.KILL);
  });

  it('unknown age SKIPS the gate honestly — a gap in ingestion is not evidence of youth', () => {
    expect(young(null).verdict).toBe(VERDICT.KILL);
  });

  it('the sample gate wins when both would fire — the more fundamental lack is reported', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: killable({ impressions: 100 }), daysRunning: 1 });
    expect(r.rootCause).toBe(ROOT_CAUSE.INSUFFICIENT_DATA);
  });
});

describe('confidence is composed, never frozen', () => {
  const base = { level: 'CAMPAIGN', metrics: killable() };

  it('the same verdict reports LOWER confidence on thinner data', () => {
    const thick = evaluateVerdict({ ...base, metrics: killable({ impressions: 200_000 }), daysRunning: 30 });
    const thin  = evaluateVerdict({ ...base, metrics: killable({ impressions: 1_200 }),   daysRunning: 30 });
    expect(thick.verdict).toBe(thin.verdict);
    expect(thin.confidence).toBeLessThan(thick.confidence);
  });

  it('exposes both halves so a weak signal is distinguishable from thin data', () => {
    const r = evaluateVerdict({ ...base, daysRunning: 30 });
    expect(r.signalConfidence).toBe(0.9);            // the KILL rule's own strength
    expect(r.dataConfidence).toBeGreaterThan(0);     // computed, not assumed
    expect(r.confidence).toBeLessThan(r.signalConfidence);
  });

  it('knowing the objective and the funnel raises confidence in the same verdict', () => {
    const blind = evaluateVerdict({ ...base, daysRunning: 30 });
    const known = evaluateVerdict({
      ...base, daysRunning: 30, objective: 'OUTCOME_SALES',
      createdTime: new Date('2026-01-01'), actionMetrics: { lpv: 900, atc: 40 },
    });
    expect(known.confidence).toBeGreaterThan(blind.confidence);
  });

  it('never exceeds 0.97', () => {
    const r = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { ctr: 6, cpc: 0.2, cpm: 3, frequency: 1.1, spend: 90_000, conversions: 4000, roas: 9, impressions: 5_000_000, clicks: 300_000 },
      daysRunning: 400, objective: 'OUTCOME_SALES', createdTime: new Date('2020-01-01'),
      actionMetrics: { lpv: 250_000, atc: 20_000, checkout: 9_000, purchase: 4_000 },
    });
    expect(r.confidence).toBeLessThanOrEqual(0.97);
  });

  it('a gate verdict carries a real confidence too, not a placeholder', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: killable({ impressions: 120 }) });
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.confidence).toBeLessThan(0.5); // thin data ⇒ low confidence, by construction
  });
});

describe('objective-aware CTR bars', () => {
  const healthyish = (ctr) => ({ ctr, cpc: 0.5, cpm: 5, frequency: 1.4, spend: 500, conversions: 60, roas: 4.2, impressions: 100_000, clicks: 2000 });

  it('the same 1.2% CTR scales an awareness campaign and holds a lead-gen one', () => {
    const awareness = evaluateVerdict({ level: 'CAMPAIGN', metrics: healthyish(1.2), objective: 'OUTCOME_AWARENESS', daysRunning: 30 });
    const leads     = evaluateVerdict({ level: 'CAMPAIGN', metrics: healthyish(1.2), objective: 'OUTCOME_LEADS',     daysRunning: 30 });
    expect(awareness.verdict).toBe(VERDICT.SCALE); // 1.2 ≥ awareness strong (1.0)
    expect(leads.verdict).toBe(VERDICT.HOLD);      // 1.2 < lead-gen strong (2.5)
  });

  it('cites the objective\'s own bar in the rationale, not a global constant', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: healthyish(1.2), objective: 'OUTCOME_AWARENESS', daysRunning: 30 });
    expect(r.rationale).toContain('1%');
  });
});

describe('funnel track — the ads worked, something after them did not', () => {
  const args = {
    level: 'CAMPAIGN',
    metrics: { ctr: 2.5, cpc: 0.5, cpm: 5, frequency: 1.4, spend: 500, conversions: 8, roas: 1.6, impressions: 100_000, clicks: 2_500 },
    objective: 'OUTCOME_SALES', daysRunning: 30,
    actionMetrics: { lpv: 800, atc: 40, checkout: 20, purchase: 8 },
  };

  it('a post-click drop becomes WATCH — not REFRESH, which would break what works', () => {
    const r = evaluateVerdict(args);
    expect(r.verdict).toBe(VERDICT.WATCH);
    expect(r.verdict).not.toBe(VERDICT.REFRESH);
    expect(r.rootCause).toBe(FUNNEL_SIGNAL.POST_CLICK);
  });

  it('the rationale carries the diagnosis, the counterfactual and the action', () => {
    const r = evaluateVerdict(args);
    expect(r.rationale).toMatch(/landing page/i);
    expect(r.rationale).toMatch(/not a creative problem/i);
    expect(r.rationale).toMatch(/pixel|redirect|speed/i);
  });

  it('attaches the structured funnel object with its evidence', () => {
    const r = evaluateVerdict(args);
    expect(r.funnel.stage).toBe('LPV');
    expect(r.funnel.evidence.length).toBeGreaterThan(0);
  });

  it('a saturated money-loser is still KILL — the funnel does not rescue it', () => {
    const r = evaluateVerdict({ ...args, metrics: { ...args.metrics, roas: 0.5, frequency: 4.5 } });
    expect(r.verdict).toBe(VERDICT.KILL);
  });

  it('funnel is null (not an empty object) when nothing was measured', () => {
    const r = evaluateVerdict({ ...args, actionMetrics: null });
    expect(r.funnel).toBeNull();
  });
});

describe('rollupVerdicts — the gates apply on the connector path', () => {
  it('a thin campaign inside a healthy account is WATCHed, not scored', () => {
    const tree = {
      id: 'acct', level: 'ACCOUNT', currency: 'USD',
      children: [
        { id: 'thin', level: 'CAMPAIGN', metrics: { spendMinor: 5000, revenueMinor: 100, impressions: 200, clicks: 4, conversions: 0, frequency: 4.5 } },
        { id: 'fat',  level: 'CAMPAIGN', metrics: { spendMinor: 100000, revenueMinor: 600000, impressions: 400000, clicks: 12000, conversions: 300, frequency: 1.4 } },
      ],
    };
    const r = rollupVerdicts(tree);
    const thin = r.children.find((c) => c.id === 'thin');
    expect(thin.verdict).toBe(VERDICT.WATCH);
    expect(thin.rootCause).toBe(ROOT_CAUSE.INSUFFICIENT_DATA);
    expect(r.children.find((c) => c.id === 'fat').verdict).toBe(VERDICT.SCALE);
  });

  it('stamps dataConfidence on every node so a later pass can compose against it', () => {
    const r = rollupVerdicts({ id: 'a', level: 'CAMPAIGN', metrics: { spendMinor: 10000, revenueMinor: 40000, impressions: 60000, clicks: 1500, conversions: 40, frequency: 1.2 } });
    expect(Number.isFinite(r.dataConfidence)).toBe(true);
  });

  it('threads the leaf objective into the benchmark selection', () => {
    const leaf = (objective) => rollupVerdicts({
      id: 'c', level: 'CAMPAIGN', objective,
      metrics: { spendMinor: 10000, revenueMinor: 40000, impressions: 100000, clicks: 1200, conversions: 40, frequency: 1.2 },
    });
    expect(leaf('OUTCOME_AWARENESS').verdict).toBe(VERDICT.SCALE); // 1.2% ≥ 1.0
    expect(leaf('OUTCOME_LEADS').verdict).toBe(VERDICT.HOLD);      // 1.2% < 2.5
  });
});
