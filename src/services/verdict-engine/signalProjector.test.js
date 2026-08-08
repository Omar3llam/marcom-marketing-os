// ============================================================
// signalProjector — reasoning confidence and hypothesis projection
// ------------------------------------------------------------
// The failures pinned here all produce a confidently WRONG statement rather
// than an absent one:
//   1. a metric-name vocabulary mismatch (MECHANISM_SUPPORT holding lowercase
//      input-field names) — every lookup returns false, contradictions vanish
//      silently, and every hypothesis reports maximum confidence
//   2. a terminal state projected as a hypothesis ("we could not look",
//      rendered as a proposed explanation with a confidence attached)
//   3. an ungraded figure (SPEND, no benchmark) counted as supporting evidence
//   4. a `composed` key appearing before Stage 4 defines what it composes
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  projectHypotheses, deriveReasoningConfidence, isContradiction,
} from './signalProjector.js';
import { evaluateVerdict } from './verdictEngine.js';
import { diagnoseSignals } from '../diagnosis-engine/DiagnosisEngine.js';
import { SIGNAL_TYPE, DIAGNOSIS, MECHANISM_SUPPORT } from '../diagnosis-engine/diagnosisTypes.js';
import { SEVERITY } from './evidenceProvider.js';

/** A synthetic observation — the shape signalRules' obs() emits. */
const o = (metric, status, severity = null) => ({ metric, value: 1, benchmark: 1, status, severity });

/** A synthetic fired signal. */
const sig = (signalType, observations = []) => ({
  signalType,
  diagnosis:  DIAGNOSIS[signalType],
  confidence: 0.85,
  observations,
  evaluable:  true,
  fired:      true,
});

const derive = (observations, declined, signalType = SIGNAL_TYPE.CREATIVE_FATIGUE) =>
  deriveReasoningConfidence({ observations, declined, signalType });

/** Wrap loose observations as one declined rule. */
const declinedWith = (...observations) => [{ observations }];

// ── MECHANISM_SUPPORT ───────────────────────────────────────────────────────
describe('MECHANISM_SUPPORT — domain knowledge, in the taxonomy file', () => {
  it('names the metrics that evidence creative fatigue', () => {
    expect(MECHANISM_SUPPORT[SIGNAL_TYPE.CREATIVE_FATIGUE]).toEqual(['CTR', 'FREQUENCY']);
  });

  it('gives the terminal states no supporting metrics', () => {
    expect(MECHANISM_SUPPORT[SIGNAL_TYPE.HEALTHY]).toEqual([]);
    expect(MECHANISM_SUPPORT[SIGNAL_TYPE.UNDIAGNOSABLE]).toEqual([]);
  });

  it('covers every signal type — a new one must not silently get no map', () => {
    for (const t of Object.values(SIGNAL_TYPE)) {
      expect(Array.isArray(MECHANISM_SUPPORT[t])).toBe(true);
    }
  });

  // THE vocabulary guard. MECHANISM_SUPPORT holds observation metric names
  // ('CTR'), NOT signal-input field names ('ctr'). A lowercase entry matches no
  // observation the rules ever emit, so isContradiction returns false for
  // everything, contradicts is always empty, and every hypothesis scores 0.95 —
  // with nothing thrown and no test failing anywhere else.
  it('names only metrics the rules actually emit', () => {
    // Inputs chosen so all four rules are evaluable and fire.
    const dx = diagnoseSignals({
      frequency: 4.0, ctr: 0.7, cpcMinor: 300, spendMinor: 60_000, conversions: 2,
    });
    const emitted = new Set(
      [...dx.signals, ...dx.declined].flatMap((s) => s.observations).map((ob) => ob.metric),
    );
    const referenced = new Set(Object.values(MECHANISM_SUPPORT).flat());

    expect(referenced.size).toBeGreaterThan(0);
    for (const metric of referenced) expect(emitted).toContain(metric);
  });
});

// ── isContradiction ─────────────────────────────────────────────────────────
describe('isContradiction — only this mechanism\'s own metrics argue against it', () => {
  it('is true for a metric the mechanism is evidenced by', () => {
    expect(isContradiction('CTR', SIGNAL_TYPE.CREATIVE_FATIGUE)).toBe(true);
    expect(isContradiction('FREQUENCY', SIGNAL_TYPE.CREATIVE_FATIGUE)).toBe(true);
  });

  it('is false for a metric outside the mechanism', () => {
    // A healthy CPL says nothing about whether the creative is exhausted.
    expect(isContradiction('SPEND', SIGNAL_TYPE.CREATIVE_FATIGUE)).toBe(false);
    expect(isContradiction('CPL', SIGNAL_TYPE.CREATIVE_FATIGUE)).toBe(false);
  });

  it('is false for terminal states and for an unmapped signal type', () => {
    expect(isContradiction('CTR', SIGNAL_TYPE.HEALTHY)).toBe(false);
    expect(isContradiction('CTR', 'NOT_A_SIGNAL_TYPE')).toBe(false);
    expect(isContradiction('CTR', undefined)).toBe(false);
  });
});

// ── deriveReasoningConfidence ───────────────────────────────────────────────
describe('deriveReasoningConfidence — evidence convergence, not a frozen literal', () => {
  it('floors at 0.3 when nothing weak backs the signal', () => {
    expect(derive([o('CTR', 'healthy')], [])).toBe(0.3);
    expect(derive([], [])).toBe(0.3);
    // The legacy singular shape carries no observations at all.
    expect(derive(undefined, undefined)).toBe(0.3);
  });

  it('caps at 0.95 when every reading supports and nothing contradicts', () => {
    expect(derive([o('CTR', 'weak'), o('FREQUENCY', 'weak')], [])).toBe(0.95);
  });

  it('penalises a contradiction on a core metric', () => {
    const clean = derive([o('FREQUENCY', 'weak')], []);
    const contradicted = derive([o('FREQUENCY', 'weak')], declinedWith(o('CTR', 'healthy')));
    // 1/2 support ratio − 0.12 penalty = 0.38
    expect(contradicted).toBe(0.38);
    expect(contradicted).toBeLessThan(clean);
  });

  it('ignores a healthy reading on a metric outside the mechanism', () => {
    const peripheral = derive([o('FREQUENCY', 'weak')], declinedWith(o('CPL', 'healthy')));
    expect(peripheral).toBe(0.95);
  });

  it('rewards CRITICAL severity among the supporting readings', () => {
    const contra = declinedWith(o('CTR', 'healthy'));
    const critical = derive([o('FREQUENCY', 'weak', SEVERITY.CRITICAL)], contra);
    const medium   = derive([o('FREQUENCY', 'weak', SEVERITY.MEDIUM)],   contra);
    expect(critical).toBe(0.46); // 0.5 + 0.08 − 0.12
    expect(medium).toBe(0.38);   // 0.5 + 0.00 − 0.12
  });

  it('caps the severity bonus — three critical readings are not three findings', () => {
    const contra = declinedWith(o('CTR', 'healthy'), o('CTR', 'healthy'), o('CTR', 'healthy'));
    const twoCritical = derive(
      [o('FREQUENCY', 'weak', SEVERITY.CRITICAL), o('FREQUENCY', 'weak', SEVERITY.CRITICAL), o('FREQUENCY', 'weak', SEVERITY.MEDIUM)],
      contra,
    );
    const threeCritical = derive(
      [o('FREQUENCY', 'weak', SEVERITY.CRITICAL), o('FREQUENCY', 'weak', SEVERITY.CRITICAL), o('FREQUENCY', 'weak', SEVERITY.CRITICAL)],
      contra,
    );
    // Both bonuses (0.16 and 0.24) clamp to 0.15, so the two land on one number.
    expect(twoCritical).toBe(threeCritical);
    expect(threeCritical).toBe(0.29); // 0.5 + 0.15 − 0.36
  });

  it('stays inside 0.10–0.95 however the evidence piles up', () => {
    const many = declinedWith(...Array.from({ length: 8 }, () => o('CTR', 'healthy')));
    expect(derive([o('FREQUENCY', 'weak')], many)).toBe(0.1);
    expect(derive([o('FREQUENCY', 'weak', SEVERITY.CRITICAL), o('CTR', 'weak', SEVERITY.CRITICAL)], []))
      .toBe(0.95);
  });
});

// ── projectHypotheses: what is and is not a hypothesis ──────────────────────
describe('projectHypotheses — terminal states are answers, not candidates', () => {
  it('drops HEALTHY', () => {
    const dx = { signals: [sig(SIGNAL_TYPE.HEALTHY)], declined: [] };
    expect(projectHypotheses(dx)).toEqual([]);
  });

  it('drops UNDIAGNOSABLE — "we could not look" is not an explanation', () => {
    const dx = { signals: [sig(SIGNAL_TYPE.UNDIAGNOSABLE)], declined: [] };
    expect(projectHypotheses(dx)).toEqual([]);
  });

  it('returns [] for an absent or malformed envelope rather than throwing', () => {
    expect(projectHypotheses(null)).toEqual([]);
    expect(projectHypotheses(undefined)).toEqual([]);
    expect(projectHypotheses({})).toEqual([]);
  });

  it('accepts the legacy singular signal shape instead of silently returning []', () => {
    const singular = { signalType: SIGNAL_TYPE.LOW_CTR, diagnosis: DIAGNOSIS.LOW_CTR, confidence: 0.7 };
    const out = projectHypotheses(singular);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(SIGNAL_TYPE.LOW_CTR);
    // No observations to show for it — the floor, not a well-evidenced score.
    expect(out[0].confidence.reasoning).toBe(0.3);
  });
});

// ── projectHypotheses: shape ────────────────────────────────────────────────
describe('projectHypotheses — the hypothesis shape', () => {
  const dx = {
    signals: [sig(SIGNAL_TYPE.CREATIVE_FATIGUE, [
      { metric: 'FREQUENCY', value: 4.0, benchmark: 3.5, status: 'weak',    severity: SEVERITY.MEDIUM,  currency: null },
      { metric: 'CTR',       value: 0.7, benchmark: 1.5, status: 'weak',    severity: SEVERITY.HIGH,    currency: null },
      { metric: 'SPEND',     value: 100, benchmark: null, status: null,     severity: null,             currency: 'EGP' },
    ])],
    declined: [{
      signalType: SIGNAL_TYPE.LOW_CTR,
      observations: [{ metric: 'CTR', value: 1.0, benchmark: 0.8, status: 'healthy', severity: SEVERITY.HEALTHY, currency: null }],
    }],
  };

  it('keys on enum values, never on rendered prose', () => {
    const [h] = projectHypotheses(dx);
    expect(h.id).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(h.labelKey).toBe(DIAGNOSIS.CREATIVE_FATIGUE);
  });

  it('states only the weak readings as observed, and drops the ungraded one', () => {
    const [h] = projectHypotheses(dx);
    expect(h.observed.map((x) => x.metric)).toEqual(['FREQUENCY', 'CTR']);
    // SPEND has no benchmark, so it was never graded — claiming it as support
    // would accuse it of failing a bar nobody set.
    expect(h.observed.map((x) => x.metric)).not.toContain('SPEND');
    expect(h.observed[0]).toEqual({ metric: 'FREQUENCY', value: 4.0, benchmark: 3.5, severity: SEVERITY.MEDIUM });
  });

  it('lists supports as metric names drawn from observed', () => {
    const [h] = projectHypotheses(dx);
    expect(h.supports).toEqual(h.observed.map((x) => x.metric));
    expect(h.supports).toEqual(['FREQUENCY', 'CTR']);
  });

  it('carries the declined rule\'s healthy reading as a contradiction', () => {
    const [h] = projectHypotheses(dx);
    expect(h.contradicts).toEqual([
      { metric: 'CTR', value: 1.0, benchmark: 0.8, severity: SEVERITY.HEALTHY },
    ]);
  });

  it('excludes a declined healthy reading on a peripheral metric', () => {
    const peripheral = {
      ...dx,
      declined: [{
        signalType: SIGNAL_TYPE.INEFFICIENT_SCALING,
        observations: [{ metric: 'CPL', value: 100, benchmark: 5000, status: 'healthy', severity: SEVERITY.HEALTHY }],
      }],
    };
    expect(projectHypotheses(peripheral)[0].contradicts).toEqual([]);
  });

  it('reports the reasoning confidence deriveReasoningConfidence computes', () => {
    const [h] = projectHypotheses(dx);
    expect(h.confidence.reasoning).toBe(deriveReasoningConfidence({
      observations: dx.signals[0].observations,
      declined:     dx.declined,
      signalType:   SIGNAL_TYPE.CREATIVE_FATIGUE,
    }));
    expect(h.confidence.reasoning).toBe(0.55); // 2/3 − 0.12
  });

  it('passes dataConfidence through untouched, and defaults to null not 0.5', () => {
    expect(projectHypotheses(dx, 0.42)[0].confidence.data).toBe(0.42);
    // null is "we were never given the sample size". 0.5 would be a fabricated
    // middle that reads like a measurement.
    expect(projectHypotheses(dx)[0].confidence.data).toBeNull();
    expect(projectHypotheses(dx, null)[0].confidence.data).toBeNull();
  });

  it('carries NO composed key — Stage 4 owns that', () => {
    const [h] = projectHypotheses(dx);
    expect(Object.keys(h.confidence)).toEqual(['reasoning', 'data']);
    expect(h.confidence).not.toHaveProperty('composed');
  });
});

// ── Integration with the diagnosis engine ───────────────────────────────────
describe('projectHypotheses — over real diagnoseSignals output', () => {
  it('projects every fired mechanism, in the engine\'s ranked order', () => {
    const dx = diagnoseSignals({ frequency: 4.0, ctr: 0.7 });
    expect(dx.signals.map((s) => s.signalType))
      .toEqual([SIGNAL_TYPE.CREATIVE_FATIGUE, SIGNAL_TYPE.LOW_CTR]);

    const out = projectHypotheses(dx, 0.8);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(out[0].supports).toEqual(expect.arrayContaining(['FREQUENCY', 'CTR']));
    // Nothing declined — the other two rules were never evaluable.
    expect(out[0].contradicts).toEqual([]);
  });

  it('finds a real contradiction when a CTR-sharing rule declines', () => {
    // CTR 1.0 is under the 1.5 "still performing" bar (so fatigue fires) but
    // over the 0.8 weak floor (so LOW_CTR declines, leaving a healthy CTR).
    const dx = diagnoseSignals({ frequency: 4.0, ctr: 1.0 });
    expect(dx.signals.map((s) => s.signalType)).toEqual([SIGNAL_TYPE.CREATIVE_FATIGUE]);
    expect(dx.declined.map((s) => s.signalType)).toEqual([SIGNAL_TYPE.LOW_CTR]);

    const [h] = projectHypotheses(dx);
    expect(h.contradicts.map((c) => c.metric)).toEqual(['CTR']);
    expect(h.confidence.reasoning).toBe(0.55);
  });

  it('leaves a peripheral declined rule out of the contradictions', () => {
    // INEFFICIENT_SCALING declines on a healthy CPL; that is not evidence about
    // the creative.
    const dx = diagnoseSignals({ frequency: 4.0, ctr: 0.7, spendMinor: 10_000, conversions: 10 });
    expect(dx.declined.map((s) => s.signalType)).toEqual([SIGNAL_TYPE.INEFFICIENT_SCALING]);
    expect(projectHypotheses(dx)[0].contradicts).toEqual([]);
  });

  it('projects nothing from a healthy diagnosis', () => {
    const dx = diagnoseSignals({ frequency: 1.2, ctr: 3.0 });
    expect(dx.signals[0].signalType).toBe(SIGNAL_TYPE.HEALTHY);
    expect(projectHypotheses(dx)).toEqual([]);
  });
});

// ── Integration with the verdict engine ─────────────────────────────────────
describe('evaluateVerdict — hypotheses ride on the verdict', () => {
  const metrics = {
    roas: 2.0, frequency: 4.0, ctr: 0.7, revenueMeasured: true,
    impressions: 50_000, clicks: 350,
  };

  it('attaches one hypothesis per fired mechanism', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics });
    expect(v.hypotheses.map((h) => h.id))
      .toEqual([SIGNAL_TYPE.CREATIVE_FATIGUE, SIGNAL_TYPE.LOW_CTR]);
    expect(v.hypotheses[0].confidence.data).toBe(v.dataConfidence);
  });

  it('supplies the verdict\'s signal half on the mechanism track', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics });
    // Was the rule's frozen 0.85 until the derived number was wired in; the
    // branch-by-branch scope of that wiring lives in decisionEngine.test.js.
    expect(v.hypotheses[0].confidence.reasoning).toBe(0.95);
    expect(v.signalConfidence).toBe(v.hypotheses[0].confidence.reasoning);
  });

  it('returns [] from the early gates, where no rule has run', () => {
    const thin = evaluateVerdict({ level: 'CAMPAIGN', metrics: { ...metrics, impressions: 100 } });
    expect(thin.hypotheses).toEqual([]);
    const early = evaluateVerdict({ level: 'CAMPAIGN', metrics, daysRunning: 1 });
    expect(early.hypotheses).toEqual([]);
  });
});

// ── The doc block, as a test ─────────────────────────────────
// Fourth occurrence of one defect: a PR inverts a property and leaves the
// comment that described the old one. Here the comment said this number was
// "not wired into the verdict's confidence yet" for the whole life of PR#319,
// which wired it — so the file's own documentation argued against reading the
// field two hops of UI were about to be built on.
//
// A comment is not usually worth a test. This one is: it is load-bearing (it
// tells a reader whether signalConfidence means anything), it is invisible to
// every other gate in the repo, and it has now been wrong once.
describe('the reasoning-confidence doc block tells the truth', () => {
  const src = readFileSync(
    new URL('./signalProjector.js', import.meta.url), 'utf8',
  );

  it('no longer claims the number is unwired', () => {
    expect(src).not.toMatch(/Not wired into the verdict/i);
  });

  it('says where it IS wired', () => {
    expect(src).toMatch(/Wired into verdictEngine/);
  });

  // The two fields it produces are the same number on one track only, and the
  // difference is the whole reason the UI needs an honesty gate.
  it('names both fields that carry it, and that they can disagree', () => {
    expect(src).toMatch(/verdict\.signalConfidence/);
    expect(src).toMatch(/hypothesis\.confidence\.reasoning/);
    expect(src).toMatch(/RE-STAMPED by a relative upgrade/);
  });
});
