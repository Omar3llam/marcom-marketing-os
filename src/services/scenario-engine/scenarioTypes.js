// ============================================================
// Scenario engine — shared types + frozen tuning constants
// ============================================================
// Kept in a sibling module (NOT in scenarioEngine.js) so services and
// routes can import the enums without pulling the engine, and so the
// engine's import graph links cleanly under Node ESM. (Phase-5 lesson:
// a status enum living in the wrong module is a startup crash.)
// ============================================================

// The three forward-looking questions a strategist actually asks. All
// three ride the SAME retention-triplet machinery — only where the
// moved/added/removed spend lands differs.
export const SCENARIO_TYPE = Object.freeze({
  CHANNEL_REALLOCATION: 'CHANNEL_REALLOCATION', // same total, shift between channels
  BUDGET_EXPANSION:     'BUDGET_EXPANSION',     // total up
  BUDGET_CONTRACTION:   'BUDGET_CONTRACTION',   // total down
});

// The honesty core: the RISKY spend (moved/added) is projected under
// three named, deterministic efficiency-retention assumptions. The
// range is [pessimistic, optimistic]; "expected" is the middle band.
export const RETENTION_BANDS = Object.freeze({
  pessimistic: Number(process.env.SCENARIO_RETENTION_PESSIMISTIC || 0.70),
  expected:    Number(process.env.SCENARIO_RETENTION_EXPECTED    || 0.85),
  optimistic:  Number(process.env.SCENARIO_RETENTION_OPTIMISTIC  || 1.00),
});

export const BAND_LABEL = Object.freeze({
  pessimistic: 'pessimistic',
  expected:    'expected',
  optimistic:  'optimistic',
});

// Expansion only: incremental spend beyond the current level buys worse
// marginal efficiency once the per-channel spend swing exceeds the knee.
// Added money honestly costs more — this is the whole point of modelling
// expansion (not just reallocation).
export const DIMINISHING_RETURNS_KNEE = Number(process.env.SCENARIO_DR_KNEE || 0.15);
export const DIMINISHING_RETURNS_SLOPE = Number(process.env.SCENARIO_DR_SLOPE || 0.5);
export const DIMINISHING_RETURNS_FLOOR = Number(process.env.SCENARIO_DR_FLOOR || 0.40);

// When the workspace has no learned memory yet, assume a modest prior
// rather than over-claiming. Lower accuracy ⇒ wider band.
export const DEFAULT_MEMORY_ACCURACY = Number(process.env.SCENARIO_DEFAULT_ACCURACY || 0.6);
export const MEMORY_WIDEN_MAX        = Number(process.env.SCENARIO_MEMORY_WIDEN_MAX || 0.5);
