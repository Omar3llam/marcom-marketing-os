// ============================================================
// C-16 — a null confidence must stay non-qualifying, everywhere  (RED)
// ============================================================
// C-16 made `decisions.confidence` nullable, because `null` and `0.5` are two
// different facts: "the engine measured no confidence for this call" is not a
// coin flip. Dropping NOT NULL also removed the constraint that was keeping two
// downstream readers safe BY CONSTRUCTION rather than by intent.
//
// Neither is reachable today — all five writers emit a number (guardrail 0.9,
// allocation 0.8, incrementality 0.9/0.7, test-tracker's readout, and every
// finalise() branch in the verdict engine). That is exactly why this file
// exists: the slice that removes a guard owns the invariant that replaces it.
//
//   1. decisionAccuracyEngine  clamp01(null) === 0
//        → a decision Lumi never scored enters the Brier score and the
//          calibration bins as a CLAIM of 0% confidence — a maximally-wrong
//          prediction it never made, on the surface that is the moat.
//
//   2. notificationRouter      SEVERITY[up] ?? SEVERITY.MEDIUM
//        → and upstream, `d.confidence >= 0.6` is false for null, so an
//          unmeasured call publishes as a real LOW, and even a null published
//          deliberately is re-invented as MEDIUM one layer down.
//
// This is C-09's `below(null) === false` — an absence compared numerically and
// silently answering as a band — in two new places.
//
// THE INVARIANT: no banding, fallback, or implicit healthy interpretation may
// convert an unmeasured confidence back into a fabricated one.
// ============================================================
import { describe, it, expect } from 'vitest';
import { calculateDecisionAccuracy } from '../services/decision-accuracy/decisionAccuracyEngine.js';
import {
  routeByRole, severityCounts, radarSeverity, SEVERITY, ALERT_KIND,
} from '../services/collaboration/notificationRouter.js';

const DAY = 86_400_000;
const NOW = new Date('2026-06-01T00:00:00Z');

/**
 * A decision that IS scorable — every clause load-bearing:
 *   accuracyStatus EXECUTED  — PROPOSED is not a realized prediction
 *   verdict KILL             — scorable; its predicate reads spendDeltaMinor
 *   windowEnd in the past    — otherwise PENDING_MATURATION, never scored
 *   spendDeltaMinor negative — the KILL succeeded
 */
const scorable = (id, confidence) => ({
  id,
  verdict: 'KILL',
  confidence,
  accuracyStatus: 'EXECUTED',
  createdAt: new Date(NOW.getTime() - 20 * DAY).toISOString(),
  outcome: {
    windowEnd: new Date(NOW.getTime() - DAY).toISOString(),
    sustained: true,
    spendDeltaMinor: -5000,
    revenueDeltaMinor: -2000,
  },
});

describe('C-16 · a null confidence never becomes a scored prediction', () => {
  it('T26 · a mature EXECUTED decision with no confidence is UNSCORABLE, not scored at 0', () => {
    const r = calculateDecisionAccuracy({ now: NOW, decisions: [scorable('n', null)] });
    expect(r.coverage.scored).toBe(0);
    expect(r.coverage.unscorable).toBe(1);
  });

  it('T27 · it stays in the coverage denominator — excluded, never disappeared', () => {
    // UNSCORABLE is "mature but missing the field the predicate needs". A
    // calibration needs a stated probability; there is none. The decision is
    // still a real executed call, so it must depress coverage rather than
    // vanish and make the account look better measured than it is.
    const r = calculateDecisionAccuracy({
      now: NOW,
      decisions: [scorable('a', 0.9), scorable('n', null)],
    });
    expect(r.coverage.scored).toBe(1);
    expect(r.coverage.unscorable).toBe(1);
    expect(r.coverage.totalDecisions).toBe(2);
    expect(r.coverage.scoredFraction).toBe(0.5); // 1 of 2 mature-eligible
  });

  it('T28 · the Brier score is computed from the measured call alone', () => {
    // The number that catches a silent injection. One correct KILL at 0.9:
    //   (0.9 − 1)² = 0.01
    // Admit the null as confidence 0 and it becomes (0.01 + 1) / 2 = 0.505 —
    // the account's calibration halved by a prediction nobody ever made.
    const withNull = calculateDecisionAccuracy({
      now: NOW, decisions: [scorable('a', 0.9), scorable('n', null)],
    });
    const alone = calculateDecisionAccuracy({ now: NOW, decisions: [scorable('a', 0.9)] });
    expect(withNull.calibration.brierScore).toBe(alone.calibration.brierScore);
    expect(withNull.calibration.brierScore).toBeCloseTo(0.01, 6);
  });

  it('T29 · undefined is treated exactly as null — both mean "not measured"', () => {
    const d = scorable('u', 0.9);
    delete d.confidence;
    const r = calculateDecisionAccuracy({ now: NOW, decisions: [d] });
    expect(r.coverage.scored).toBe(0);
    expect(r.coverage.unscorable).toBe(1);
  });
});

describe('C-16 · a null severity is not re-invented downstream', () => {
  const radar = (id, severity) => ({ kind: ALERT_KIND.RADAR, id, verdict: 'KILL', headline: id, severity });

  it('T30 · radarSeverity refuses to band a confidence nobody measured', () => {
    expect(radarSeverity(0.9)).toBe(SEVERITY.HIGH);
    expect(radarSeverity(0.7)).toBe(SEVERITY.MEDIUM);
    expect(radarSeverity(0.2)).toBe(SEVERITY.LOW);
    expect(radarSeverity(null)).toBeNull();
    expect(radarSeverity(undefined)).toBeNull();
  });

  it('T31 · routeByRole preserves a null severity instead of stamping MEDIUM', () => {
    const [only] = routeByRole({ role: 'BUYER', alerts: [radar('x', null)] });
    expect(only.severity).toBeNull();
  });

  it('T32 · an unranked alert sorts below HIGH and above LOW', () => {
    // Visible without claiming urgency. It must not be sorted to the floor
    // either — "we could not rank this" is not "this barely matters".
    const routed = routeByRole({
      role: 'BUYER',
      alerts: [radar('low', 'LOW'), radar('unranked', null), radar('high', 'HIGH')],
    });
    expect(routed.map((a) => a.id)).toEqual(['high', 'unranked', 'low']);
  });

  it('T33 · severityCounts does not count an unranked alert as any severity', () => {
    const routed = routeByRole({ role: 'BUYER', alerts: [radar('u', null), radar('h', 'HIGH')] });
    const counts = severityCounts(routed);
    expect(counts).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 });
    expect(Object.keys(counts)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
});
