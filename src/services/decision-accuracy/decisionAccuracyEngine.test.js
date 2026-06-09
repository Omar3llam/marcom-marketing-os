import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';
import {
  accuracySurface, COVERAGE_VERDICT, LIFT_STATUS, CALIBRATION_DIRECTION, DEFAULT_CONFIG,
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
