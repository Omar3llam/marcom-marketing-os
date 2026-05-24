// ============================================================
// Diagnosis Engine — canonical evaluation harness
// ============================================================
// 10 frozen scenarios that define the reasoning contract.
// Every scenario must produce exactly the expected output
// for all future changes to remain valid.
//
// Run via DiagnosisEngine.test.js fixture verification suite.
// ============================================================

export const SCENARIOS = [
  // ── 1 ── textbook creative fatigue ─────────────────────────
  {
    name:        'creative_fatigue_textbook',
    description: 'High frequency + low CTR — both fatigue signals strong',
    input:       { ctr: 0.7, cpc: 1.20, cpm: 8.0, frequency: 4.5, spend: 420, conversions: 8 },
    expected:    { signalType: 'CREATIVE_FATIGUE', diagnosis: 'creative_fatigue', confidence: 0.85 },
  },

  // ── 2 ── creative fatigue at boundary ──────────────────────
  {
    name:        'creative_fatigue_boundary',
    description: 'Frequency just over 3.0, CTR just under 1.0 — rule fires',
    input:       { ctr: 0.9, cpc: 1.50, cpm: 9.0, frequency: 3.1, spend: 180, conversions: 3 },
    expected:    { signalType: 'CREATIVE_FATIGUE', diagnosis: 'creative_fatigue', confidence: 0.85 },
  },

  // ── 3 ── audience mismatch — high CPC, low conversion rate ─
  {
    name:        'audience_mismatch_high_cpc',
    description: 'CPC above threshold, spend meaningful, only 1 conversion from 100 clicks',
    input:       { ctr: 1.2, cpc: 3.50, cpm: 12.0, frequency: 2.0, spend: 350, conversions: 1 },
    expected:    { signalType: 'AUDIENCE_MISMATCH', diagnosis: 'audience_mismatch', confidence: 0.80 },
  },

  // ── 4 ── audience mismatch — zero conversions ───────────────
  {
    name:        'audience_mismatch_zero_conversions',
    description: 'High CPC, meaningful spend, zero conversions — classic targeting miss',
    input:       { ctr: 1.1, cpc: 2.50, cpm: 10.0, frequency: 1.8, spend: 150, conversions: 0 },
    expected:    { signalType: 'AUDIENCE_MISMATCH', diagnosis: 'audience_mismatch', confidence: 0.80 },
  },

  // ── 5 ── inefficient scaling ────────────────────────────────
  {
    name:        'inefficient_scaling_clear',
    description: 'High spend, some conversions, but cost-per-conversion exceeds $50 target',
    input:       { ctr: 1.5, cpc: 1.20, cpm: 7.0, frequency: 2.0, spend: 500, conversions: 8 },
    expected:    { signalType: 'INEFFICIENT_SCALING', diagnosis: 'inefficient_scaling', confidence: 0.75 },
  },

  // ── 6 ── low CTR / weak hook ────────────────────────────────
  {
    name:        'low_ctr_weak_hook',
    description: 'CTR well below 0.5% — creative hook not capturing attention',
    input:       { ctr: 0.3, cpc: 0.80, cpm: 6.0, frequency: 1.5, spend: 80, conversions: 4 },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },

  // ── 7 ── low CTR at boundary ────────────────────────────────
  {
    name:        'low_ctr_boundary',
    description: 'CTR at 0.4% — just below 0.5% threshold, rule fires',
    input:       { ctr: 0.4, cpc: 1.00, cpm: 7.0, frequency: 2.0, spend: 60, conversions: 3 },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },

  // ── 8 ── healthy campaign ───────────────────────────────────
  {
    name:        'healthy_campaign',
    description: 'All metrics within normal parameters — no rule fires',
    input:       { ctr: 1.8, cpc: 0.90, cpm: 5.0, frequency: 1.5, spend: 100, conversions: 8 },
    expected:    { signalType: 'HEALTHY', diagnosis: 'healthy', confidence: 1.0 },
  },

  // ── 9 ── priority: fatigue over mismatch ────────────────────
  {
    name:        'creative_fatigue_priority_over_mismatch',
    description: 'Both fatigue AND mismatch conditions met — CREATIVE_FATIGUE wins (higher priority)',
    input:       { ctr: 0.6, cpc: 3.20, cpm: 14.0, frequency: 4.0, spend: 320, conversions: 1 },
    expected:    { signalType: 'CREATIVE_FATIGUE', diagnosis: 'creative_fatigue', confidence: 0.85 },
  },

  // ── 10 ── low spend suppresses efficiency rules ─────────────
  {
    name:        'low_spend_suppresses_mismatch',
    description: 'High CPC + zero conversions but spend < $50 floor — mismatch rule suppressed, LOW_CTR fires instead',
    input:       { ctr: 0.4, cpc: 3.00, cpm: 15.0, frequency: 1.5, spend: 30, conversions: 0 },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },
];
