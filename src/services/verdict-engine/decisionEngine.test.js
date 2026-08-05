// ============================================================
// Decision Engine v2 — reasoning confidence reaches the verdict
// ------------------------------------------------------------
// What is pinned here:
//   1. the derived reasoning confidence replaces the rule's frozen literal on
//      the MECHANISM track ONLY. Every other branch's number is its own measure
//      of its own evidence — the funnel's especially, which is about a
//      stage-to-stage drop-off the diagnosis rules never saw.
//   2. the early gates still read `extra.hypotheses`, never the closure. Those
//      consts are declared BELOW the gate returns; a closure reference throws
//      only at runtime, only on thin or young campaigns.
//   3. `signalConfidence` survives both allowlists. It was computed on every
//      verdict since the engine existed and published nowhere.
//   4. the published triple multiplies out — for absolute verdicts. It does NOT
//      for relative upgrades, and the scope of that test is the finding.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConnectorCampaigns } = vi.hoisted(() => ({ getConnectorCampaigns: vi.fn() }));
vi.mock('../entity-graph/index.js', () => ({ getConnectorCampaigns }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { evaluateVerdict, rollupVerdicts } from './verdictEngine.js';
import { applyRelativeRanking } from './relativeRanking.js';
import { getConnectorVerdicts } from './connectorVerdictService.js';
import { isSubstantive } from './counterfactualEngine.js';
import { diagnoseFunnel } from './funnelDiagnosis.js';
import { composeConfidence } from './confidenceEngine.js';
import { SIGNAL_TYPE } from '../diagnosis-engine/diagnosisTypes.js';
import { VERDICT } from './verdictTypes.js';

// Fatigued + weak CTR, with revenue measured: lands on the mechanism track.
const fatigued = {
  roas: 2.0, frequency: 4.0, ctr: 0.7, revenueMeasured: true,
  impressions: 50_000, clicks: 350,
};

// ── The wiring ──────────────────────────────────────────────────────────────
describe('evaluateVerdict — reasoning confidence is the signal half on the mechanism track', () => {
  it('replaces the rule\'s frozen literal with the derived number', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued });
    expect(v.verdict).toBe(VERDICT.REFRESH);
    expect(v.signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    // The rule literal is 0.85; the evidence converges to 0.95.
    expect(v.signalConfidence).toBe(0.95);
    expect(v.signalConfidence).toBe(v.hypotheses[0].confidence.reasoning);
  });

  it('composes it against data quality, as before', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued });
    expect(v.confidence).toBe(composeConfidence(v.signalConfidence, v.dataConfidence));
  });

  it('reads the hypothesis, not the diagnosis literal — proven by the legacy shape', () => {
    // A singular pre-picked diagnosis carries no observations, so the projector
    // floors its reasoning at 0.3 even though the rule literal says 0.85.
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: fatigued,
      diagnosis: { signalType: SIGNAL_TYPE.CREATIVE_FATIGUE, diagnosis: 'creative_fatigue', confidence: 0.85 },
    });
    expect(v.signalConfidence).toBe(0.3);
  });
});

// ── The branches that keep their own number ─────────────────────────────────
describe('evaluateVerdict — non-mechanism branches are NOT overwritten', () => {
  it('the awareness tier keeps 0.7 even with a 0.95 hypothesis on the node', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { ...fatigued, roas: null, revenueMeasured: false },
    });
    expect(v.verdict).toBe(VERDICT.REFRESH);
    expect(v.signalConfidence).toBe(0.7);
    // The hypotheses are still computed and attached — they just did not decide.
    expect(v.hypotheses[0].confidence.reasoning).toBe(0.95);
  });

  it('the critical-decline KILL keeps 0.9', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { ...fatigued, roas: 0.5 },
    });
    expect(v.verdict).toBe(VERDICT.KILL);
    expect(v.signalConfidence).toBe(0.9);
  });

  it('the funnel track keeps the funnel\'s own confidence', () => {
    // A measured post-click collapse: 50 landing-page views off 350 clicks.
    const actionMetrics = { lpv: 50, atc: 5, checkout: 1 };
    const metrics = { ...fatigued, frequency: 2.0 };
    const funnel = diagnoseFunnel({
      ctr: metrics.ctr, actionMetrics, clicks: metrics.clicks, objective: 'OUTCOME_SALES',
    });
    expect(funnel).not.toBeNull();

    const v = evaluateVerdict({
      level: 'CAMPAIGN', metrics, actionMetrics, objective: 'OUTCOME_SALES',
    });
    expect(v.verdict).toBe(VERDICT.WATCH);
    // A number derived from CTR and frequency must never end up attached to a
    // verdict decided by a broken checkout.
    expect(v.signalConfidence).toBe(funnel.confidence);
  });

  it('the healthy branch keeps its SCALE / HOLD tiers', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { roas: 4.0, frequency: 1.2, ctr: 3.0, revenueMeasured: true, impressions: 50_000, clicks: 1_500 },
    });
    expect(v.verdict).toBe(VERDICT.SCALE);
    expect(v.signalConfidence).toBe(0.8);
    expect(v.hypotheses).toEqual([]); // HEALTHY projects nothing
  });
});

// ── The gates ───────────────────────────────────────────────────────────────
describe('evaluateVerdict — the early gates are untouched', () => {
  it('the minimum-sample gate still states 1.0', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: { ...fatigued, impressions: 100 } });
    expect(v.signalConfidence).toBe(1.0);
    expect(v.hypotheses).toEqual([]);
  });

  it('the too-early gate still states 1.0', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued, daysRunning: 1 });
    expect(v.signalConfidence).toBe(1.0);
  });

  // Both gates return ABOVE the `const hypotheses` declaration. If finalise ever
  // reads those bindings from the enclosing scope instead of from `extra`, these
  // throw ReferenceError rather than failing an assertion.
  it('returns from both gates without touching the un-initialised bindings', () => {
    expect(() => evaluateVerdict({ level: 'CAMPAIGN', metrics: { ...fatigued, impressions: 1 } })).not.toThrow();
    expect(() => evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued, daysRunning: 0 })).not.toThrow();
  });
});

// ── source ──────────────────────────────────────────────────────────────────
describe('hypothesis.source — which pass produced this reasoning', () => {
  it('tags every hypothesis on the absolute path', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued });
    expect(v.hypotheses.length).toBeGreaterThan(0);
    expect(v.hypotheses.every((h) => h.source === 'absolute')).toBe(true);
  });

  it('has nothing to tag when the diagnosis is terminal', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { roas: 4.0, frequency: 1.2, ctr: 3.0, revenueMeasured: true, impressions: 50_000, clicks: 1_500 },
    });
    expect(v.hypotheses).toEqual([]);
  });
});

// ── signalConfidence through both allowlists ────────────────────────────────
describe('signalConfidence — the half that was never published', () => {
  const leaf = (id, over = {}) => ({
    id, level: 'CAMPAIGN', currency: 'USD',
    metrics: {
      spendMinor: 100_000, revenueMinor: 200_000, impressions: 50_000,
      clicks: 350, conversions: 0, frequency: 4.0, ...over,
    },
  });

  it('survives the rollupVerdicts allowlist', () => {
    const [node] = rollupVerdicts({ id: 'a', level: 'ACCOUNT', children: [leaf('c1')] }).children;
    expect(node.signalConfidence).toBeTypeOf('number');
    expect(Number.isFinite(node.signalConfidence)).toBe(true);
  });

  it('survives applyRelativeRanking by reference', () => {
    // Three awareness siblings, all HOLD, so the cohort ranks and two upgrade.
    const sib = (id, clicks) => ({
      id, level: 'CAMPAIGN', currency: 'USD',
      metrics: { spendMinor: 100_000, revenueMinor: 0, impressions: 50_000, clicks, conversions: 0, frequency: 2.0 },
    });
    const before = rollupVerdicts({
      id: 'a', level: 'ACCOUNT', children: [sib('lo', 250), sib('mid', 300), sib('hi', 350)],
    });
    const after = applyRelativeRanking(before);

    for (const b of before.children) {
      const a = after.children.find((c) => c.id === b.id);
      expect(a.signalConfidence).toBe(b.signalConfidence);
    }
    expect(after.children.find((c) => c.id === 'lo').verdict).toBe(VERDICT.KILL);
    // The reasoning that came with it is still the absolute pass's, and says so.
    expect(after.children.find((c) => c.id === 'lo').hypotheses.every((h) => h.source === 'absolute')).toBe(true);
  });
});

// ── The payload ─────────────────────────────────────────────────────────────
describe('getConnectorVerdicts — the published numbers', () => {
  beforeEach(() => vi.clearAllMocks());

  const row = (over = {}) => ({
    entityId: 'c1', name: 'Campaign', channel: 'META', objective: null,
    spendMinor: 100_000, revenueMinor: 200_000, impressions: 50_000, clicks: 350,
    conversions: 0, frequency: 4.0, currency: 'USD', ...over,
  });

  it('carries signalConfidence — null, never undefined, when absent', async () => {
    getConnectorCampaigns.mockResolvedValue([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].signalConfidence).toBeTypeOf('number');
  });

  // GOLDEN: the three numbers must multiply out, so a reader can decompose a
  // confidence instead of guessing which half was weak.
  //
  // SCOPED TO ABSOLUTE VERDICTS ON PURPOSE. relativeRanking recomposes
  // `confidence` from its own 0.6 while leaving `signalConfidence` as the
  // absolute pass's, so an upgraded row does NOT satisfy this. That is the
  // inconsistency PR#321 has to resolve; pinning the invariant here means the
  // day it is fixed, widening this test is the proof.
  it('confidence === signal × data, for every absolute verdict', async () => {
    getConnectorCampaigns.mockResolvedValue([
      row({ entityId: 'a' }),
      row({ entityId: 'b', frequency: 2.0, clicks: 1_500 }),
      row({ entityId: 'c', revenueMinor: 0, objective: 'OUTCOME_AWARENESS' }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    const absolute = verdicts.filter((v) => v.relativeRank == null);

    expect(absolute.length).toBeGreaterThan(0);
    for (const v of absolute) {
      expect(v.confidence).toBe(composeConfidence(v.signalConfidence, v.dataConfidence));
    }
  });

  it('publishes only counterfactuals that say something', async () => {
    getConnectorCampaigns.mockResolvedValue([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].counterfactuals.length).toBeGreaterThan(0);
    expect(verdicts[0].counterfactuals.every(isSubstantive)).toBe(true);
  });
});

// ── The guard itself ────────────────────────────────────────────────────────
describe('isSubstantive — an argument with no reason is not published', () => {
  it('rejects a counterfactual with both halves empty', () => {
    expect(isSubstantive({ rejectedBy: [], preferredBecause: [] })).toBe(false);
    expect(isSubstantive({})).toBe(false);
    expect(isSubstantive(null)).toBe(false);
  });

  it('keeps one with a contradiction', () => {
    expect(isSubstantive({ rejectedBy: [{ metric: 'CTR' }], preferredBecause: [] })).toBe(true);
  });

  it('keeps one with distinguishing evidence', () => {
    expect(isSubstantive({ rejectedBy: [], preferredBecause: [{ metric: 'FREQUENCY' }] })).toBe(true);
  });
});
