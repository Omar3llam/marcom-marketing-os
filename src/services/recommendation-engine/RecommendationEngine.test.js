// ============================================================
// RecommendationEngine — unit tests + fixture verification
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateRecommendations } from './RecommendationEngine.js';
import { REC_TYPE, PRIORITY }      from './recommendationTypes.js';
import { SCENARIOS }               from './fixtures/scenarios.js';

// ── Shared valid baselines ──────────────────────────────────
const FATIGUE_INPUT = {
  diagnosis: { type: 'CREATIVE_FATIGUE', confidence: 0.85 },
  metrics:   { ctr: 0.7, frequency: 4.2, spend: 120 },
};

const HEALTHY_LOW = {
  diagnosis: { type: 'HEALTHY', confidence: 1.0 },
  metrics:   { ctr: 1.8, cpc: 0.90, spend: 50 },
};

const HEALTHY_HIGH = {
  diagnosis: { type: 'HEALTHY', confidence: 1.0 },
  metrics:   { ctr: 1.8, cpc: 0.90, spend: 200 },
};

// ── Input validation ────────────────────────────────────────
describe('generateRecommendations — input validation', () => {
  it('throws when input is null', () => {
    expect(() => generateRecommendations(null)).toThrow('input must be a non-null object');
  });

  it('throws when input is undefined', () => {
    expect(() => generateRecommendations(undefined)).toThrow('input must be a non-null object');
  });

  it('throws when diagnosis is missing', () => {
    expect(() => generateRecommendations({ metrics: { ctr: 1 } }))
      .toThrow('diagnosis must be a non-null object');
  });

  it('throws when diagnosis is null', () => {
    expect(() => generateRecommendations({ diagnosis: null, metrics: { ctr: 1 } }))
      .toThrow('diagnosis must be a non-null object');
  });

  it('throws when diagnosis.type is missing', () => {
    expect(() => generateRecommendations({
      diagnosis: { confidence: 0.8 },
      metrics: { ctr: 1 },
    })).toThrow('diagnosis.type is required');
  });

  it('throws when diagnosis.type is an empty string', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: '', confidence: 0.8 },
      metrics: { ctr: 1 },
    })).toThrow('diagnosis.type is required');
  });

  it('throws when diagnosis.type is an unknown signal', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'INVENTED_SIGNAL', confidence: 0.5 },
      metrics: { ctr: 1 },
    })).toThrow('unknown diagnosis type');
  });

  it('throws when diagnosis.confidence is missing', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'LOW_CTR' },
      metrics: { ctr: 0.3 },
    })).toThrow('diagnosis.confidence must be a number between 0 and 1');
  });

  it('throws when diagnosis.confidence is not a number', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'LOW_CTR', confidence: 'high' },
      metrics: { ctr: 0.3 },
    })).toThrow('diagnosis.confidence must be a number between 0 and 1');
  });

  it('throws when diagnosis.confidence > 1', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'LOW_CTR', confidence: 1.1 },
      metrics: { ctr: 0.3 },
    })).toThrow('diagnosis.confidence must be a number between 0 and 1');
  });

  it('throws when diagnosis.confidence < 0', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'LOW_CTR', confidence: -0.1 },
      metrics: { ctr: 0.3 },
    })).toThrow('diagnosis.confidence must be a number between 0 and 1');
  });

  it('accepts boundary confidence values 0 and 1', () => {
    const base = { type: 'LOW_CTR' };
    expect(() => generateRecommendations({ diagnosis: { ...base, confidence: 0 }, metrics: { ctr: 0.3 } })).not.toThrow();
    expect(() => generateRecommendations({ diagnosis: { ...base, confidence: 1 }, metrics: { ctr: 0.3 } })).not.toThrow();
  });

  it('throws when metrics is missing', () => {
    expect(() => generateRecommendations({ diagnosis: { type: 'LOW_CTR', confidence: 0.7 } }))
      .toThrow('metrics must be a non-null object');
  });

  it('throws when metrics is null', () => {
    expect(() => generateRecommendations({ diagnosis: { type: 'LOW_CTR', confidence: 0.7 }, metrics: null }))
      .toThrow('metrics must be a non-null object');
  });

  it('throws when a metric field is not a number', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'LOW_CTR', confidence: 0.7 },
      metrics: { ctr: 'low' },
    })).toThrow('metrics.ctr must be a finite number if provided');
  });

  it('throws when a metric field is negative', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'LOW_CTR', confidence: 0.7 },
      metrics: { spend: -10 },
    })).toThrow('metrics.spend must be non-negative');
  });

  it('accepts empty metrics object (all fields optional)', () => {
    expect(() => generateRecommendations({
      diagnosis: { type: 'HEALTHY', confidence: 1.0 },
      metrics: {},
    })).not.toThrow();
  });
});

// ── Output shape ────────────────────────────────────────────
describe('generateRecommendations — output shape', () => {
  it('returns { diagnosis, confidence, recommendations }', () => {
    const result = generateRecommendations(FATIGUE_INPUT);
    expect(result).toHaveProperty('diagnosis');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('recommendations');
  });

  it('diagnosis in output matches diagnosis.type from input', () => {
    const result = generateRecommendations(FATIGUE_INPUT);
    expect(result.diagnosis).toBe('CREATIVE_FATIGUE');
  });

  it('confidence in output matches diagnosis.confidence from input', () => {
    const result = generateRecommendations(FATIGUE_INPUT);
    expect(result.confidence).toBe(0.85);
  });

  it('recommendations is a non-empty array', () => {
    const result = generateRecommendations(FATIGUE_INPUT);
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('each recommendation has type, priority, rationale', () => {
    const result = generateRecommendations(FATIGUE_INPUT);
    for (const rec of result.recommendations) {
      expect(rec).toHaveProperty('type');
      expect(rec).toHaveProperty('priority');
      expect(rec).toHaveProperty('rationale');
    }
  });

  it('rationale is a non-empty string on every recommendation', () => {
    const result = generateRecommendations(FATIGUE_INPUT);
    for (const rec of result.recommendations) {
      expect(typeof rec.rationale).toBe('string');
      expect(rec.rationale.length).toBeGreaterThan(0);
    }
  });
});

// ── Rule: CREATIVE_FATIGUE ──────────────────────────────────
describe('generateRecommendations — rule: CREATIVE_FATIGUE', () => {
  it('returns exactly 3 recommendations', () => {
    const { recommendations } = generateRecommendations(FATIGUE_INPUT);
    expect(recommendations).toHaveLength(3);
  });

  it('first recommendation is REFRESH_HOOK with HIGH priority', () => {
    const { recommendations } = generateRecommendations(FATIGUE_INPUT);
    expect(recommendations[0].type).toBe(REC_TYPE.REFRESH_HOOK);
    expect(recommendations[0].priority).toBe(PRIORITY.HIGH);
  });

  it('second recommendation is ROTATE_CREATIVE with HIGH priority', () => {
    const { recommendations } = generateRecommendations(FATIGUE_INPUT);
    expect(recommendations[1].type).toBe(REC_TYPE.ROTATE_CREATIVE);
    expect(recommendations[1].priority).toBe(PRIORITY.HIGH);
  });

  it('third recommendation is TEST_NEW_ANGLE with MEDIUM priority', () => {
    const { recommendations } = generateRecommendations(FATIGUE_INPUT);
    expect(recommendations[2].type).toBe(REC_TYPE.TEST_NEW_ANGLE);
    expect(recommendations[2].priority).toBe(PRIORITY.MEDIUM);
  });

  it('rationale includes ctr and frequency values from metrics', () => {
    const { recommendations } = generateRecommendations(FATIGUE_INPUT);
    expect(recommendations[0].rationale).toMatch(/0\.70/);
    expect(recommendations[0].rationale).toMatch(/4\.2/);
  });
});

// ── Rule: AUDIENCE_MISMATCH ─────────────────────────────────
describe('generateRecommendations — rule: AUDIENCE_MISMATCH', () => {
  const input = {
    diagnosis: { type: 'AUDIENCE_MISMATCH', confidence: 0.80 },
    metrics:   { cpc: 3.20, spend: 250 },
  };

  it('returns exactly 2 recommendations', () => {
    expect(generateRecommendations(input).recommendations).toHaveLength(2);
  });

  it('first recommendation is TEST_NEW_ANGLE with HIGH priority', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].type).toBe(REC_TYPE.TEST_NEW_ANGLE);
    expect(recommendations[0].priority).toBe(PRIORITY.HIGH);
  });

  it('second recommendation is ROTATE_CREATIVE with MEDIUM priority', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[1].type).toBe(REC_TYPE.ROTATE_CREATIVE);
    expect(recommendations[1].priority).toBe(PRIORITY.MEDIUM);
  });

  it('rationale includes CPC value from metrics', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].rationale).toMatch(/3\.20/);
  });
});

// ── Rule: INEFFICIENT_SCALING ───────────────────────────────
describe('generateRecommendations — rule: INEFFICIENT_SCALING', () => {
  const input = {
    diagnosis: { type: 'INEFFICIENT_SCALING', confidence: 0.75 },
    metrics:   { spend: 500, conversions: 7 },
  };

  it('returns exactly 2 recommendations', () => {
    expect(generateRecommendations(input).recommendations).toHaveLength(2);
  });

  it('first recommendation is REDUCE_BUDGET with HIGH priority', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].type).toBe(REC_TYPE.REDUCE_BUDGET);
    expect(recommendations[0].priority).toBe(PRIORITY.HIGH);
  });

  it('second recommendation is TEST_NEW_ANGLE with MEDIUM priority', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[1].type).toBe(REC_TYPE.TEST_NEW_ANGLE);
    expect(recommendations[1].priority).toBe(PRIORITY.MEDIUM);
  });

  it('rationale includes spend value from metrics', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].rationale).toMatch(/500\.00/);
  });
});

// ── Rule: LOW_CTR ───────────────────────────────────────────
describe('generateRecommendations — rule: LOW_CTR', () => {
  const input = {
    diagnosis: { type: 'LOW_CTR', confidence: 0.70 },
    metrics:   { ctr: 0.3, spend: 80 },
  };

  it('returns exactly 2 recommendations', () => {
    expect(generateRecommendations(input).recommendations).toHaveLength(2);
  });

  it('first recommendation is REFRESH_HOOK with HIGH priority', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].type).toBe(REC_TYPE.REFRESH_HOOK);
    expect(recommendations[0].priority).toBe(PRIORITY.HIGH);
  });

  it('second recommendation is TEST_NEW_ANGLE with MEDIUM priority', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[1].type).toBe(REC_TYPE.TEST_NEW_ANGLE);
    expect(recommendations[1].priority).toBe(PRIORITY.MEDIUM);
  });

  it('rationale includes CTR value from metrics', () => {
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].rationale).toMatch(/0\.30/);
  });
});

// ── Rule: HEALTHY ───────────────────────────────────────────
describe('generateRecommendations — rule: HEALTHY', () => {
  it('spend < $100 → 1 recommendation: HOLD_STEADY with HIGH priority', () => {
    const { recommendations } = generateRecommendations(HEALTHY_LOW);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].type).toBe(REC_TYPE.HOLD_STEADY);
    expect(recommendations[0].priority).toBe(PRIORITY.HIGH);
  });

  it('spend >= $100 → 2 recommendations: DUPLICATE_WINNER (MEDIUM) + HOLD_STEADY (LOW)', () => {
    const { recommendations } = generateRecommendations(HEALTHY_HIGH);
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0].type).toBe(REC_TYPE.DUPLICATE_WINNER);
    expect(recommendations[0].priority).toBe(PRIORITY.MEDIUM);
    expect(recommendations[1].type).toBe(REC_TYPE.HOLD_STEADY);
    expect(recommendations[1].priority).toBe(PRIORITY.LOW);
  });

  it('spend === $100 (boundary) → DUPLICATE_WINNER fires', () => {
    const input = { diagnosis: { type: 'HEALTHY', confidence: 1.0 }, metrics: { spend: 100 } };
    const { recommendations } = generateRecommendations(input);
    expect(recommendations[0].type).toBe(REC_TYPE.DUPLICATE_WINNER);
  });

  it('spend === 0 → HOLD_STEADY only', () => {
    const input = { diagnosis: { type: 'HEALTHY', confidence: 1.0 }, metrics: { spend: 0 } };
    const { recommendations } = generateRecommendations(input);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].type).toBe(REC_TYPE.HOLD_STEADY);
  });

  it('DUPLICATE_WINNER rationale includes spend value', () => {
    const { recommendations } = generateRecommendations(HEALTHY_HIGH);
    expect(recommendations[0].rationale).toMatch(/200\.00/);
  });
});

// ── No duplicate recommendation types ──────────────────────
describe('generateRecommendations — no duplicates', () => {
  const DIAGNOSIS_TYPES = [
    'CREATIVE_FATIGUE', 'AUDIENCE_MISMATCH', 'INEFFICIENT_SCALING', 'LOW_CTR',
  ];

  it.each(DIAGNOSIS_TYPES)('%s has no duplicate recommendation types', (diagType) => {
    const result = generateRecommendations({
      diagnosis: { type: diagType, confidence: 0.80 },
      metrics:   { ctr: 0.7, cpc: 2.50, spend: 150, frequency: 3.5, conversions: 2 },
    });
    const types = result.recommendations.map(r => r.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it('HEALTHY (low spend) has no duplicate recommendation types', () => {
    const { recommendations } = generateRecommendations(HEALTHY_LOW);
    const types = recommendations.map(r => r.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('HEALTHY (high spend) has no duplicate recommendation types', () => {
    const { recommendations } = generateRecommendations(HEALTHY_HIGH);
    const types = recommendations.map(r => r.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

// ── Determinism ─────────────────────────────────────────────
describe('generateRecommendations — determinism', () => {
  it('same input → identical output on repeated calls', () => {
    const a = generateRecommendations(FATIGUE_INPUT);
    const b = generateRecommendations(FATIGUE_INPUT);
    expect(a).toEqual(b);
  });

  it('does not mutate the input object', () => {
    const input = Object.freeze({
      diagnosis: Object.freeze({ type: 'LOW_CTR', confidence: 0.7 }),
      metrics:   Object.freeze({ ctr: 0.3 }),
    });
    expect(() => generateRecommendations(input)).not.toThrow();
  });

  it('different diagnosis types produce different recommendation sets', () => {
    const fatigueRecs = generateRecommendations(FATIGUE_INPUT).recommendations.map(r => r.type);
    const mismatchRecs = generateRecommendations({
      diagnosis: { type: 'AUDIENCE_MISMATCH', confidence: 0.80 },
      metrics:   { cpc: 3.20, spend: 250 },
    }).recommendations.map(r => r.type);
    expect(fatigueRecs).not.toEqual(mismatchRecs);
  });

  it('confidence passes through unchanged regardless of value', () => {
    const result = generateRecommendations({ ...FATIGUE_INPUT, diagnosis: { type: 'CREATIVE_FATIGUE', confidence: 0.42 } });
    expect(result.confidence).toBe(0.42);
  });
});

// ── Fixture verification ────────────────────────────────────
describe('generateRecommendations — canonical fixture contracts', () => {
  it.each(SCENARIOS)('$name → $expected.recommendationTypes', ({ input, expected }) => {
    const result = generateRecommendations(input);
    expect(result.diagnosis).toBe(expected.diagnosis);
    expect(result.confidence).toBe(expected.confidence);
    expect(result.recommendations).toHaveLength(expected.recommendationCount);
    expect(result.recommendations.map(r => r.type)).toEqual(expected.recommendationTypes);
    expect(result.recommendations.map(r => r.priority)).toEqual(expected.priorities);
  });
});
