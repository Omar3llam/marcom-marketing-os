// ============================================================
// Diagnosis Engine — canonical evaluation harness
// ============================================================
// Frozen scenarios that define the reasoning contract.
// Every scenario must produce exactly the expected output
// for all future changes to remain valid.
//
// `objective` is optional; omitted means "unknown", which resolves to the
// DEFAULT benchmark band (ctr weak 0.8 / strong 1.5) — never to a global floor.
//
// Money is in MINOR UNITS and in CURRENCY UNITS, not dollars. `spend`/`cpc`
// (major) are carried alongside because the verdict thresholds still read them;
// the diagnosis rules read the `*Minor` fields only.
//
// Run via DiagnosisEngine.test.js fixture verification suite.
// ============================================================

export const SCENARIOS = [
  // ── 1 ── textbook creative fatigue ─────────────────────────
  {
    name:        'creative_fatigue_textbook',
    description: 'Frequency well past the ceiling + CTR under the objective bar',
    input:       { ctr: 0.7, cpc: 1.20, cpm: 8.0, frequency: 4.5, spend: 420, conversions: 8, spendMinor: 42_000, cpcMinor: 120, currency: 'USD' },
    expected:    { signalType: 'CREATIVE_FATIGUE', diagnosis: 'creative_fatigue', confidence: 0.85 },
  },

  // ── 2 ── creative fatigue exactly at the ceiling ───────────
  // Was frequency 3.1 against a 3.0 ceiling. The ceiling is now the verdict
  // engine's own 3.5 (the two used to disagree about the same ad), so this
  // scenario pins the NEW boundary: 3.5 is inclusive and still fatigue.
  // Scenario 11 covers the value that used to fire and no longer does.
  {
    name:        'creative_fatigue_boundary',
    description: 'Frequency exactly at the 3.5 ceiling, CTR under the bar — rule fires (>= is inclusive)',
    input:       { ctr: 0.9, cpc: 1.50, cpm: 9.0, frequency: 3.5, spend: 180, conversions: 4, spendMinor: 18_000, cpcMinor: 150, currency: 'USD' },
    expected:    { signalType: 'CREATIVE_FATIGUE', diagnosis: 'creative_fatigue', confidence: 0.85 },
  },

  // ── 3 ── audience mismatch — high CPC, low conversion rate ─
  {
    name:        'audience_mismatch_high_cpc',
    description: 'CPC above threshold, spend meaningful, only 1 conversion from 100 clicks',
    input:       { ctr: 1.2, cpc: 3.50, cpm: 12.0, frequency: 2.0, spend: 350, conversions: 1, spendMinor: 35_000, cpcMinor: 350, currency: 'USD' },
    expected:    { signalType: 'AUDIENCE_MISMATCH', diagnosis: 'audience_mismatch', confidence: 0.80 },
  },

  // ── 4 ── audience mismatch — zero conversions ───────────────
  {
    name:        'audience_mismatch_zero_conversions',
    description: 'High CPC, meaningful spend, zero conversions — classic targeting miss',
    input:       { ctr: 1.1, cpc: 2.50, cpm: 10.0, frequency: 1.8, spend: 150, conversions: 0, spendMinor: 15_000, cpcMinor: 250, currency: 'USD' },
    expected:    { signalType: 'AUDIENCE_MISMATCH', diagnosis: 'audience_mismatch', confidence: 0.80 },
  },

  // ── 5 ── inefficient scaling ────────────────────────────────
  {
    name:        'inefficient_scaling_clear',
    description: 'High spend, some conversions, cost-per-conversion above the 50-unit target',
    input:       { ctr: 1.5, cpc: 1.20, cpm: 7.0, frequency: 2.0, spend: 500, conversions: 8, spendMinor: 50_000, cpcMinor: 120, currency: 'USD' },
    expected:    { signalType: 'INEFFICIENT_SCALING', diagnosis: 'inefficient_scaling', confidence: 0.75 },
  },

  // ── 6 ── low CTR / weak hook ────────────────────────────────
  {
    name:        'low_ctr_weak_hook',
    description: 'CTR well below the DEFAULT 0.8% weak bar — hook not capturing attention',
    input:       { ctr: 0.3, cpc: 0.80, cpm: 6.0, frequency: 1.5, spend: 80, conversions: 4, spendMinor: 8_000, cpcMinor: 80, currency: 'USD' },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },

  // ── 7 ── low CTR at boundary ────────────────────────────────
  {
    name:        'low_ctr_boundary',
    description: 'CTR 0.4% — under the DEFAULT 0.8% bar, rule fires',
    input:       { ctr: 0.4, cpc: 1.00, cpm: 7.0, frequency: 2.0, spend: 60, conversions: 3, spendMinor: 6_000, cpcMinor: 100, currency: 'USD' },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },

  // ── 8 ── healthy campaign ───────────────────────────────────
  // confidence 0.97, not 1.0: platform attribution error is invisible from here,
  // so certainty is never honest (confidenceEngine.MAX_CONFIDENCE).
  {
    name:        'healthy_campaign',
    description: 'All metrics within normal parameters — rules ran, none fired',
    input:       { ctr: 1.8, cpc: 0.90, cpm: 5.0, frequency: 1.5, spend: 100, conversions: 8, spendMinor: 10_000, cpcMinor: 90, currency: 'USD' },
    expected:    { signalType: 'HEALTHY', diagnosis: 'healthy', confidence: 0.97 },
  },

  // ── 9 ── priority: fatigue over mismatch ────────────────────
  {
    name:        'creative_fatigue_priority_over_mismatch',
    description: 'Both fatigue AND mismatch conditions met — CREATIVE_FATIGUE wins (higher priority)',
    input:       { ctr: 0.6, cpc: 3.20, cpm: 14.0, frequency: 4.0, spend: 320, conversions: 1, spendMinor: 32_000, cpcMinor: 320, currency: 'USD' },
    expected:    { signalType: 'CREATIVE_FATIGUE', diagnosis: 'creative_fatigue', confidence: 0.85 },
  },

  // ── 10 ── low spend suppresses efficiency rules ─────────────
  {
    name:        'low_spend_suppresses_mismatch',
    description: 'High CPC + zero conversions but spend under the 50-unit floor — efficiency rules suppressed, LOW_CTR fires instead',
    input:       { ctr: 0.4, cpc: 3.00, cpm: 15.0, frequency: 1.5, spend: 30, conversions: 0, spendMinor: 3_000, cpcMinor: 300, currency: 'USD' },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },

  // ── 11 ── the old 3.0 ceiling no longer fires ───────────────
  // This exact input WAS diagnosed CREATIVE_FATIGUE while the verdict engine,
  // reading the same row against 3.5, called it healthy. One ceiling now.
  {
    name:        'frequency_below_ceiling_is_not_fatigue',
    description: 'Frequency 3.1 — past the retired 3.0 constant, under the real 3.5 ceiling',
    input:       { ctr: 0.9, cpc: 1.50, cpm: 9.0, frequency: 3.1, spend: 180, conversions: 4, spendMinor: 18_000, cpcMinor: 150, currency: 'USD' },
    expected:    { signalType: 'HEALTHY', diagnosis: 'healthy', confidence: 0.97 },
  },

  // ── 12 ── objective decides what "low CTR" means ────────────
  // The same 0.6% CTR, judged twice. Under the retired global 0.5% floor both
  // read healthy; under DEFAULT (0.8%) the first is weak. An awareness campaign
  // earning 0.6% is performing exactly as its objective implies.
  {
    name:        'low_ctr_under_default_objective',
    description: 'CTR 0.6% with no known objective — under the DEFAULT 0.8% bar',
    input:       { ctr: 0.6, cpc: 0.50, cpm: 4.0, frequency: 1.2, spend: 80, conversions: 5, spendMinor: 8_000, cpcMinor: 50, currency: 'USD' },
    expected:    { signalType: 'LOW_CTR', diagnosis: 'weak_hook', confidence: 0.70 },
  },
  {
    name:        'same_ctr_is_healthy_for_awareness',
    description: 'The identical 0.6% CTR on OUTCOME_AWARENESS — above its 0.5% bar, no diagnosis',
    objective:   'OUTCOME_AWARENESS',
    input:       { ctr: 0.6, cpc: 0.50, cpm: 4.0, frequency: 1.2, spend: 80, conversions: 5, spendMinor: 8_000, cpcMinor: 50, currency: 'USD' },
    expected:    { signalType: 'HEALTHY', diagnosis: 'healthy', confidence: 0.97 },
  },

  // ── 13 ── nothing reported ──────────────────────────────────
  // No rule could be evaluated. Distinct from HEALTHY, which means rules RAN.
  {
    name:        'nothing_reported_is_undiagnosable',
    description: 'Every field absent — the engine says it could not look, not that all is well',
    input:       {},
    expected:    { signalType: 'UNDIAGNOSABLE', diagnosis: 'undiagnosable', confidence: 0 },
  },
];
