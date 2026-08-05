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

// The winning signal — what the verdict engine reads as `signals[0]`.
const top = (input, objective = null) => diagnoseSignals(input, { objective }).signals[0];
const typeOf = (input, objective = null) => top(input, objective).signalType;

// ── Input handling ──────────────────────────────────────────
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
    expect(typeOf({ ...HEALTHY_INPUT, ctr: 0.1, frequency: -1 })).toBe(SIGNAL_TYPE.LOW_CTR);
  });

  it('cpm is no longer required by anything', () => {
    const { cpm, ...noCpm } = HEALTHY_INPUT;
    expect(cpm).toBeDefined();
    expect(typeOf(noCpm)).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('does not mutate the input object', () => {
    expect(() => diagnoseSignals(Object.freeze({ ...HEALTHY_INPUT }))).not.toThrow();
  });
});

// ── The envelope ────────────────────────────────────────────
describe('diagnoseSignals — { signals, declined, undiagnosable }', () => {
  it('returns the documented envelope', () => {
    expect(Object.keys(diagnoseSignals(HEALTHY_INPUT)).sort())
      .toEqual(['declined', 'signals', 'undiagnosable']);
  });

  // Keeping the terminal states INSIDE signals[] is what lets every consumer —
  // including the verdict engine's switch — read signals[0].signalType without
  // a null guard. A bare `undiagnosable: true` flag with an empty array would
  // make signals[0] undefined and throw at the switch.
  it('signals is never empty, on any path', () => {
    for (const input of [HEALTHY_INPUT, {}, { ...HEALTHY_INPUT, ctr: 0.1 }]) {
      expect(diagnoseSignals(input).signals.length).toBeGreaterThan(0);
      expect(diagnoseSignals(input).signals[0].signalType).toEqual(expect.any(String));
    }
  });

  it('every signal carries observations, evaluable and fired', () => {
    const { signals, declined } = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 });
    for (const s of [...signals, ...declined]) {
      expect(s).toMatchObject({
        signalType: expect.any(String),
        confidence: expect.any(Number),
        observations: expect.any(Array),
        evaluable: expect.any(Boolean),
        fired: expect.any(Boolean),
      });
    }
    expect(signals.every((s) => s.fired)).toBe(true);
    expect(declined.every((s) => !s.fired)).toBe(true);
  });
});

// ── ALL matching rules, ranked ──────────────────────────────
describe('diagnoseSignals — every matching rule is returned, not just the first', () => {
  // frequency 4.0 + ctr 0.7 satisfies BOTH creative fatigue and the weak-hook
  // floor. The old engine returned on the first and the second was invisible.
  const both = { ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 };

  it('returns both fired rules', () => {
    expect(diagnoseSignals(both).signals.map((s) => s.signalType))
      .toEqual([SIGNAL_TYPE.CREATIVE_FATIGUE, SIGNAL_TYPE.LOW_CTR]);
  });

  it('sorts by confidence descending', () => {
    const c = diagnoseSignals(both).signals.map((s) => s.confidence);
    expect(c).toEqual([...c].sort((x, y) => y - x));
    expect(c).toEqual([0.85, 0.70]);
  });

  // The ranking used to be implicit in declaration order and nothing said so.
  it('signals[0] is the highest confidence — the same pick first-match made', () => {
    expect(diagnoseSignals(both).signals[0].signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });
});

// ── Declined rules are the counterfactual material ──────────
describe('diagnoseSignals — declined rules keep their measurements', () => {
  const fatigued = { ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 };

  it('a rule that ran and declined is reported, with observations', () => {
    const { declined } = diagnoseSignals(fatigued);
    expect(declined.map((d) => d.signalType).sort())
      .toEqual([SIGNAL_TYPE.AUDIENCE_MISMATCH, SIGNAL_TYPE.INEFFICIENT_SCALING].sort());
    for (const d of declined) expect(d.observations.length).toBeGreaterThan(0);
  });

  // The whole point: a declined rule's numbers are what RULE IT OUT, so they
  // must read 'healthy'. While reasons() ran only on the winner, status was a
  // hardcoded 'weak' — which on a declined rule states the opposite of its own
  // figure, and a counterfactual that argues against itself is worse than none.
  it('declined observations are healthy — that is WHY the rule was ruled out', () => {
    const mismatch = diagnoseSignals(fatigued).declined
      .find((d) => d.signalType === SIGNAL_TYPE.AUDIENCE_MISMATCH);
    expect(mismatch.observations.find((o) => o.metric === 'CPC').status).toBe('healthy');
    expect(mismatch.observations.find((o) => o.metric === 'CONV_RATE').status).toBe('healthy');
  });

  it('a rule that could NOT be evaluated appears in neither list', () => {
    // No frequency → CREATIVE_FATIGUE is skipped entirely. "We could not look"
    // and "we looked and it was fine" eliminate differently.
    const { frequency, ...noFreq } = HEALTHY_INPUT;
    expect(frequency).toBeDefined();
    const { signals, declined } = diagnoseSignals(noFreq);
    const seen = [...signals, ...declined].map((s) => s.signalType);
    expect(seen).not.toContain(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('HEALTHY carries no observations — its evidence is the declined list', () => {
    const { signals, declined } = diagnoseSignals(HEALTHY_INPUT);
    expect(signals[0].signalType).toBe(SIGNAL_TYPE.HEALTHY);
    expect(signals[0].observations).toEqual([]);
    expect(declined).toHaveLength(4); // all four rules ran and passed
  });
});

// ── UNDIAGNOSABLE vs HEALTHY ────────────────────────────────
describe('diagnoseSignals — UNDIAGNOSABLE', () => {
  it('an empty input is UNDIAGNOSABLE, never HEALTHY', () => {
    const r = diagnoseSignals({});
    expect(r.signals[0].signalType).toBe(SIGNAL_TYPE.UNDIAGNOSABLE);
    expect(r.signals[0].confidence).toBe(0);
    expect(r.signals[0].evaluable).toBe(false);
    expect(r.undiagnosable).toBe(true);
    expect(r.declined).toEqual([]);
  });

  it('an input with only unread fields is still UNDIAGNOSABLE', () => {
    expect(typeOf({ cpm: 5, spend: 100, cpc: 0.9 })).toBe(SIGNAL_TYPE.UNDIAGNOSABLE);
  });

  it('ONE evaluable rule is enough to reach a real HEALTHY', () => {
    const r = diagnoseSignals({ ctr: 2.0 }); // only LOW_CTR can run, and declines
    expect(r.signals[0].signalType).toBe(SIGNAL_TYPE.HEALTHY);
    expect(r.undiagnosable).toBe(false);
    expect(r.declined).toHaveLength(1);
  });

  it('HEALTHY is capped at MAX_CONFIDENCE — certainty is never honest', () => {
    expect(top(HEALTHY_INPUT).confidence).toBe(0.97);
  });
});

// ── obs(): status is derived, direction-aware ───────────────
describe('diagnoseSignals — observation status is derived, never hardcoded', () => {
  const obsFor = (input, type, metric) => {
    const { signals, declined } = diagnoseSignals(input);
    const sig = [...signals, ...declined].find((s) => s.signalType === type);
    return sig.observations.find((o) => o.metric === metric);
  };

  // FREQUENCY is a CEILING. A direction-blind comparison grades the most
  // saturated ad 'healthy' — the inversion METRIC_DIRECTION exists to prevent.
  it('FREQUENCY above the ceiling is weak, below it is healthy', () => {
    expect(obsFor({ ...HEALTHY_INPUT, frequency: 4.2, ctr: 0.7 }, SIGNAL_TYPE.CREATIVE_FATIGUE, 'FREQUENCY').status).toBe('weak');
    expect(obsFor({ ...HEALTHY_INPUT, frequency: 2.1 }, SIGNAL_TYPE.CREATIVE_FATIGUE, 'FREQUENCY').status).toBe('healthy');
  });

  it('CTR is a FLOOR — below the bar is weak, above it is healthy', () => {
    expect(obsFor({ ...HEALTHY_INPUT, ctr: 0.3 }, SIGNAL_TYPE.LOW_CTR, 'CTR').status).toBe('weak');
    expect(obsFor({ ...HEALTHY_INPUT, ctr: 2.0 }, SIGNAL_TYPE.LOW_CTR, 'CTR').status).toBe('healthy');
  });

  it('costs are ceilings too — a cheap CPC reads healthy', () => {
    expect(obsFor({ ...HEALTHY_INPUT, cpcMinor: 350, conversions: 0, ctr: 1.2 }, SIGNAL_TYPE.AUDIENCE_MISMATCH, 'CPC').status).toBe('weak');
    expect(obsFor({ ...HEALTHY_INPUT, cpcMinor: 50 }, SIGNAL_TYPE.AUDIENCE_MISMATCH, 'CPC').status).toBe('healthy');
  });

  it('a benchmark-less figure is context: status and severity both null', () => {
    const spend = obsFor(HEALTHY_INPUT, SIGNAL_TYPE.INEFFICIENT_SCALING, 'SPEND');
    expect(spend.benchmark).toBeNull();
    expect(spend.status).toBeNull();
    expect(spend.severity).toBeNull();
  });

  it('status never contradicts severity', () => {
    const { signals, declined } = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 });
    for (const s of [...signals, ...declined]) {
      for (const o of s.observations) {
        if (o.severity == null) expect(o.status).toBeNull();
        else expect(o.status).toBe(o.severity === 'healthy' ? 'healthy' : 'weak');
      }
    }
  });

  it('status is only ever healthy, weak, or null — the live client whitelist', () => {
    const { signals, declined } = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 });
    for (const s of [...signals, ...declined]) {
      for (const o of s.observations) expect([null, 'healthy', 'weak']).toContain(o.status);
    }
  });
});

// ── Objective-aware CTR ─────────────────────────────────────
describe('diagnoseSignals — CTR bars come from the objective', () => {
  const at = (ctr, objective) => typeOf({ ...HEALTHY_INPUT, ctr }, objective);

  it('0.6% is weak for lead gen and healthy for awareness', () => {
    expect(at(0.6, 'OUTCOME_LEADS')).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(at(0.6, 'OUTCOME_AWARENESS')).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('a legacy objective name resolves to its band, not to DEFAULT', () => {
    expect(at(0.6, 'REACH')).toBe(SIGNAL_TYPE.HEALTHY);
    expect(at(0.6, 'LEAD_GENERATION')).toBe(SIGNAL_TYPE.LOW_CTR);
  });

  it('an unknown or absent objective falls to DEFAULT (0.8), never a global floor', () => {
    expect(getBenchmarks(null).ctr.weak).toBe(0.8);
    expect(at(0.7, null)).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(at(0.7, 'SOME_NEW_META_OBJECTIVE')).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(at(0.9, null)).toBe(SIGNAL_TYPE.HEALTHY);
  });

  it('fatigue judges CTR against the objective STRONG bar, not a 1.0 constant', () => {
    const fat = { ...HEALTHY_INPUT, frequency: 4.0, ctr: 1.2 };
    expect(typeOf(fat)).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(typeOf(fat, 'OUTCOME_AWARENESS')).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });
});

// ── One saturation ceiling ──────────────────────────────────
describe('diagnoseSignals — the frequency ceiling is the verdict engine\'s own', () => {
  const atFreq = (frequency) => typeOf({ ...HEALTHY_INPUT, ctr: 0.9, frequency });

  it('uses FATIGUE_FREQ, inclusively', () => {
    expect(FATIGUE_FREQ).toBe(3.5);
    expect(atFreq(FATIGUE_FREQ)).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('3.1 is no longer fatigue — the retired 3.0 constant disagreed with the engine', () => {
    expect(atFreq(3.1)).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(atFreq(3.49)).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });
});

// ── Money is minor units, in the account's own currency ─────
describe('diagnoseSignals — money rules read minor units', () => {
  it('thresholds are minor-unit constants, calibrated in currency units', () => {
    expect(THRESHOLDS.SPEND_FLOOR_MINOR).toBe(5_000);
    expect(THRESHOLDS.CPC_HIGH_MINOR).toBe(200);
    expect(THRESHOLDS.CPL_HIGH_MINOR).toBe(5_000);
  });

  it('the major-unit spend/cpc are ignored by the rules', () => {
    expect(typeOf({
      ...HEALTHY_INPUT, ctr: 1.2, cpc: 0.01, spend: 1,
      spendMinor: 35_000, cpcMinor: 350, conversions: 1,
    })).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('an EGP account is judged by the same unit count, not a converted one', () => {
    expect(typeOf({ ...HEALTHY_INPUT, currency: 'EGP', ctr: 1.2, spendMinor: 35_000, cpcMinor: 350, conversions: 1 }))
      .toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('never emits a currency symbol — it reports the currency as data', () => {
    const egp = { ...HEALTHY_INPUT, currency: 'EGP', ctr: 1.2, spendMinor: 35_000, cpcMinor: 350, conversions: 1 };
    const { observations } = top(egp);
    expect(JSON.stringify(observations)).not.toContain('$');
    expect(observations.find((o) => o.metric === 'CPC').currency).toBe('EGP');
  });
});

// ── Structured observations ─────────────────────────────────
describe('diagnoseSignals — observations are structured, not prose', () => {
  const fatigued = { ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 };

  it('carries the observed value, the bar, the status and the severity', () => {
    expect(top(fatigued).observations).toEqual([
      { metric: 'FREQUENCY', value: 4.0, benchmark: 3.5, status: 'weak', severity: 'medium',   currency: null },
      { metric: 'CTR',       value: 0.7, benchmark: 1.5, status: 'weak', severity: 'critical', currency: null },
    ]);
  });

  it('the benchmark in an observation moves with the objective', () => {
    expect(top({ ...HEALTHY_INPUT, ctr: 0.3 }, 'OUTCOME_LEADS').observations).toEqual([
      { metric: 'CTR', value: 0.3, benchmark: 1.0, status: 'weak', severity: 'critical', currency: null },
    ]);
  });

  it('metric keys are the UPPERCASE names the client unit map is keyed on', () => {
    for (const o of top(fatigued).observations) expect(o.metric).toBe(o.metric.toUpperCase());
  });
});

// ── Individual rule triggers ────────────────────────────────
describe('diagnoseSignals — rule: CREATIVE_FATIGUE', () => {
  it('fires past the ceiling with CTR under the objective strong bar', () => {
    const s = top({ ...HEALTHY_INPUT, frequency: 3.6, ctr: 0.8 });
    expect(s.signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(s.confidence).toBe(0.85);
  });

  it('does NOT fire past the ceiling when CTR is strong', () => {
    expect(typeOf({ ...HEALTHY_INPUT, frequency: 3.6, ctr: 2.0 })).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('skips entirely when frequency was never reported', () => {
    const { frequency, ...noFreq } = HEALTHY_INPUT;
    expect(frequency).toBeDefined();
    expect(typeOf({ ...noFreq, ctr: 0.3 })).toBe(SIGNAL_TYPE.LOW_CTR);
  });
});

describe('diagnoseSignals — rule: AUDIENCE_MISMATCH', () => {
  const base = { ...HEALTHY_INPUT, frequency: 1.5, ctr: 1.2, cpcMinor: 300, spendMinor: 15_000 };

  it('fires above the CPC bar, past the spend floor, with a thin conversion rate', () => {
    const s = top({ ...base, conversions: 0 });
    expect(s.signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
    expect(s.confidence).toBe(0.80);
  });

  it('does NOT fire under the spend floor', () => {
    expect(typeOf({ ...base, spendMinor: 4_000, conversions: 0 })).not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('does NOT fire at an acceptable CPC even with zero conversions', () => {
    expect(typeOf({ ...base, cpcMinor: 150, conversions: 0 })).not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('skips when CPC could not be derived (no clicks measured)', () => {
    const { cpcMinor, ...noCpc } = base;
    expect(cpcMinor).toBeDefined();
    expect(typeOf({ ...noCpc, conversions: 0 })).not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });
});

describe('diagnoseSignals — rule: INEFFICIENT_SCALING', () => {
  it('fires when cost per conversion exceeds the target', () => {
    const s = top({ ...HEALTHY_INPUT, spendMinor: 50_000, conversions: 8 });
    expect(s.signalType).toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
    expect(s.confidence).toBe(0.75);
  });

  it('does NOT fire under the spend floor', () => {
    expect(typeOf({ ...HEALTHY_INPUT, spendMinor: 3_000, conversions: 1 })).not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });

  it('does NOT fire on zero conversions (undefined CPL)', () => {
    expect(typeOf({ ...HEALTHY_INPUT, spendMinor: 50_000, conversions: 0 })).not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });
});

describe('diagnoseSignals — rule: LOW_CTR', () => {
  it('fires under the objective weak bar', () => {
    const s = top({ ...HEALTHY_INPUT, ctr: 0.3 });
    expect(s.signalType).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(s.diagnosis).toBe('weak_hook');
    expect(s.confidence).toBe(0.70);
  });

  it('does NOT fire at the bar exactly', () => {
    expect(typeOf({ ...HEALTHY_INPUT, ctr: 0.8 })).not.toBe(SIGNAL_TYPE.LOW_CTR);
  });
});

// ── Rule priority ───────────────────────────────────────────
describe('diagnoseSignals — rule priority', () => {
  it('CREATIVE_FATIGUE outranks AUDIENCE_MISMATCH when both fire', () => {
    const s = diagnoseSignals({
      ctr: 0.6, cpc: 3.20, cpm: 14.0, frequency: 4.0, spend: 320, conversions: 1,
      spendMinor: 32_000, cpcMinor: 320, currency: 'USD',
    }).signals;
    expect(s[0].signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(s.map((x) => x.signalType)).toContain(SIGNAL_TYPE.AUDIENCE_MISMATCH); // no longer hidden
  });

  it('AUDIENCE_MISMATCH outranks INEFFICIENT_SCALING when both fire', () => {
    expect(top({
      ctr: 1.2, cpc: 3.00, cpm: 12.0, frequency: 2.0, spend: 300, conversions: 1,
      spendMinor: 30_000, cpcMinor: 300, currency: 'USD',
    }).signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('confidence descends in priority order', () => {
    const seen = [
      top({ ...HEALTHY_INPUT, frequency: 4.0, ctr: 0.7 }).confidence,
      top({ ...HEALTHY_INPUT, ctr: 1.2, cpcMinor: 300, spendMinor: 15_000, conversions: 0 }).confidence,
      top({ ...HEALTHY_INPUT, ctr: 1.2, spendMinor: 50_000, conversions: 8 }).confidence,
      top({ ...HEALTHY_INPUT, ctr: 0.3 }).confidence,
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
    const s = top(input, objective);
    expect(s.signalType).toBe(expected.signalType);
    expect(s.diagnosis).toBe(expected.diagnosis);
    expect(s.confidence).toBe(expected.confidence);
  });
});
