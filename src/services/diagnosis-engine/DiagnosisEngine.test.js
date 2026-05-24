// ============================================================
// DiagnosisEngine — unit tests + fixture verification
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { diagnoseSignals }   from './DiagnosisEngine.js';
import { SIGNAL_TYPE }       from './diagnosisTypes.js';
import { SCENARIOS }         from './fixtures/scenarios.js';

// ── Shared valid baseline ───────────────────────────────────
const HEALTHY_INPUT = {
  ctr:         1.8,
  cpc:         0.90,
  cpm:         5.0,
  frequency:   1.5,
  spend:       100,
  conversions: 8,
};

// ── Input validation ────────────────────────────────────────
describe('diagnoseSignals — input validation', () => {
  it('throws when input is null', () => {
    expect(() => diagnoseSignals(null)).toThrow('input must be a non-null object');
  });

  it('throws when input is undefined', () => {
    expect(() => diagnoseSignals(undefined)).toThrow('input must be a non-null object');
  });

  it.each(['ctr', 'cpc', 'cpm', 'frequency', 'spend', 'conversions'])(
    'throws when %s is missing',
    (field) => {
      const bad = Object.fromEntries(Object.entries(HEALTHY_INPUT).filter(([k]) => k !== field));
      expect(() => diagnoseSignals(bad)).toThrow(`${field} is required`);
    },
  );

  it('throws when a field is not a number', () => {
    expect(() => diagnoseSignals({ ...HEALTHY_INPUT, ctr: 'high' }))
      .toThrow('ctr must be a finite number');
  });

  it('throws when a field is NaN', () => {
    expect(() => diagnoseSignals({ ...HEALTHY_INPUT, spend: NaN }))
      .toThrow('spend must be a finite number');
  });

  it('throws when a field is negative', () => {
    expect(() => diagnoseSignals({ ...HEALTHY_INPUT, frequency: -1 }))
      .toThrow('frequency must be non-negative');
  });

  it('accepts zero values for all fields', () => {
    const zeroInput = { ctr: 0, cpc: 0, cpm: 0, frequency: 0, spend: 0, conversions: 0 };
    expect(() => diagnoseSignals(zeroInput)).not.toThrow();
  });
});

// ── Output shape ────────────────────────────────────────────
describe('diagnoseSignals — output shape', () => {
  it('always returns signalType, diagnosis, confidence, reasons', () => {
    const result = diagnoseSignals(HEALTHY_INPUT);
    expect(result).toHaveProperty('signalType');
    expect(result).toHaveProperty('diagnosis');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasons');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('confidence is a number between 0 and 1 (inclusive)', () => {
    const result = diagnoseSignals(HEALTHY_INPUT);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('reasons array is non-empty', () => {
    const result = diagnoseSignals(HEALTHY_INPUT);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

// ── Individual rule triggers ────────────────────────────────
describe('diagnoseSignals — rule: CREATIVE_FATIGUE', () => {
  it('fires when frequency > 3 and CTR < 1%', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 3.5, ctr: 0.8 });
    expect(result.signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(result.confidence).toBe(0.85);
  });

  it('does NOT fire when frequency > 3 but CTR >= 1%', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 3.5, ctr: 1.2 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('does NOT fire when CTR < 1% but frequency <= 3', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, frequency: 2.9, ctr: 0.8 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });
});

describe('diagnoseSignals — rule: AUDIENCE_MISMATCH', () => {
  const mismatchBase = { ...HEALTHY_INPUT, frequency: 1.5, ctr: 1.2, cpc: 3.0, spend: 150 };

  it('fires when CPC > 2, spend >= 50, and conversion rate < 2%', () => {
    // clicks = 150/3 = 50; 0 conversions → convRate 0% < 2%
    const result = diagnoseSignals({ ...mismatchBase, conversions: 0 });
    expect(result.signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
    expect(result.confidence).toBe(0.80);
  });

  it('does NOT fire when spend < 50 (floor guard)', () => {
    const result = diagnoseSignals({ ...mismatchBase, spend: 40, conversions: 0 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });

  it('does NOT fire when CPC <= 2 even with zero conversions', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, cpc: 1.50, spend: 150, conversions: 0 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });
});

describe('diagnoseSignals — rule: INEFFICIENT_SCALING', () => {
  it('fires when cost-per-conversion > $50', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, spend: 500, conversions: 8 });
    // cpl = 500/8 = $62.50 > $50
    expect(result.signalType).toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
    expect(result.confidence).toBe(0.75);
  });

  it('does NOT fire when spend < 50 (floor guard)', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, spend: 30, conversions: 1 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });

  it('does NOT fire when conversions are zero (undefined CPL)', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, spend: 500, conversions: 0 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });

  it('does NOT fire when CPL is below threshold', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, spend: 100, conversions: 10 });
    // cpl = $10 — well below $50
    expect(result.signalType).not.toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
  });
});

describe('diagnoseSignals — rule: LOW_CTR', () => {
  it('fires when CTR < 0.5%', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.3 });
    expect(result.signalType).toBe(SIGNAL_TYPE.LOW_CTR);
    expect(result.diagnosis).toBe('weak_hook');
    expect(result.confidence).toBe(0.70);
  });

  it('does NOT fire when CTR >= 0.5%', () => {
    const result = diagnoseSignals({ ...HEALTHY_INPUT, ctr: 0.5 });
    expect(result.signalType).not.toBe(SIGNAL_TYPE.LOW_CTR);
  });
});

describe('diagnoseSignals — HEALTHY fallback', () => {
  it('returns HEALTHY when no rule fires', () => {
    const result = diagnoseSignals(HEALTHY_INPUT);
    expect(result.signalType).toBe(SIGNAL_TYPE.HEALTHY);
    expect(result.diagnosis).toBe('healthy');
    expect(result.confidence).toBe(1.0);
  });
});

// ── Rule priority ───────────────────────────────────────────
describe('diagnoseSignals — rule priority', () => {
  it('CREATIVE_FATIGUE beats AUDIENCE_MISMATCH when both conditions are met', () => {
    // frequency > 3 (fatigue) AND cpc > 2 + low conv rate (mismatch)
    const result = diagnoseSignals({
      ctr:         0.6,
      cpc:         3.20,
      cpm:         14.0,
      frequency:   4.0,
      spend:       320,
      conversions: 1,
    });
    expect(result.signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
  });

  it('AUDIENCE_MISMATCH beats INEFFICIENT_SCALING when both conditions are met', () => {
    // cpc > 2 + zero convs (mismatch) AND spend/convs would be infinite if convs > 0
    // Use: high CPC, low convs that make conversion rate < 2% AND CPL > 50
    const result = diagnoseSignals({
      ctr:         1.2,
      cpc:         3.00,
      cpm:         12.0,
      frequency:   2.0,
      spend:       300,
      conversions: 1, // clicks=100, convRate=1%<2% → mismatch; CPL=300→inefficient
    });
    expect(result.signalType).toBe(SIGNAL_TYPE.AUDIENCE_MISMATCH);
  });
});

// ── Determinism ─────────────────────────────────────────────
describe('diagnoseSignals — determinism', () => {
  it('produces identical output on repeated calls with the same input', () => {
    const input = { ctr: 0.7, cpc: 1.20, cpm: 8.0, frequency: 4.5, spend: 420, conversions: 8 };
    const a = diagnoseSignals(input);
    const b = diagnoseSignals(input);
    expect(a).toEqual(b);
  });

  it('does not mutate the input object', () => {
    const input = Object.freeze({ ...HEALTHY_INPUT });
    expect(() => diagnoseSignals(input)).not.toThrow();
  });
});

// ── Fixture verification ─────────────────────────────────────
describe('diagnoseSignals — canonical fixture contracts', () => {
  it.each(SCENARIOS)('$name → $expected.signalType', ({ input, expected }) => {
    const result = diagnoseSignals(input);
    expect(result.signalType).toBe(expected.signalType);
    expect(result.diagnosis).toBe(expected.diagnosis);
    expect(result.confidence).toBe(expected.confidence);
  });
});
