// ============================================================
// Recommendation Engine — canonical evaluation harness
// ============================================================
// 10 frozen scenarios that define the recommendation contract.
// Every scenario must produce exactly the expected output
// for all future changes to remain valid.
//
// Run via RecommendationEngine.test.js fixture verification suite.
// ============================================================

export const SCENARIOS = [
  // ── 1 ── full creative fatigue recommendation set ───────────
  {
    name:        'creative_fatigue_full',
    description: 'CREATIVE_FATIGUE → 3 recommendations in priority order',
    input: {
      diagnosis: { type: 'CREATIVE_FATIGUE', confidence: 0.85 },
      metrics:   { ctr: 0.7, frequency: 4.2, spend: 120 },
    },
    expected: {
      diagnosis:            'CREATIVE_FATIGUE',
      confidence:           0.85,
      recommendationCount:  3,
      recommendationTypes:  ['REFRESH_HOOK', 'ROTATE_CREATIVE', 'TEST_NEW_ANGLE'],
      priorities:           ['HIGH', 'HIGH', 'MEDIUM'],
    },
  },

  // ── 2 ── audience mismatch standard ─────────────────────────
  {
    name:        'audience_mismatch_standard',
    description: 'AUDIENCE_MISMATCH → 2 recommendations, TEST_NEW_ANGLE leads',
    input: {
      diagnosis: { type: 'AUDIENCE_MISMATCH', confidence: 0.80 },
      metrics:   { ctr: 1.1, cpc: 3.20, spend: 250 },
    },
    expected: {
      diagnosis:            'AUDIENCE_MISMATCH',
      confidence:           0.80,
      recommendationCount:  2,
      recommendationTypes:  ['TEST_NEW_ANGLE', 'ROTATE_CREATIVE'],
      priorities:           ['HIGH', 'MEDIUM'],
    },
  },

  // ── 3 ── inefficient scaling standard ───────────────────────
  {
    name:        'inefficient_scaling_standard',
    description: 'INEFFICIENT_SCALING → REDUCE_BUDGET first, then TEST_NEW_ANGLE',
    input: {
      diagnosis: { type: 'INEFFICIENT_SCALING', confidence: 0.75 },
      metrics:   { ctr: 1.4, cpc: 1.10, spend: 500, conversions: 7 },
    },
    expected: {
      diagnosis:            'INEFFICIENT_SCALING',
      confidence:           0.75,
      recommendationCount:  2,
      recommendationTypes:  ['REDUCE_BUDGET', 'TEST_NEW_ANGLE'],
      priorities:           ['HIGH', 'MEDIUM'],
    },
  },

  // ── 4 ── low CTR / weak hook ─────────────────────────────────
  {
    name:        'low_ctr_standard',
    description: 'LOW_CTR → REFRESH_HOOK first, then TEST_NEW_ANGLE',
    input: {
      diagnosis: { type: 'LOW_CTR', confidence: 0.70 },
      metrics:   { ctr: 0.3, cpc: 0.80, spend: 80 },
    },
    expected: {
      diagnosis:            'LOW_CTR',
      confidence:           0.70,
      recommendationCount:  2,
      recommendationTypes:  ['REFRESH_HOOK', 'TEST_NEW_ANGLE'],
      priorities:           ['HIGH', 'MEDIUM'],
    },
  },

  // ── 5 ── healthy campaign — low spend ────────────────────────
  {
    name:        'healthy_low_spend',
    description: 'HEALTHY + spend < $100 → HOLD_STEADY only (no duplication)',
    input: {
      diagnosis: { type: 'HEALTHY', confidence: 1.0 },
      metrics:   { ctr: 1.8, cpc: 0.90, spend: 50 },
    },
    expected: {
      diagnosis:            'HEALTHY',
      confidence:           1.0,
      recommendationCount:  1,
      recommendationTypes:  ['HOLD_STEADY'],
      priorities:           ['HIGH'],
    },
  },

  // ── 6 ── healthy campaign — high spend ───────────────────────
  {
    name:        'healthy_high_spend',
    description: 'HEALTHY + spend >= $100 → DUPLICATE_WINNER + HOLD_STEADY',
    input: {
      diagnosis: { type: 'HEALTHY', confidence: 1.0 },
      metrics:   { ctr: 1.8, cpc: 0.90, spend: 200 },
    },
    expected: {
      diagnosis:            'HEALTHY',
      confidence:           1.0,
      recommendationCount:  2,
      recommendationTypes:  ['DUPLICATE_WINNER', 'HOLD_STEADY'],
      priorities:           ['MEDIUM', 'LOW'],
    },
  },

  // ── 7 ── healthy campaign — spend exactly at boundary ────────
  {
    name:        'healthy_at_spend_boundary',
    description: 'HEALTHY + spend === $100 (boundary) → DUPLICATE_WINNER fires',
    input: {
      diagnosis: { type: 'HEALTHY', confidence: 1.0 },
      metrics:   { ctr: 1.9, cpc: 0.85, spend: 100 },
    },
    expected: {
      diagnosis:            'HEALTHY',
      confidence:           1.0,
      recommendationCount:  2,
      recommendationTypes:  ['DUPLICATE_WINNER', 'HOLD_STEADY'],
      priorities:           ['MEDIUM', 'LOW'],
    },
  },

  // ── 8 ── confidence flows through unchanged ──────────────────
  {
    name:        'creative_fatigue_high_confidence',
    description: 'Confidence from input is preserved verbatim in output — does not affect recommendation set',
    input: {
      diagnosis: { type: 'CREATIVE_FATIGUE', confidence: 0.95 },
      metrics:   { ctr: 0.5, frequency: 3.8, spend: 300 },
    },
    expected: {
      diagnosis:            'CREATIVE_FATIGUE',
      confidence:           0.95,
      recommendationCount:  3,
      recommendationTypes:  ['REFRESH_HOOK', 'ROTATE_CREATIVE', 'TEST_NEW_ANGLE'],
      priorities:           ['HIGH', 'HIGH', 'MEDIUM'],
    },
  },

  // ── 9 ── audience mismatch — very high CPC ───────────────────
  {
    name:        'audience_mismatch_high_cpc',
    description: 'AUDIENCE_MISMATCH with extreme CPC — same recommendation structure',
    input: {
      diagnosis: { type: 'AUDIENCE_MISMATCH', confidence: 0.80 },
      metrics:   { ctr: 0.9, cpc: 4.50, spend: 450, conversions: 0 },
    },
    expected: {
      diagnosis:            'AUDIENCE_MISMATCH',
      confidence:           0.80,
      recommendationCount:  2,
      recommendationTypes:  ['TEST_NEW_ANGLE', 'ROTATE_CREATIVE'],
      priorities:           ['HIGH', 'MEDIUM'],
    },
  },

  // ── 10 ── healthy campaign — zero spend ──────────────────────
  {
    name:        'healthy_zero_spend',
    description: 'HEALTHY + spend === 0 → HOLD_STEADY only (duplication threshold not met)',
    input: {
      diagnosis: { type: 'HEALTHY', confidence: 1.0 },
      metrics:   { ctr: 1.5, cpc: 0.75, spend: 0 },
    },
    expected: {
      diagnosis:            'HEALTHY',
      confidence:           1.0,
      recommendationCount:  1,
      recommendationTypes:  ['HOLD_STEADY'],
      priorities:           ['HIGH'],
    },
  },
];
