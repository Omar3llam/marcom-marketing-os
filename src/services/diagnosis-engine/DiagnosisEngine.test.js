// ============================================================
// DiagnosisEngine — unit tests + fixture verification
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { diagnoseSignals }   from './DiagnosisEngine.js';
import { SIGNAL_TYPE }       from './diagnosisTypes.js';
import { THRESHOLDS }        from './signalRules.js';
import { SCENARIOS }         from './fixtures/scenarios.js';
import { FATIGUE_FREQ, getBenchmarks } from '../verdict-engine/benchmarkProvider.js';

// ── Shared valid baseline ───────────────────────────────────
// Money in MINOR units; ctr in percent. `spend`/`cpc` (major) ride along
// because the verdict thresholds read them — the rules do not.
const HEALTHY_INPUT = {
  ctr:         1.8,
  cpc:         0.90,
  cpm:         5.0,
  frequency:   1.5,
  spend:       100,
  conversions: 8,
  spendMinor:  10_000,
  cpcMinor:    90,
  currency:    'USD',
};

// ── Input handling ──────────────────────────────────────────
// A non-object is a programmer error and still throws. A MISSING FIELD is data
// we were never given, and must skip the rules that read it — the engine used
// to destroy the whole diagnosis over one absent number, which pushed callers
// into zero-filling.
describe('diagnoseSignals — input handling', () => {
  it('throws when input is null or undefined (programmer error, not missing data)', () => {
    expect(() => diagnoseSignals(null)).toThrow('input must be a non-null object');
    expect(() => diagnoseSignals(undefined)).toThrow('input must be a non-null object');
  });

  it.each(['ctr', 'cpc', 'cpm', 'frequency', 'spend', 'conversions', 'spendMinor', 'cpcMinor'])(
    'does NOT throw when %s is missing',
    (field) => {
      const partial = Object.fromEntries(Object.entries(HEALTHY_INPUT).filter(([k]) => k !== field));
      expect(() => diagnoseSignals(partial)).not.toThrow();
    },
  );

  it('a non-numeric or NaN field is treated as absent, not as a crash', () => {
    expect(() => diagnoseSignals({ ...HEALTHY_INPUT, ctr: 'high' })).not.toThrow();
    expect(() => diagnoseSignals({ ...HEALTHY_INPUT, spendMinor: NaN })).not.toThrow();
  });

  it('a negative field is treated as absent — a negative spend is not a small spend', () => {
    const out = diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.1, frequency: -1 });
    expect(out.signalType).toBe(SIGNAL_TYPE.LOW_CTR); // fatigue skipped, ctr rule still ran
  });

  // cpm was a required field that no rule has ever read — its absence used to
  // throw away a diagnosis the engine was fully capable of making.
  it('cpm is no longer required by anything', () => {
    const { cpm, ...noCpm } = HEALTHY_INPUT;
    expect(cpm).toBeDefined();
    expect(diagnoseSignals(noCpm).signalType).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('does not mutate the input object', () => {
    expect(() => diagnoseSignals(Object.freeze({ ...HEALTHY_INPUT }))).not.toThrow();
  });
});

// ── UNDIAGNOSABLE vs HEALTHY ────────────────────────────────
// The distinction Fix 3 forces: once a rule can be skipped, "no rule fired" and
// "no rule ran" are different answers, and reporting the second as the first
// would make a blind engine emit a confident all-clear.
describe('diagnoseSignals — UNDIAGNOSABLE', () => {
  it('an empty input is UNDIAGNOSABLE, never HEALTHY', () => {
    const out = diagnoseSignals({});
    expect(out.signalType).toBe(SIGNAL_TYPE.UNDIAGNOSABLE);
    expect(out.confidence).toBe(0);
    expect(out.reasons).toEqual([]);
  });

  it('an input with only unread fields is still UNDIAGNOSABLE', () => {
    expect(diagnoseSignals({ cpm: 5, spend: 100, cpc: 0.9 }).signalType).toBe(SIGNAL_TYPE.UNDIAGNOSABLE);
  });

  it('ONE evaluable rule is enough to reach a real HEALTHY', () => {
    const out = diagnoseSignals({ ctr: 2.0 }); // only LOW_CTR can run, and declines
    expect(out.signalType).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('HEALTHY is capped at MAX_CONFIDENCE — certainty is never honest', () => {
    expect(diagnoseSignals(HEALTHY_INPUT).confidence).toBe(0.97);
  });
});

// ── Objective-aware CTR ─────────────────────────────────────
describe('diagnoseSignals — CTR bars come from the objective', () => {
  const at = (ctr, objective) => diagnoseSignals({ ...HEALTHY_INPUT, ctr }, { objective });

  // The defect benchmarkProvider was built to fix, one layer down: a single
  // 0.5% floor called every awareness campaign a weak hook.
  it('0.6% is weak for lead gen and healthy for awareness', () => {
    expect(at(0.6, 'OUTCOME_LEADS').signalType).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(at(0.6, 'OUTCOME_AWARENESS').signalType).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('a legacy objective name resolves to its band, not to DEFAULT', () => {
    expect(at(0.6, 'REACH').signalType).toBe(SIGNAL_TYPE.HEALTHY);          // → AWARENESS, 0.5 bar
    expect(at(0.6, 'LEAD_GENERATION').signalType).toBe(SIGNAL_TYPE.LOW_CTR); // → LEADS, 1.0 bar
  });

  it('an unknown or absent objective falls to DEFAULT (0.8), never a global floor', () => {
    expect(getBenchmarks(null).ctr.weak).toBe(0.8);
    expect(at(0.7, null).signalType).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(at(0.7, 'SOME_NEW_META_OBJECTIVE').signalType).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(at(0.9, null).signalType).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('fatigue judges CTR against the objective STRONG bar, not a 1.0 constant', () => {
    const fat = { ...HEALTHY_INPUT, frequency: 4.0 };
    // 1.2% clears the retired 1.0 constant but is under DEFAULT strong (1.5).
    expect(diagnoseSignals({ ...fat, ctr: 1.2 }).signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    // …and is ABOVE awareness's strong bar (1.0), so the same row is not fatigue there.
    expect(diagnoseSignals({ ...fat, ctr: 1.2 }, { objective: 'OUTCOME_AWARENESS' }).signalType)
      .not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });
});

// ── One saturation ceiling ──────────────────────────────────
describe('diagnoseSignals — the frequency ceiling is the verdict engine\'s own', () => {
  const atFreq = (frequency) => diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.9, frequency });

  it('uses FATIGUE_FREQ, inclusively', () => {
    expect(FATIGUE_FREQ).toBe(3.5);
    expect(atFreq(FATIGUE_FREQ).signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  // The drift this closes: 3.1 was fatigue here and healthy to the verdict engine.
  it('3.1 is no longer fatigue — the retired 3.0 constant disagreed with the engine', () => {
    expect(atFreq(3.1).signalType).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(atFreq(3.49).signalType).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });
});

// ── Money is minor units, in the account's own currency ─────
describe('diagnoseSignals — money rules read minor units', () => {
  it('thresholds are minor-unit constants, calibrated in currency units', () => {
    expect(THRESHOLDS.SPEND_FLOOR_MINOR).toBe(5_000); // 50 units
    expect(THRESHOLDS.CPC_HIGH_MINOR).toBe(200);      // 2 units
    expect(THRESHOLDS.CPL_HIGH_MINOR).toBe(5_000);    // 50 units
  });

  it('the major-unit spend/cpc are ignored by the rules', () => {
    // spend: 1 (major) would be under any floor; spendMinor is what decides.
    const out = diagnoseSignals({
      ...HEALTHY_INPUT, ctr: 1.2, cpc: 0.01, spend: 1,
      spendMinor: 35_000, cpcMinor: 350, conversions: 1,
    });
    expect(out.signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('an EGP account is judged by the same unit count, not a converted one', () => {
    const egp = { ...HEALTHY_INPUT, currency: 'EGP', ctr: 1.2, spendMinor: 35_000, cpcMinor: 350, conversions: 1 };
    expect(diagnoseSignals(egp).signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  // The fabricated symbol: reasons used to interpolate "$" on every account.
  it('never emits a currency symbol — it reports the currency as data', () => {
    const egp = { ...HEALTHY_INPUT, currency: 'EGP', ctr: 1.2, spendMinor: 35_000, cpcMinor: 350, conversions: 1 };
    const { reasons } = diagnoseSignals(egp);
    expect(JSON.stringify(reasons)).not.toContain('$');
    expect(reasons.find((r) => r.metric === 'CPC').currency).toBe('EGP');
  });
});

// ── Structured reasons ──────────────────────────────────────
// Prose could not be translated, could not survive an RTL render, and had to be
// parsed to be reused — the failure that truncated the funnel counterfactual.
describe('diagnoseSignals — reasons are structured, not prose', () => {
  const fatigued = { ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 };

  it('every reason is an object in the shared evidence shape', () => {
    for (const r of diagnoseSignals(fatigued).reasons) {
      expect(typeof r).toBe('object');
      expect(r).toHaveProperty('metric');
      expect(r).toHaveProperty('value');
      expect(r).toHaveProperty('benchmark');
      expect(r).toHaveProperty('status');
    }
  });

  it('carries the observed value AND the bar it was judged against', () => {
    const reasons = diagnoseSignals(fatigued).reasons;
    expect(reasons).toEqual([
      { metric: 'FREQUENCY', value: 4.0, benchmark: 3.5, status: 'weak' },
      { metric: 'CTR',       value: 0.7, benchmark: 1.5, status: 'weak' },
    ]);
  });

  it('the benchmark in a reason moves with the objective', () => {
    const r = diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.3 }, { objective: 'OUTCOME_LEADS' }).reasons;
    expect(r[0]).toEqual({ metric: 'CTR', value: 0.3, benchmark: 1.0, status: 'weak' });
  });

  it('metric keys are the UPPERCASE names the client unit map is keyed on', () => {
    const keys = diagnoseSignals(fatigued).reasons.map((r) => r.metric);
    for (const k of keys) expect(k).toBe(k.toUpperCase());
  });

  it('HEALTHY and UNDIAGNOSABLE report no observations rather than a filler sentence', () => {
    expect(diagnoseSignals(HEALTHY_INPUT).reasons).toEqual([]);
    expect(diagnoseSignals({}).reasons).toEqual([]);
  });
});

// ── Individual rule triggers ────────────────────────────────
describe('diagnoseSignals — rule: CREATIVE_FATIGUE', () => {
  it('fires past the ceiling with CTR under the objective strong bar', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 3.6, ctr: 0.8 });
    expect(result.signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(result.confidence).toBe(0.85);
  });

  it('does NOT fire past the ceiling when CTR is strong', () => {
    expect(diagnoseSignals({ ...HEALTHY_INPUT, frequency: 3.6, ctr: 2.0 }).signalType)
      .not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('skips entirely when frequency was never reported', () => {
    const { frequency, ...noFreq } = HEALTHY_INPUT;
    expect(frequency).toBeDefined();
    expect(diagnoseSignals({ ...noFreq, ctr: 0.3 }).signalType).toBe(SIGNAL_TYPE.LOW_CTR);
  });
});

describe('diagnoseSignals — rule: AUDIENCE_MISMATCH', () => {
  const base = { ...HEALTHY_INPUT, frequency: 1.5, ctr: 1.2, cpcMinor: 300, spendMinor: 15_000 };

  it('fires above the CPC bar, past the spend floor, with a thin conversion rate', () => {
    const result = diagnoseSignals({ ...base, conversions: 0 });
    expect(result.signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
    expect(result.confidence).toBe(0.80);
  });

  it('does NOT fire under the spend floor', () => {
    expect(diagnoseSignals({ ...base, spendMinor: 4_000, conversions: 0 }).signalType)
      .not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('does NOT fire at an acceptable CPC even with zero conversions', () => {
    expect(diagnoseSignals({ ...base, cpcMinor: 150, conversions: 0 }).signalType)
      .not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('skips when CPC could not be derived (no clicks measured)', () => {
    const { cpcMinor, ...noCpc } = base;
    expect(cpcMinor).toBeDefined();
    expect(diagnoseSignals({ ...noCpc, conversions: 0 }).signalType)
      .not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });
});

describe('diagnoseSignals — rule: INEFFICIENT_SCALING', () => {
  it('fires when cost per conversion exceeds the target', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, spendMinor: 50_000, conversions: 8 });
    expect(result.signalType).toBe(SIGNAL_TYPE.INEFFICIENT_SCALING); // 6250 > 5000
    expect(result.confidence).toBe(0.75);
  });

  it('does NOT fire under the spend floor', () => {
    expect(diagnoseSignals({ ...HEALTHY_INPUT, spendMinor: 3_000, conversions: 1 }).signalType)
      .not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });

  it('does NOT fire on zero conversions (undefined CPL)', () => {
    expect(diagnoseSignals({ ...HEALTHY_INPUT, spendMinor: 50_000, conversions: 0 }).signalType)
      .not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });
});

describe('diagnoseSignals — rule: LOW_CTR', () => {
  it('fires under the objective weak bar', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.3 });
    expect(result.signalType).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(result.diagnosis).toBe('weak_hook');
    expect(result.confidence).toBe(0.70);
  });

  it('does NOT fire at the bar exactly', () => {
    expect(diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.8 }).signalType).not.toBe(SIGNAL_TYPE.LOW_CTR);
  });
});

// ── Rule priority ───────────────────────────────────────────
describe('diagnoseSignals — rule priority', () => {
  it('CREATIVE_FATIGUE beats AUDIENCE_MISMATCH when both conditions are met', () => {
    expect(diagnoseSignals({
      ctr: 0.6, cpc: 3.20, cpm: 14.0, frequency: 4.0, spend: 320, conversions: 1,
      spendMinor: 32_000, cpcMinor: 320, currency: 'USD',
    }).signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('AUDIENCE_MISMATCH beats INEFFICIENT_SCALING when both conditions are met', () => {
    expect(diagnoseSignals({
      ctr: 1.2, cpc: 3.00, cpm: 12.0, frequency: 2.0, spend: 300, conversions: 1,
      spendMinor: 30_000, cpcMinor: 300, currency: 'USD',
    }).signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  // Priority order and the confidence ladder are coupled; if they ever diverge,
  // first-match-wins stops meaning highest-confidence-wins.
  it('confidence descends in priority order', () => {
    const seen = [
      diagnoseSignals({ ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 }).confidence,
      diagnoseSignals({ ...HEALTHY_INPUT, ctr: 1.2, cpcMinor: 300, spendMinor: 15_000, conversions: 0 }).confidence,
      diagnoseSignals({ ...HEALTHY_INPUT, ctr: 1.2, spendMinor: 50_000, conversions: 8 }).confidence,
      diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.3 }).confidence,
    ];
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(seen).toEqual([0.85, 0.80, 0.75, 0.70]);
  });
});

// ── Determinism ─────────────────────────────────────────────
describe('diagnoseSignals — determinism', () => {
  it('produces identical output on repeated calls with the same input', () => {
    const input = { ctr: 0.7, cpc: 1.20, cpm: 8.0, frequency: 4.5, spend: 420, conversions: 8, spendMinor: 42_000, cpcMinor: 120, currency: 'USD' };
    expect(diagnoseSignals(input)).toEqual(diagnoseSignals(input));
  });
});

// ── Fixture verification ─────────────────────────────────────
describe('diagnoseSignals — canonical fixture contracts', () => {
  it.each(SCENARIOS)('$name → $expected.signalType', ({ input, objective = null, expected }) => {
    const result = diagnoseSignals(input, { objective });
    expect(result.signalType).toBe(expected.signalType);
    expect(result.diagnosis).toBe(expected.diagnosis);
    expect(result.confidence).toBe(expected.confidence);
  });
});
