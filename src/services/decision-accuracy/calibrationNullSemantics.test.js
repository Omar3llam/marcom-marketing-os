// ============================================================
// R13-C — null is not zero, and 0% ECE is the strongest claim there is
// ============================================================
// Expected Calibration Error is a distance from perfect. 0 means Lumi's stated
// confidence matched reality exactly. So `?? 0` on an unmeasurable window did
// not degrade gracefully — it emitted the BEST possible number for an account
// nothing had been measured on, on Home and on Proof.
//
// The gap that made it reachable was two thresholds that nobody had lined up:
//
//   coverage.verdict === RELIABLE     needs  minSample      scored decisions
//   computeAccountLift emits windows  needs  minSample * 2
//
// Between them, the surface was un-gated (RELIABLE) while both lift windows were
// null. accuracySurface read them with `?? 0` and produced:
//
//   "Lumi's calls on this account: calibration error 0% (was 0% in your first
//    window) — holding steady"
//
// …one branch after the gated path had deliberately suppressed calibrationErrorPct
// to null. This file pins that the two questions now have two answers.
// ============================================================
import { describe, it, expect } from 'vitest';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';
import { accuracySurface, DEFAULT_CONFIG, COVERAGE_VERDICT, LIFT_STATUS } from './accuracyTypes.js';

const DAY = 86_400_000;
const T0 = new Date('2026-01-01T00:00:00Z').getTime();

/**
 * A decision that IS scorable. Every clause is load-bearing:
 *   status EXECUTED  — PROPOSED is not a realized prediction
 *   verdict KILL     — in SCORABLE_VERDICT; its predicate reads spendDeltaMinor
 *   windowEnd past   — otherwise PENDING_MATURATION, never scored
 *   spendDeltaMinor  — the field the predicate needs; absent ⇒ UNSCORABLE
 */
const scorable = (i, { confidence = 0.8, success = true } = {}) => ({
  id: `d${i}`,
  status: 'EXECUTED',
  verdict: 'KILL',
  confidence,
  createdAt: new Date(T0 + i * DAY),
  outcome: {
    windowEnd: new Date(T0 + i * DAY + DAY),
    sustained: true,
    spendDeltaMinor: success ? -1000 : 1000,
  },
});

const surfaceFor = (decisions, now) =>
  accuracySurface(calculateDecisionAccuracy({ decisions, now }));

describe('the RELIABLE-but-no-lift gap', () => {
  // minSample scored → RELIABLE. minSample * 2 → lift windows. Sit between them.
  const n = DEFAULT_CONFIG.minSample + 1;
  const decisions = Array.from({ length: n }, (_, i) => scorable(i));
  const now = new Date(T0 + (n + 5) * DAY);

  it('is genuinely reachable — coverage RELIABLE while both lift windows are null', () => {
    // If this stops holding the tests below become vacuous, so it is asserted
    // rather than assumed.
    const result = calculateDecisionAccuracy({ decisions, now });
    expect(result.coverage.verdict).toBe(COVERAGE_VERDICT.RELIABLE);
    expect(result.accountLift.recentWindow).toBeNull();
    expect(result.accountLift.earlyWindow).toBeNull();
  });

  it('emits NO calibration number rather than 0%', () => {
    const s = surfaceFor(decisions, now);
    expect(s.calibrationErrorPct).toBeNull();
    expect(s.improvementPct).toBeNull();
  });

  it('never says 0% in the headline, and never claims a trend', () => {
    const s = surfaceFor(decisions, now);
    expect(s.headline).not.toMatch(/0%/);
    // No stated calibration figure, and no trend verdict in the claim position
    // (the trailing "— <verb>"). The word "improving" may appear inside the
    // REFUSAL — "not enough history yet to measure whether calibration is
    // improving" — which is the opposite of a claim about it.
    expect(s.headline).not.toMatch(/calibration error\s*\d/i);
    expect(s.headline).not.toMatch(/—\s*(holding steady|improving|degrading)\s*$/);
    expect(s.headline).toMatch(/not enough history yet/i);
    expect(s.status).toBe(LIFT_STATUS.INSUFFICIENT_DATA);
  });

  it('still reports the real scored count — the account IS being scored', () => {
    const s = surfaceFor(decisions, now);
    expect(s.gated).toBe(false);
    expect(s.scored).toBe(n);
    expect(s.needed).toBe(DEFAULT_CONFIG.minSample);
  });
});

describe('a count we do not have is not a count of zero', () => {
  it('omits the number instead of asserting "0 decisions scored"', () => {
    // No result at all — the caller had nothing. "0 scored" is a measurement.
    const s = accuracySurface(null);
    expect(s.gated).toBe(true);
    expect(s.scored).toBeNull();
    expect(s.headline).not.toMatch(/\b0\b/);
  });

  it('reports a REAL zero when the engine actually counted zero', () => {
    const s = accuracySurface(calculateDecisionAccuracy({ decisions: [] }));
    expect(s.scored).toBe(0);
    expect(s.headline).toMatch(/0 decisions scored/);
  });
});

// ============================================================
// The other two `?? 0` sites — and the honest status of their fix
// ------------------------------------------------------------
// windowStats and the velocity period map also coerced a null ECE to 0. Unlike
// accuracySurface above, NEITHER IS REACHABLE TODAY: computeCalibration returns
// a null ECE on exactly one path — an empty input — and both call sites are
// only ever handed a non-empty slice. Changing them to `?? null` removed a
// LATENT fabrication, not a live one.
//
// A test cannot exercise an unreachable branch, so this block pins the
// PRECONDITION that makes it unreachable instead — the same idiom the codebase
// already uses for the orphaned client verdict mappers. If a future change gives
// computeCalibration a second null path (a bin ladder that collapses, a
// predicate that scores nothing in-window), these fail here rather than shipping
// a perfect score to a screen.
// ============================================================
describe('window statistics carry null, not a perfect score', () => {
  it('a non-empty scored set ALWAYS yields a real ECE — the only null path is emptiness', () => {
    // This is the precondition. While it holds, `?? 0` at those two sites could
    // never have fired; when it stops holding, `?? null` is what stands between
    // an unmeasurable window and a claim of perfect calibration.
    for (const n of [1, 2, DEFAULT_CONFIG.minSample, DEFAULT_CONFIG.minSample * 2 + 3]) {
      const decisions = Array.from({ length: n }, (_, i) => scorable(i, { success: i % 3 !== 0 }));
      const { calibration } = calculateDecisionAccuracy({
        decisions, now: new Date(T0 + (n + 5) * DAY),
      });
      expect(calibration.sampleSize).toBe(n);
      expect(calibration.expectedCalibrationError).not.toBeNull();
      expect(typeof calibration.expectedCalibrationError).toBe('number');
    }
  });

  it('an EMPTY scored set yields null, never 0 — the branch the guards exist for', () => {
    const { calibration } = calculateDecisionAccuracy({ decisions: [], now: new Date(T0) });
    expect(calibration.sampleSize).toBe(0);
    expect(calibration.expectedCalibrationError).toBeNull();
    expect(calibration.accuracy).toBeNull();
    expect(calibration.brierScore).toBeNull();
  });

  it('every velocity period carries a real number or an explicit null — never both meanings', () => {
    const n = DEFAULT_CONFIG.minSample * 2;
    const decisions = [
      ...Array.from({ length: n }, (_, i) => scorable(i, { success: i % 4 !== 0 })),
      { id: 'x', status: 'EXECUTED', verdict: 'KILL', confidence: 0.9, createdAt: new Date(T0 + 400 * DAY), outcome: null },
    ];
    const { velocity } = calculateDecisionAccuracy({ decisions, now: new Date(T0 + 500 * DAY) });
    expect(velocity.periods.length).toBeGreaterThan(0);
    for (const p of velocity.periods) {
      expect(p.sampleSize).toBeGreaterThan(0);           // no empty period is emitted…
      expect(p.calibrationError).not.toBeNull();         // …so none can be unmeasurable today
    }
    // The slope is fitted only over periods that produced a number, so it can
    // never be poisoned by an absent one.
    expect(velocity.slope === null || Number.isFinite(velocity.slope)).toBe(true);
  });

  it('no periods at all rather than a period reporting nothing', () => {
    const result = calculateDecisionAccuracy({ decisions: [], now: new Date(T0) });
    expect(result.velocity.periods).toEqual([]);
    expect(result.velocity.trend).toBe(LIFT_STATUS.INSUFFICIENT_DATA);
    expect(result.velocity.slope).toBeNull();
  });
});

describe('the gated path is unchanged', () => {
  it('below minSample still suppresses every calibration figure', () => {
    const decisions = Array.from({ length: 3 }, (_, i) => scorable(i));
    const s = surfaceFor(decisions, new Date(T0 + 10 * DAY));
    expect(s.gated).toBe(true);
    expect(s.calibrationErrorPct).toBeNull();
    expect(s.improvementPct).toBeNull();
    expect(s.status).toBeNull();
  });
});
