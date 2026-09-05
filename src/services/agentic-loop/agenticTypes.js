// ============================================================
// Agentic loop — shared types + helpers
// ============================================================
// Sibling module so services/routes/contracts import the enums + the
// agendaItem helper without pulling the planner (ESM link hygiene — the
// Phase-5 lesson).
//
// Phase 9 is the NERVOUS SYSTEM: it does not decide, allocate, test, or
// execute — those organs already exist. It DETECTS what each organ surfaced,
// UNIFIES + PRIORITIZES it into a two-band agenda, and reports whether the
// loop is closed. The human still confirms every proposal; nothing here
// auto-executes.
// ============================================================

// Which altitude an agenda item serves.
export const AGENDA_BAND = Object.freeze({
  BUYER:      'BUYER',      // "what needs a decision today"
  STRATEGIST: 'STRATEGIST', // "how the portfolio tracks to goal"
});

// The kind of work an item represents.
export const AGENDA_TYPE = Object.freeze({
  VERDICT:         'VERDICT',         // a radar verdict to confirm (KILL/SCALE/…)
  REALLOCATION:    'REALLOCATION',    // a budget move
  TEST:            'TEST',            // a test to launch / read
  PLAN_ADJUSTMENT: 'PLAN_ADJUSTMENT', // a plan/goal drift to address
  PACING:          'PACING',          // a budget-pace breach
  FATIGUE:         'FATIGUE',         // a forecast breach
});

// The six stages of the closed loop, in order.
export const LOOP_STAGE = Object.freeze({
  PLAN:     'PLAN',
  ALLOCATE: 'ALLOCATE',
  EXECUTE:  'EXECUTE',
  TEST:     'TEST',
  MEASURE:  'MEASURE',
  LEARN:    'LEARN',
});
export const LOOP_STAGE_ORDER = Object.freeze([
  LOOP_STAGE.PLAN, LOOP_STAGE.ALLOCATE, LOOP_STAGE.EXECUTE,
  LOOP_STAGE.TEST, LOOP_STAGE.MEASURE, LOOP_STAGE.LEARN,
]);

// Per-stage freshness.
export const STAGE_STATE = Object.freeze({
  ACTIVE: 'ACTIVE', // a recent real row exists
  IDLE:   'IDLE',   // a row exists but it's ageing
  STALE:  'STALE',  // no row, or past the stale threshold
});

// Overall loop health (queryable monitoring — persisted as a column).
export const LOOP_HEALTH = Object.freeze({
  HEALTHY:  'HEALTHY',  // closed, nothing stale
  DEGRADED: 'DEGRADED', // a non-blocking stage is ageing/stale
  STALLED:  'STALLED',  // proposals are piling up unexecuted, or the loop never closed
});

export const SEVERITY = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });
export const SEVERITY_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });

// The verb the human takes on an item — Lumi proposes, the human acts.
export const HUMAN_ACTION = Object.freeze({
  CONFIRM: 'confirm', // confirm a proposed verdict/reallocation → execution motion
  REVIEW:  'review',  // look at a test / forecast
  ADJUST:  'adjust',  // change the plan/goal
});

// Freshness thresholds (days). Env-overridable so ops can tune cadence.
export const STAGE_ACTIVE_DAYS = Number(process.env.LOOP_STAGE_ACTIVE_DAYS || 7);
export const STAGE_STALE_DAYS  = Number(process.env.LOOP_STAGE_STALE_DAYS || 30);

/**
 * One agenda item. Every item is a PROPOSAL — it carries the human verb and a
 * reference to the real row behind it, never an auto-action. `impactScore` (1-10,
 * or null when unscored) is the SAME deterministic priority-to-act the Campaigns
 * page shows, so the agenda can rank by the identical lever within a severity tier.
 */
// C-10 — `decisionClass` defaults to NULL and is never guessed. A fatigue
// forecast and a pacing alert are not Decisions and have no class; defaulting to
// SIGNAL because it is the commonest value would make every non-decision item
// claim to be a connector verdict. Silence about a class is honest; a confident
// wrong one is not.
// C-13 — `subjectRef` names WHICH row an item is about, when the class alone
// does not narrow it to one. EXPERIMENT contains two live objects that live in
// two tables on two pages, so `{ kind, id }` is the difference between an item
// a destination can resolve and one it can only approximate. Null by default
// and never inferred: a Signal's subject is already its entity, and a weekly
// suggestion has no subject at all because the experiment does not exist yet.
export function agendaItem({ id, band, type, title, rationale, severity = SEVERITY.MEDIUM, evidenceRef = null, humanAction = HUMAN_ACTION.REVIEW, entityId = null, impactScore = null, decisionClass = null, subjectRef = null }) {
  return { id, band, type, title, rationale, severity, evidenceRef, humanAction, entityId, impactScore, decisionClass, subjectRef };
}
