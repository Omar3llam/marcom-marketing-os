import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';
import {
  accuracySurface, COVERAGE_VERDICT, LIFT_STATUS, CALIBRATION_DIRECTION, DEFAULT_CONFIG,
  SCORABLE_VERDICT, SUCCESS_PREDICATES,
} from './accuracyTypes.js';

const NOW = new Date('2026-03-01T00:00:00.000Z');
const day = (d) => 24 * 60 * 60 * 1000 * d;

// A SCORED decision via REALLOCATE (predicate = roasDelta >= 0): success → +roas,
// failure → −roas. windowEnd in the past + sustained known ⇒ maturity = SCORED.
function scored(id, { confidence, success, at }) {
  return {
    id,
    verdict: 'REALLOCATE',
    confidence,
    status: 'EXECUTED',
    createdAt: at,
    outcome: {
      roasDelta: success ? 0.1 : -0.1,
      spendDeltaMinor: success ? 1000 : -1000,
      revenueDeltaMinor: 0,
      sustained: true,
      windowEnd: new Date(NOW.getTime() - day(1)).toISOString(),
    },
  };
}

// 120 scored: first 60 in Jan (confidence 0.9, all wrong → ECE 0.9),
// last 60 in Feb (confidence 0.9, all right → ECE 0.1). A clean improving curve.
function bigSet() {
  const out = [];
  for (let i = 0; i < 60; i += 1) {
    out.push(scored(`a${i}`, { confidence: 0.9, success: false, at: new Date(`2026-01-10T00:00:00Z`).getTime() + i * 1000 }));
  }
  for (let i = 0; i < 60; i += 1) {
    out.push(scored(`b${i}`, { confidence: 0.9, success: true, at: new Date(`2026-02-10T00:00:00Z`).getTime() + i * 1000 }));
  }
  return out.map((d) => ({ ...d, createdAt: new Date(d.createdAt).toISOString() }));
}

describe('decisionAccuracyEngine — determinism', () => {
  it('same input + injected now → byte-identical output', () => {
    const decisions = bigSet();
    const a = calculateDecisionAccuracy({ decisions, now: NOW });
    const b = calculateDecisionAccuracy({ decisions, now: NOW });
    expect(a).toEqual(b);
  });
});

describe('decisionAccuracyEngine — per-verdict success predicates (§2.1)', () => {
  const mature = (extra) => ({ windowEnd: new Date(NOW.getTime() - day(1)).toISOString(), sustained: true, ...extra });

  it('a correct KILL (spend fell, sustained) scores SUCCESS, not failure', () => {
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [{ id: 'k', verdict: 'KILL', confidence: 0.8, status: 'EXECUTED', createdAt: new Date(NOW.getTime() - day(20)).toISOString(), outcome: mature({ spendDeltaMinor: -5000, revenueDeltaMinor: -2000 }) }],
    });
    expect(r.coverage.scored).toBe(1);
    expect(r.calibration.accuracy).toBe(1); // observed success rate = 1, NOT scored as a failure
  });

  it('a SCALE that did not hold (sustained:false) scores FAILURE', () => {
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [{ id: 's', verdict: 'SCALE', confidence: 0.8, status: 'EXECUTED', createdAt: new Date(NOW.getTime() - day(20)).toISOString(), outcome: { windowEnd: new Date(NOW.getTime() - day(1)).toISOString(), sustained: false, roasDelta: 0.5 } }],
    });
    expect(r.coverage.scored).toBe(1);
    expect(r.calibration.accuracy).toBe(0);
  });

  it('a WATCH is excluded from accuracy entirely (not a prediction)', () => {
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [{ id: 'w', verdict: 'WATCH', confidence: 0.5, status: 'EXECUTED', createdAt: new Date(NOW.getTime() - day(20)).toISOString(), outcome: mature({ roasDelta: 0.1 }) }],
    });
    expect(r.coverage.scored).toBe(0);
    expect(r.coverage.notAPrediction).toBe(1);
  });
});

// ── The HOLD prediction contract ────────────────────────────────────────────
// HOLD asks for no intervention but DOES make a falsifiable claim — "this is
// stable, leave it" — so it is scored here while decisionLifecycle answers
// UNKNOWN for it. Two systems, two questions: was the CALL right (here) vs did
// ACTING help (there). HOLD has an answer only to the first.
//
// The predicate had no test of any kind before this. It could have been deleted,
// inverted, or had holdTolerance set to 100 and nothing would have gone red —
// which matters more than usual because no HOLD can currently reach this
// population at all (the UI gives HOLD no way to obtain executedAt), so a break
// would be invisible in production too.
//
// The tolerance is read from DEFAULT_CONFIG rather than written as 0.1: a test
// that restates the constant proves only that two literals agree today.
describe('decisionAccuracyEngine — HOLD is a prediction of stability (§2.1)', () => {
  const TOL = DEFAULT_CONFIG.holdTolerance;
  const holdWith = (roasDelta) => ({
    id: 'h',
    verdict: 'HOLD',
    confidence: 0.8,
    status: 'EXECUTED',
    createdAt: new Date(NOW.getTime() - day(20)).toISOString(),
    outcome: {
      windowEnd: new Date(NOW.getTime() - day(1)).toISOString(),
      sustained: true,
      ...(roasDelta === undefined ? {} : { roasDelta }),
    },
  });
  const run = (roasDelta) => calculateDecisionAccuracy({ now: NOW, decisions: [holdWith(roasDelta)] });

  // Scored on MAGNITUDE, not direction. A big move either way means "leave it
  // alone" was the wrong call — an upside surprise is a missed SCALE, not a win.
  it.each([
    [+0.05, true],
    [-0.05, true],
    [+0.50, false],
    [-0.50, false],
  ])('roasDelta %s → %s (inside/outside the tolerance band)', (roasDelta, shouldSucceed) => {
    expect(Math.abs(roasDelta) <= TOL).toBe(shouldSucceed); // the band, restated as the premise
    const r = run(roasDelta);
    expect(r.coverage.scored).toBe(1);
    expect(r.coverage.unscorable).toBe(0);
    expect(r.calibration.accuracy).toBe(shouldSucceed ? 1 : 0);
  });

  // The honesty line. A missing roasDelta is NOT a failed HOLD — it is a decision
  // we cannot score, and scoring it as wrong would manufacture failures out of a
  // data gap. UNSCORABLE keeps it out of BOTH the numerator and the denominator.
  it.each([
    ['null',      null],
    ['absent',    undefined],
  ])('a %s roasDelta is UNSCORABLE, never a failure', (_label, roasDelta) => {
    const r = run(roasDelta);
    expect(r.coverage.scored).toBe(0);
    expect(r.coverage.unscorable).toBe(1);
    expect(r.coverage.notAPrediction).toBe(0); // it IS a prediction — just unmeasured
  });

  // The exact edge, derived from the configured band so it tracks a change to it.
  it('the boundary is inclusive — a move of exactly the tolerance still holds', () => {
    expect(run(TOL).calibration.accuracy).toBe(1);
    expect(run(TOL * 1.001).calibration.accuracy).toBe(0);
  });
});

// ── HOLD vs WATCH: the distinction is deliberate ────────────────────────────
// Both are non-executable, and the temptation is to treat them alike. They
// differ on whether a claim was made at all, which is the only axis that
// decides scorability. This is written as a contract test rather than a comment
// because "make these two consistent" is a plausible-sounding future change that
// would silently delete a real measurement.
describe('SCORABLE_VERDICT — HOLD predicts, WATCH declines to', () => {
  it('HOLD is scorable and WATCH is not', () => {
    expect(SCORABLE_VERDICT.HOLD).toBe(true);
    expect(SCORABLE_VERDICT.WATCH).toBe(false);
  });

  it('WATCH has no success predicate — it returns null for any outcome', () => {
    expect(SUCCESS_PREDICATES.WATCH({ roasDelta: 0 }, DEFAULT_CONFIG)).toBeNull();
    expect(SUCCESS_PREDICATES.WATCH({ roasDelta: 5 }, DEFAULT_CONFIG)).toBeNull();
  });

  // The same outcome, the same maturity, the same everything except the verdict
  // — and the two land in DIFFERENT coverage buckets. That is the distinction,
  // stated as behaviour rather than as an enum lookup.
  it('identical outcomes land in different buckets: HOLD scored, WATCH not-a-prediction', () => {
    const base = {
      confidence: 0.8,
      status: 'EXECUTED',
      createdAt: new Date(NOW.getTime() - day(20)).toISOString(),
      outcome: { windowEnd: new Date(NOW.getTime() - day(1)).toISOString(), sustained: true, roasDelta: 0.01 },
    };
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [{ id: 'h', verdict: 'HOLD', ...base }, { id: 'w', verdict: 'WATCH', ...base }],
    });
    expect(r.coverage.scored).toBe(1);          // the HOLD
    expect(r.coverage.notAPrediction).toBe(1);  // the WATCH
  });

  it('every verdict the engine emits has an explicit entry — no silent default', () => {
    expect(Object.keys(SCORABLE_VERDICT).sort()).toEqual(
      ['HOLD', 'KILL', 'REALLOCATE', 'REFRESH', 'SCALE', 'WATCH'],
    );
    for (const v of Object.keys(SCORABLE_VERDICT)) {
      expect(SUCCESS_PREDICATES[v], `${v} has no success predicate`).toBeTypeOf('function');
    }
  });
});

describe('decisionAccuracyEngine — maturity (§2.2)', () => {
  it('a 3-day-old decision with sustained:null + open window is PENDING — absent from every numerator/denominator', () => {
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [{ id: 'p', verdict: 'KILL', confidence: 0.9, status: 'EXECUTED', createdAt: new Date(NOW.getTime() - day(3)).toISOString(), outcome: { windowEnd: new Date(NOW.getTime() + day(4)).toISOString(), sustained: null, spendDeltaMinor: -1000 } }],
    });
    expect(r.coverage.pendingMaturation).toBe(1);
    expect(r.coverage.scored).toBe(0);
    expect(r.coverage.unscorable).toBe(0);
    expect(r.coverage.scoredFraction).toBe(0); // denominator excludes pending
    expect(r.calibration.sampleSize).toBe(0);  // moves neither ECE nor sample size
  });

  it('an executed decision past the deadline with no outcome is UNSCORABLE (a data-quality gap)', () => {
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [{ id: 'u', verdict: 'KILL', confidence: 0.9, status: 'EXECUTED', createdAt: new Date(NOW.getTime() - day(30)).toISOString(), outcome: null }],
    });
    expect(r.coverage.unscorable).toBe(1);
    expect(r.coverage.scored).toBe(0);
  });
});

// The outcome window opens when the operator ACTED, not when the engine issued
// the call. Measuring from issuance charges the result for however long a verdict
// sat unread in a queue — a call acted on three weeks late would read as mature
// while its intervention is three days old.
describe('decisionAccuracyEngine — the outcome window opens at execution', () => {
  // Issued 30 days ago (long past the 7-day deadline), acted on 3 days ago.
  const lateAction = (over = {}) => ({
    id: 'late', verdict: 'KILL', confidence: 0.9, status: 'EXECUTED',
    createdAt: new Date(NOW.getTime() - day(30)).toISOString(),
    executedAt: new Date(NOW.getTime() - day(3)).toISOString(),
    outcome: null, ...over,
  });

  it('a decision acted on 3 days ago is PENDING, not UNSCORABLE, however old the verdict is', () => {
    const r = calculateDecisionAccuracy({ now: NOW, decisions: [lateAction()] });
    expect(r.coverage.pendingMaturation).toBe(1);
    // Measured from createdAt this is 30 days old and would be written off as a
    // data-quality gap — for a window that has barely opened.
    expect(r.coverage.unscorable).toBe(0);
  });

  it('the same row without executedAt IS unscorable — the fallback is the legacy path', () => {
    const legacy = lateAction();
    delete legacy.executedAt; // a row written before the human-signal routes existed
    const r = calculateDecisionAccuracy({ now: NOW, decisions: [legacy] });
    expect(r.coverage.unscorable).toBe(1);
    expect(r.coverage.pendingMaturation).toBe(0);
  });

  it('an executedAt past the deadline still matures', () => {
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [lateAction({ executedAt: new Date(NOW.getTime() - day(10)).toISOString() })],
    });
    expect(r.coverage.unscorable).toBe(1);
  });

  it('a null executedAt falls back rather than throwing on new Date(null)', () => {
    // new Date(null) is the epoch, not Invalid Date — it would silently mature
    // every row instead of failing loudly. `?? createdAt` has to catch null too.
    const r = calculateDecisionAccuracy({ now: NOW, decisions: [lateAction({ executedAt: null })] });
    expect(r.coverage.unscorable).toBe(1);
  });

  // The velocity curve bins by createdAt ON PURPOSE: that axis is "when did the
  // engine make calls", and re-anchoring it to execution would reorder the
  // learning curve by how fast the operator happened to respond.
  it('does NOT re-anchor the velocity curve to executedAt', () => {
    const janIssued = Array.from({ length: 60 }, (_, i) => ({
      ...scored(`j${i}`, { confidence: 0.9, success: false, at: new Date('2026-01-10T00:00:00Z').getTime() + i * 1000 }),
      // Acted on in February — a month after issuance.
      executedAt: new Date('2026-02-20T00:00:00Z').toISOString(),
    }));
    const r = calculateDecisionAccuracy({ now: NOW, decisions: janIssued });
    // One period, and it is the ISSUANCE month.
    expect(r.velocity.periods.map((p) => p.label)).toEqual(['2026-01']);
  });
});

describe('decisionAccuracyEngine — calibration is the headline, gated', () => {
  it('reports ECE + Brier; lift returns INSUFFICIENT_DATA below minSample', () => {
    const decisions = Array.from({ length: 10 }, (_, i) => scored(`x${i}`, { confidence: 0.7, success: i % 2 === 0, at: new Date('2026-02-10T00:00:00Z').getTime() + i * 1000 }))
      .map((d) => ({ ...d, createdAt: new Date(d.createdAt).toISOString() }));
    const r = calculateDecisionAccuracy({ decisions, now: NOW });
    expect(typeof r.calibration.expectedCalibrationError).toBe('number');
    expect(typeof r.calibration.brierScore).toBe('number');
    expect(r.accountLift.status).toBe(LIFT_STATUS.INSUFFICIENT_DATA); // never an ungated %
    expect(r.accountLift.calibrationImprovementPct).toBeNull();
  });

  it('over a full account, lift is IMPROVING and direction is OVERCONFIDENT', () => {
    const r = calculateDecisionAccuracy({ decisions: bigSet(), now: NOW });
    expect(r.coverage.verdict).toBe(COVERAGE_VERDICT.RELIABLE);
    expect(r.accountLift.status).toBe(LIFT_STATUS.IMPROVING);
    expect(r.accountLift.earlyWindow.calibrationError).toBeGreaterThan(r.accountLift.recentWindow.calibrationError);
    expect(r.calibration.direction).toBe(CALIBRATION_DIRECTION.OVERCONFIDENT);
  });
});

describe('decisionAccuracyEngine — learning velocity (the flagship curve)', () => {
  it('declining ECE across months → trend IMPROVING with a negative slope', () => {
    const r = calculateDecisionAccuracy({ decisions: bigSet(), now: NOW });
    expect(r.velocity.periods.length).toBeGreaterThanOrEqual(2);
    expect(r.velocity.trend).toBe(LIFT_STATUS.IMPROVING);
    expect(r.velocity.slope).toBeLessThan(0);
  });
});

describe('decisionAccuracyEngine — reliability bins never shown too small (§3)', () => {
  it('collapses bins so no non-empty bin is below minBinCount', () => {
    // 50 at conf≈0.1 (one bin) + 5 at conf 0.85 (a thin bin) ⇒ deciles fail, collapse.
    const decisions = [
      ...Array.from({ length: 50 }, (_, i) => scored(`lo${i}`, { confidence: 0.1, success: i % 2 === 0, at: new Date('2026-02-01T00:00:00Z').getTime() + i * 1000 })),
      ...Array.from({ length: 5 }, (_, i) => scored(`hi${i}`, { confidence: 0.85, success: true, at: new Date('2026-02-02T00:00:00Z').getTime() + i * 1000 })),
    ].map((d) => ({ ...d, createdAt: new Date(d.createdAt).toISOString() }));
    const r = calculateDecisionAccuracy({ decisions, now: NOW });
    for (const b of r.calibration.bins) {
      expect(b.count === 0 || b.count >= DEFAULT_CONFIG.minBinCount).toBe(true);
    }
  });
});

describe('accuracySurface — the §6 hard gate (highest-stakes line)', () => {
  it('SUPPRESSES every calibration number when coverage.verdict is THIN', () => {
    const surface = accuracySurface({
      coverage: { verdict: COVERAGE_VERDICT.THIN, scored: 12 },
      accountLift: { recentWindow: { calibrationError: 0.09 }, earlyWindow: { calibrationError: 0.18 }, calibrationImprovementPct: 0.5, status: LIFT_STATUS.IMPROVING },
    });
    expect(surface.gated).toBe(true);
    expect(surface.calibrationErrorPct).toBeNull();
    expect(surface.improvementPct).toBeNull();
    expect(surface.status).toBeNull();
    expect(surface.headline).not.toMatch(/calibration error/i);
    expect(surface.headline).toMatch(/still learning/i);
  });

  it('emits the calibration claim only when RELIABLE', () => {
    const r = calculateDecisionAccuracy({ decisions: bigSet(), now: NOW });
    const surface = accuracySurface(r);
    expect(surface.gated).toBe(false);
    expect(typeof surface.calibrationErrorPct).toBe('number');
    expect(surface.headline).toMatch(/calibration error/i);
  });
});

describe('decisionAccuracyEngine — boundary (§2.4): no report-confidence leak', () => {
  it('the decision-accuracy module never imports narrativeTypes', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // Assert no IMPORT of the report-confidence module (comments may name the
    // boundary; an actual `from '…narrative…'` import is what must never exist).
    const importFrom = /\bfrom\s+['"][^'"]*narrative[^'"]*['"]/i;
    for (const f of ['accuracyTypes.js', 'decisionAccuracyEngine.js', 'DecisionAccuracyService.js', 'index.js']) {
      const src = readFileSync(join(here, f), 'utf8');
      expect(importFrom.test(src)).toBe(false);
    }
  });
});
