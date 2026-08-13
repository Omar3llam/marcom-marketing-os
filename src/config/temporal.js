// ============================================================
// temporal — what every lookback in the system actually bounds
// ============================================================
// R2 of the System Design Refactor. This module renames nothing about what the
// code DOES. Every value below resolves to exactly what its consumer resolved to
// before, including the edge cases; the only thing that changes is that a reader
// can now tell what the number means.
//
// THE DISHONESTY THIS EXISTS TO REMOVE
// ------------------------------------
// Nine consumers held a constant called some variant of `LOOKBACK_DAYS` and used
// it as `MetricSnapshot.date >= now - N days`. `date` is the SYNC TIMESTAMP — the
// moment we wrote the row — and the row itself is a ROLLING_WINDOW aggregate over
// whatever period the sync happened to request.
//
// So `GUARDRAIL_LOOKBACK_DAYS = 14` never meant "fourteen days of delivery". It
// meant "rows we wrote in the last fourteen days", and each of those rows may
// hold 90 days, or Meta's full ~37-month retention, depending only on whether a
// cron tick or a human's Sync click wrote it last. A reader who assumed the
// obvious reading was wrong, and nothing in the name told them.
//
// R2 does not fix that. Fixing it means changing which rows a consumer sees,
// which is a behaviour change and belongs to a phase that declares one. R2 makes
// the claim on the tin match the claim in the code, so the later phase is
// arguing with an honest baseline.
//
// THREE KINDS OF TEMPORAL BOUND, KEPT APART
// ------------------------------------------
//   SYNC RECENCY   — bounds MetricSnapshot.date. "How recently did we write it."
//   ACTIVITY       — bounds createdAt/executedAt on decisions, actions, outcomes.
//                    Real event times, not sync artefacts. A different question.
//   MEASUREMENT    — the period the metrics actually cover. Exactly ONE constant
//                    in the system earns this name: CANONICAL_VERDICT_WINDOW_DAYS
//                    in verdict-engine/metricWindow.js, which is NOT here and is
//                    not configurable. It is the frozen verdict contract; nothing
//                    in R2 goes near it.
//
// Nothing here is a MEASUREMENT bound, so nothing here is named like one.
// ============================================================

/**
 * Resolve a day-count from the environment, preferring the new name and falling
 * back to the legacy one.
 *
 * `||` AT EVERY STEP, DELIBERATELY, AND NOT `??`.
 *
 * Every call site this replaces read `Number(process.env.X || DEFAULT)`, and the
 * two operators disagree on a case that a production environment can genuinely
 * be in: a variable set to the EMPTY STRING. Under `||` it falls through to the
 * default (what happens today); under `??` it is a present value, `Number('')`
 * is 0, and a consumer silently starts asking for zero days of rows. R2 promised
 * no behaviour change, and that includes the behaviour nobody meant to specify.
 *
 * A legacy name set to "0" still yields 0 — also unchanged, and still what the
 * operator asked for.
 *
 * @param {object}  spec
 * @param {string}  spec.next      — the new, honest variable name
 * @param {string}  spec.legacy    — the name production may already be setting
 * @param {number}  spec.fallback  — the default, unchanged from the call site
 * @param {object} [spec.env]      — injectable for tests; process.env by default
 * @returns {number}
 */
export function resolveDays({ next, legacy, fallback, env = process.env }) {
  // Read both, prefer the new one, then apply the default exactly as the
  // original expression did. Written as one chain so there is no branch in which
  // the default could be reached by a different route than it is today.
  return Number((env[next] || env[legacy]) || fallback);
}

/**
 * Every SYNC-RECENCY bound in the system, resolved once at load.
 *
 * RESOLVED AT MODULE LOAD, NOT PER CALL — matching what each consumer did
 * before. Reading the environment per call would be a real behaviour change
 * (a var mutated after boot would start taking effect), and R2 declared none.
 * `resolveDays` is exported separately so precedence can be tested directly,
 * without re-importing modules to re-trigger load-time reads.
 *
 * The legacy names are NOT deprecated-with-a-warning: nothing in the repository
 * documents them (they appear in no .env.example, no CI config and no test), so
 * whether production sets any of them is UNKNOWN. An alias that silently keeps
 * working is the only resolution that cannot change a running deployment.
 */
export const TEMPORAL = Object.freeze({
  // ── Sync recency: bounds MetricSnapshot.date ────────────────────────────────

  /** EntityGraphService.latestSnapshots — the operational entity/metric tree. */
  entitySnapshotSyncRecencyDays: resolveDays({
    next: 'ENTITY_SNAPSHOT_SYNC_RECENCY_DAYS', legacy: 'ENTITY_SNAPSHOT_WINDOW_DAYS', fallback: 90,
  }),

  /** PatternService.getBriefing — the account-pattern observation horizon. */
  patternSyncRecencyDays: resolveDays({
    next: 'PATTERN_SYNC_RECENCY_DAYS', legacy: 'PATTERN_LOOKBACK_DAYS', fallback: 365,
  }),

  /** GuardrailSweepService — the rows a guardrail sweep may evaluate. */
  guardrailSyncRecencyDays: resolveDays({
    next: 'GUARDRAIL_SYNC_RECENCY_DAYS', legacy: 'GUARDRAIL_LOOKBACK_DAYS', fallback: 14,
  }),

  /** TestGeneratorService.getWeeklyAgenda — candidate rows for test proposals. */
  testGeneratorSyncRecencyDays: resolveDays({
    next: 'TEST_GENERATOR_SYNC_RECENCY_DAYS', legacy: 'TEST_GENERATOR_LOOKBACK_DAYS', fallback: 14,
  }),

  /** BlendedTruthService.getBlendedTruth — cross-channel blended figures. */
  blendedTruthSyncRecencyDays: resolveDays({
    next: 'BLENDED_TRUTH_SYNC_RECENCY_DAYS', legacy: 'BLENDED_TRUTH_LOOKBACK_DAYS', fallback: 30,
  }),

  /**
   * PlanService.buildActualsSeries — goal-tracking actuals.
   *
   * WORTH KNOWING, AND NOT FIXED HERE: this consumer buckets rows by
   * `date.slice(0,10)` and calls the result a DAILY series. Those are sync days,
   * not delivery days, so two syncs on one date collapse into one bucket and a
   * day with no sync has no point at all. Renaming the bound does not repair
   * that; it makes it legible. Repair is a behaviour change and belongs to R3.
   */
  planActualsSyncRecencyDays: resolveDays({
    next: 'PLAN_ACTUALS_SYNC_RECENCY_DAYS', legacy: 'PLAN_ACTUALS_LOOKBACK_DAYS', fallback: 60,
  }),

  /**
   * FatigueForecastService AND FatigueSweepService — one variable, two consumers.
   *
   * They shared `FATIGUE_LOOKBACK_DAYS` before and they share its successor now.
   * Splitting them into two names would let the campaign-level forecast and the
   * persisted prediction drift onto different populations, which is the exact
   * defect Phase K closed by giving fatigue a single evidence contract.
   */
  fatigueSyncRecencyDays: resolveDays({
    next: 'FATIGUE_SYNC_RECENCY_DAYS', legacy: 'FATIGUE_LOOKBACK_DAYS', fallback: 30,
  }),

  /** ScenarioService.gatherLeadingSignals — its own bound, separate by design. */
  scenarioFatigueSyncRecencyDays: resolveDays({
    next: 'SCENARIO_FATIGUE_SYNC_RECENCY_DAYS', legacy: 'SCENARIO_FATIGUE_LOOKBACK_DAYS', fallback: 30,
  }),

  // ── Activity recency: bounds real event times, NOT MetricSnapshot.date ──────

  /**
   * AgenticLoopService.buildLoopInputs — how far back the loop counts activity.
   *
   * NOT sync recency, and naming it so would have been a fresh lie in a PR about
   * removing one. It bounds `Action.executedAt`, `OutcomeSnapshot.createdAt` and
   * `DecisionMemoryEntry.createdAt` — times when something actually HAPPENED.
   * It never touches MetricSnapshot.
   */
  loopActivityRecencyDays: resolveDays({
    next: 'LOOP_ACTIVITY_RECENCY_DAYS', legacy: 'LOOP_LOOKBACK_DAYS', fallback: 30,
  }),
});
