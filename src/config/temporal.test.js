// ============================================================
// R2 — temporal honesty
// ============================================================
// R2 renames things. The danger in a rename is not that it breaks loudly — it is
// that a production environment which sets the OLD variable silently reverts to
// a default, and the only symptom is a consumer quietly reading a different
// number of days than the operator asked for. Nothing throws. Nothing logs.
//
// Whether production sets any of these is UNKNOWN — none appear in .env.example,
// CI config, or any test. So the alias is not a courtesy, it is the only
// resolution that cannot change a running deployment, and these tests exist to
// keep it that way.
//
// The precedence tests inject `env` rather than mutating process.env and
// re-importing: module-load reads would need vi.resetModules() to re-trigger,
// and that segfaults the forks pool (found by exclusion in #196). An injectable
// parameter makes the same assertions without going near it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDays, TEMPORAL } from './temporal.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

// The complete rename table. Every entry is (new name, legacy name, the exact
// default the call site had before R2 touched it).
const RENAMES = [
  ['ENTITY_SNAPSHOT_SYNC_RECENCY_DAYS',  'ENTITY_SNAPSHOT_WINDOW_DAYS',    90,  'entitySnapshotSyncRecencyDays'],
  ['PATTERN_SYNC_RECENCY_DAYS',          'PATTERN_LOOKBACK_DAYS',          365, 'patternSyncRecencyDays'],
  ['GUARDRAIL_SYNC_RECENCY_DAYS',        'GUARDRAIL_LOOKBACK_DAYS',        14,  'guardrailSyncRecencyDays'],
  ['TEST_GENERATOR_SYNC_RECENCY_DAYS',   'TEST_GENERATOR_LOOKBACK_DAYS',   14,  'testGeneratorSyncRecencyDays'],
  ['BLENDED_TRUTH_SYNC_RECENCY_DAYS',    'BLENDED_TRUTH_LOOKBACK_DAYS',    30,  'blendedTruthSyncRecencyDays'],
  ['PLAN_ACTUALS_SYNC_RECENCY_DAYS',     'PLAN_ACTUALS_LOOKBACK_DAYS',     60,  'planActualsSyncRecencyDays'],
  ['FATIGUE_SYNC_RECENCY_DAYS',          'FATIGUE_LOOKBACK_DAYS',          30,  'fatigueSyncRecencyDays'],
  ['SCENARIO_FATIGUE_SYNC_RECENCY_DAYS', 'SCENARIO_FATIGUE_LOOKBACK_DAYS', 30,  'scenarioFatigueSyncRecencyDays'],
  ['LOOP_ACTIVITY_RECENCY_DAYS',         'LOOP_LOOKBACK_DAYS',             30,  'loopActivityRecencyDays'],
];

describe('R2 — temporal configuration', () => {
  // ── Tests 1–4: precedence ────────────────────────────────────────────────
  describe('resolution order: new → legacy → default', () => {
    it.each(RENAMES)('%s — new variable is used when present', (next, legacy, fallback) => {
      expect(resolveDays({ next, legacy, fallback, env: { [next]: '7' } })).toBe(7);
    });

    it.each(RENAMES)('%s — legacy variable is honoured when the new one is absent', (next, legacy, fallback) => {
      // THE TEST THAT MATTERS. A production deployment setting only the old name
      // must keep the value it configured, not silently fall to the default.
      expect(resolveDays({ next, legacy, fallback, env: { [legacy]: '11' } })).toBe(11);
      expect(resolveDays({ next, legacy, fallback, env: { [legacy]: '11' } })).not.toBe(fallback);
    });

    it.each(RENAMES)('%s — the new variable wins when both are set', (next, legacy, fallback) => {
      expect(resolveDays({ next, legacy, fallback, env: { [next]: '5', [legacy]: '99' } })).toBe(5);
    });

    it.each(RENAMES)('%s — the default applies when neither is set', (next, legacy, fallback) => {
      expect(resolveDays({ next, legacy, fallback, env: {} })).toBe(fallback);
    });
  });

  // ── Test 5: behaviour parity ─────────────────────────────────────────────
  describe('parity with the pre-R2 call sites', () => {
    it.each(RENAMES)('%s — the resolved default is byte-for-byte the old number', (next, legacy, fallback, key) => {
      expect(TEMPORAL[key]).toBe(fallback);
    });

    // `||` not `??`, at every step. The two disagree on a state a real
    // environment can be in, and `??` would silently turn it into zero days.
    it('an empty-string variable falls through to the default, exactly as before', () => {
      expect(resolveDays({ next: 'A', legacy: 'B', fallback: 30, env: { A: '', B: '' } })).toBe(30);
      expect(resolveDays({ next: 'A', legacy: 'B', fallback: 30, env: { A: '' } })).toBe(30);
      // An empty NEW falls through to a set LEGACY rather than to the default.
      expect(resolveDays({ next: 'A', legacy: 'B', fallback: 30, env: { A: '', B: '45' } })).toBe(45);
    });

    it('an explicit "0" is still honoured, exactly as before', () => {
      expect(resolveDays({ next: 'A', legacy: 'B', fallback: 30, env: { B: '0' } })).toBe(0);
    });

    it('reads process.env when no env is injected', () => {
      expect(resolveDays({ next: 'R2_ABSENT_NEW', legacy: 'R2_ABSENT_OLD', fallback: 42 })).toBe(42);
    });
  });

  // ── Negative Control D: no consumer switched what it bounds ──────────────
  describe('every consumer still bounds what it bounded before', () => {
    const SYNC_RECENCY_CONSUMERS = [
      ['services/entity-graph/EntityGraphService.js',        'entitySnapshotSyncRecencyDays'],
      ['services/pattern-engine/PatternService.js',          'patternSyncRecencyDays'],
      ['services/guardrail-engine/GuardrailSweepService.js', 'guardrailSyncRecencyDays'],
      ['services/test-generator/TestGeneratorService.js',    'testGeneratorSyncRecencyDays'],
      ['services/blended-truth/BlendedTruthService.js',      'blendedTruthSyncRecencyDays'],
      ['services/planning/PlanService.js',                   'planActualsSyncRecencyDays'],
      ['services/analysis/FatigueForecastService.js',        'fatigueSyncRecencyDays'],
      ['services/fatigue-forecaster/FatigueSweepService.js', 'fatigueSyncRecencyDays'],
      ['services/scenario-engine/ScenarioService.js',        'scenarioFatigueSyncRecencyDays'],
    ];

    it.each(SYNC_RECENCY_CONSUMERS)('%s reads its bound from the shared config', (file, key) => {
      const src = read(file);
      expect(src).toMatch(new RegExp(`TEMPORAL\\.${key}\\b`));
      // No consumer keeps a private door to the environment for its lookback.
      expect(src).not.toMatch(/process\.env\.\w*LOOKBACK\w*/);
      expect(src).not.toMatch(/process\.env\.ENTITY_SNAPSHOT_WINDOW_DAYS/);
    });

    it.each(SYNC_RECENCY_CONSUMERS)('%s still filters on `date`, the sync timestamp', (file) => {
      // The rename must not have moved anyone onto windowStart/windowEnd — that
      // would be the measurement-period change R2 explicitly does not make.
      const src = read(file);
      expect(src).not.toMatch(/windowStart:\s*\{\s*gte/);
      expect(src).not.toMatch(/windowEnd:\s*\{\s*lte/);
    });

    it('the agentic loop is named for ACTIVITY, not sync recency', () => {
      // It bounds executedAt/createdAt on real events and never reads
      // MetricSnapshot. Naming it a sync bound would be a new inaccuracy.
      const src = read('services/agentic-loop/AgenticLoopService.js');
      expect(src).toMatch(/TEMPORAL\.loopActivityRecencyDays/);
      expect(src).not.toMatch(/SYNC_RECENCY/);
      expect(src).not.toMatch(/prisma\.metricSnapshot/);
    });
  });

  // ── Negative Control E: the canonical verdict path is untouched ──────────
  describe('the frozen verdict contract is not in this module', () => {
    it('does not define, alias, or expose the canonical verdict window', () => {
      const src = read('config/temporal.js');
      expect(src).not.toMatch(/CANONICAL_VERDICT_WINDOW_DAYS\s*=/);
      expect(Object.keys(TEMPORAL).join(',')).not.toMatch(/canonicalVerdict/i);
    });

    it('leaves CANONICAL_VERDICT_WINDOW_DAYS hard-coded and unconfigurable', () => {
      // A measurement period, not a recency bound. It must stay a constant: an
      // env var here would let a deployment redefine what a verdict measures.
      const src = read('services/verdict-engine/metricWindow.js');
      expect(src).toMatch(/export const CANONICAL_VERDICT_WINDOW_DAYS = 30;/);
      expect(src).not.toMatch(/CANONICAL_VERDICT_WINDOW_DAYS\s*=\s*Number\(/);
      expect(src).not.toMatch(/TEMPORAL/);
    });
  });
});
