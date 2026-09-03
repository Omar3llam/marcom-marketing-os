// ============================================================
// connectorReadiness — the five axes, as five separate answers (C-04)
// ============================================================
// R-8, locked: connector readiness EXPLAINS absence; it never GATES a claim.
// Evidence decides what Lumi may say about an entity; the connector says why
// the evidence is what it is. Nothing in this module is read by the verdict
// engine, and nothing in it may become a precondition for one.
//
// ── WHY FIVE, AND NOT ONE ───────────────────────────────────────────────────
// A single "connector health" verdict is the failure this module exists to
// prevent. These five answer genuinely different questions, and every pair of
// them can legitimately disagree:
//
//   CONNECTION    is there a live credential?          is_active
//   AVAILABILITY  did the last attempt work?           health.lastError
//   COMPLETENESS  did the data that landed arrive whole?  health.lastWarning
//   READINESS     how old is the last SUCCESS?         health.lastSuccessfulSync
//   CAPABILITY    what can this connector be asked?    the registry + last run
//
// A channel can be CONNECTED, FAILING, INCOMPLETE and CURRENT all at once, and
// each of those four words is true about a different fact. Collapsing any pair
// into one badge is how a dashboard starts lying quietly.
//
// ── WHY THE VOCABULARIES DO NOT OVERLAP ─────────────────────────────────────
// One shared token, on purpose: NOT_RECORDED. It means the same thing wherever
// it appears — WE have no record — so it is one word rather than three
// synonyms. Everything else is unique to its axis, which is what stops a reader
// comparing two axes that were never comparable.
//
// Following the MEMORY_STATUS / HISTORY_STATUS precedent: the vocabulary lives
// in the module that produces it, and "we could not / did not record it" is
// always a statement about us, never about the account.
//
// ── WHAT THIS MODULE REFUSES TO DO ──────────────────────────────────────────
// It does not infer. `null` is never promoted to NO_DATA or DISABLED; an absent
// warning is never promoted to COMPLETE; an absent error is never promoted to
// OK. Every state below is either read from a value the writer stamped, or is
// NOT_RECORDED. PURE — no I/O, no clock of its own (callers pass `now`).
// ============================================================
import { CHANNEL } from './connectorTypes.js';
import { CONNECTOR_STALE_HOURS } from './connectorTypes.js';
import { DAILY_STATE } from './connectorConfig.js';
import { resolve } from './connectorRegistry.js';
import { EXECUTABLE_CHANNELS } from '../execution/decisionExecutability.js';
import { KNOWLEDGE, declareStatusVocabulary } from '@marcom/runtime-contracts';

/** Is there a live credential for this channel? */
export const CONNECTION_STATE = Object.freeze({
  CONNECTED:    'CONNECTED',    // an active credential row exists
  DISCONNECTED: 'DISCONNECTED', // the row exists and was deactivated
});

/** Did the last recorded attempt work? */
export const AVAILABILITY_STATE = Object.freeze({
  OK:           'OK',           // an attempt was recorded and it succeeded
  FAILING:      'FAILING',      // an attempt was recorded and it failed
  NOT_RECORDED: 'NOT_RECORDED', // no attempt has ever been recorded
});

// C-06 — FAILING is KNOWN: we know the last attempt failed, and an operator can
// act on that. NOT_RECORDED is COULD_NOT_LOOK: we hold no record to tell us,
// which is the distinction C-04 was fought over and must not be re-collapsed.
export const AVAILABILITY_KNOWLEDGE = declareStatusVocabulary('AVAILABILITY_STATE', AVAILABILITY_STATE, {
  [AVAILABILITY_STATE.OK]:           KNOWLEDGE.KNOWN,
  [AVAILABILITY_STATE.FAILING]:      KNOWLEDGE.KNOWN,
  [AVAILABILITY_STATE.NOT_RECORDED]: KNOWLEDGE.COULD_NOT_LOOK,
});


/** Did the data that landed arrive whole? */
export const COMPLETENESS_STATE = Object.freeze({
  COMPLETE:     'COMPLETE',     // a successful sync landed with no warning
  INCOMPLETE:   'INCOMPLETE',   // a successful sync landed, knowingly short
  NOT_RECORDED: 'NOT_RECORDED', // no successful sync to judge completeness of
});

// C-06 — INCOMPLETE is KNOWN, for the same reason FAILING is: the data landed
// and we know it is short. Only NOT_RECORDED is a statement about our records.
export const COMPLETENESS_KNOWLEDGE = declareStatusVocabulary('COMPLETENESS_STATE', COMPLETENESS_STATE, {
  [COMPLETENESS_STATE.COMPLETE]:     KNOWLEDGE.KNOWN,
  [COMPLETENESS_STATE.INCOMPLETE]:   KNOWLEDGE.KNOWN,
  [COMPLETENESS_STATE.NOT_RECORDED]: KNOWLEDGE.COULD_NOT_LOOK,
});


/** How old is the last SUCCESS? Three states, never a boolean. */
export const READINESS_STATE = Object.freeze({
  CURRENT:      'CURRENT',      // last success within CONNECTOR_STALE_HOURS
  STALE:        'STALE',        // we had data and it aged
  NEVER_SYNCED: 'NEVER_SYNCED', // we never had any
});

// C-06 — NEVER_SYNCED is NOTHING_THERE, NOT COULD_NOT_LOOK. We looked at what
// we hold and there is nothing; that is a finding about the connector, not a
// failure of ours. It is the exact counterpart to NOT_RECORDED above, and the
// pair is why this axis needed three states instead of a boolean.
export const READINESS_KNOWLEDGE = declareStatusVocabulary('READINESS_STATE', READINESS_STATE, {
  [READINESS_STATE.CURRENT]:      KNOWLEDGE.KNOWN,
  [READINESS_STATE.STALE]:        KNOWLEDGE.KNOWN,
  [READINESS_STATE.NEVER_SYNCED]: KNOWLEDGE.NOTHING_THERE,
});


/** The capabilities that have a predicate in code. Not a wish list. */
export const CAPABILITY = Object.freeze({
  DAILY_OBSERVATIONS: 'DAILY_OBSERVATIONS',
  CANONICAL_WINDOW:   'CANONICAL_WINDOW',
  EXECUTION:          'EXECUTION',
});

/**
 * What the last run of a capability did.
 *
 * The five DAILY_STATE values, plus two absences that are NOT each other:
 *   NOT_RECORDED   — the sync loop exercises this capability, but no outcome is
 *                    stored (a row synced before C-04, or a capability whose
 *                    outcome the system does not model yet).
 *   NOT_APPLICABLE — the sync loop does not exercise this capability at all.
 *
 * Neither is NO_DATA. NO_DATA is a measurement: we asked and the account
 * delivered nothing. These two say we have no measurement to report.
 */
export const CAPABILITY_RUN = Object.freeze({
  ...DAILY_STATE,
  NOT_RECORDED:   'NOT_RECORDED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

// C-06 — the widest epistemic vocabulary in the system: seven values, four
// tokens. DISABLED / UNIMPLEMENTED / NOT_APPLICABLE are all CANNOT_ASK by three
// different routes, and keeping the words apart is what lets a screen say which
// one. NO_DATA is NOTHING_THERE — a measurement, as the comment above insists.
export const CAPABILITY_RUN_KNOWLEDGE = declareStatusVocabulary('CAPABILITY_RUN', CAPABILITY_RUN, {
  [CAPABILITY_RUN.DISABLED]:       KNOWLEDGE.CANNOT_ASK,
  [CAPABILITY_RUN.UNIMPLEMENTED]:  KNOWLEDGE.CANNOT_ASK,
  [CAPABILITY_RUN.NOT_APPLICABLE]: KNOWLEDGE.CANNOT_ASK,
  [CAPABILITY_RUN.NO_DATA]:        KNOWLEDGE.NOTHING_THERE,
  [CAPABILITY_RUN.SUCCESS]:        KNOWLEDGE.KNOWN,
  [CAPABILITY_RUN.FAILED]:         KNOWLEDGE.COULD_NOT_LOOK,
  [CAPABILITY_RUN.NOT_RECORDED]:   KNOWLEDGE.COULD_NOT_LOOK,
});


/**
 * Did the writer stamp this record at all?
 *
 * `lastAttemptedSync` is set by nextHealth on EVERY fold, success or failure,
 * so its presence is the evidence that an attempt happened. This is the guard
 * that stops a bare `{ lastError: null }` — a partial object, a legacy row, a
 * hand-built fixture — from reading as a success. Absence of an error is not
 * evidence of one.
 */
const attempted = (health) => Boolean(health?.lastAttemptedSync);

/** Has a sync ever SUCCEEDED? The only basis for a claim about the data. */
const succeeded = (health) => Boolean(health?.lastSuccessfulSync);

/** PURE: is there a live credential? Says nothing about data flowing. */
export function connectionOf(row) {
  return row?.isActive === false ? CONNECTION_STATE.DISCONNECTED : CONNECTION_STATE.CONNECTED;
}

/**
 * PURE: did the last recorded attempt work?
 *
 * OK requires a RECORDED attempt, not merely a missing error — see `attempted`.
 * FAILING is not NOT_RECORDED: one is an outage, the other is silence, and an
 * operator does different things about each.
 */
export function availabilityOf(health) {
  if (!attempted(health)) return AVAILABILITY_STATE.NOT_RECORDED;
  return health.lastError ? AVAILABILITY_STATE.FAILING : AVAILABILITY_STATE.OK;
}

/**
 * PURE: did the data that landed arrive whole?
 *
 * Keyed off a recorded SUCCESS, not off the absence of a warning. A connector
 * that has only ever failed carries no warning — and calling that COMPLETE
 * would claim its data arrived whole when no data arrived at all.
 *
 * INCOMPLETE is not FAILING. The data DID land; it is knowingly short (e.g. an
 * account with more ad sets than the pagination ceiling). This is the axis the
 * account owner is currently the one person not told about.
 *
 * A warning survives a later failure by design (nextHealth preserves it), so
 * this axis and AVAILABILITY can describe different runs. Both are stated;
 * neither is reconciled, because reconciling them would invent a third fact.
 */
export function completenessOf(health) {
  if (!succeeded(health)) return COMPLETENESS_STATE.NOT_RECORDED;
  return health.lastWarning ? COMPLETENESS_STATE.INCOMPLETE : COMPLETENESS_STATE.COMPLETE;
}

/**
 * PURE: how old is the last SUCCESS?
 *
 * THREE states. `isStale()` returns true for a null last-success, so a
 * connector that has never once succeeded was reported as "stale" — a word
 * claiming we used to have data and it aged. We never had any, and the two have
 * different fixes: one is "re-sync", the other is "this has never worked".
 *
 * `isStale` itself is deliberately left alone — BlendedTruthService consumes it
 * for a different question, and changing it underneath that reader would be a
 * second defect paid for with the first.
 *
 * R-8: this 24h clock is the CONNECTOR's. It is not the canonical 30-day
 * verdict window, and a UI that greys out verdicts on it would be lying.
 */
export function readinessOf(health, now = new Date(), staleHours = CONNECTOR_STALE_HOURS) {
  if (!succeeded(health)) return READINESS_STATE.NEVER_SYNCED;
  const ageMs = now.getTime() - new Date(health.lastSuccessfulSync).getTime();
  return ageMs > staleHours * 60 * 60 * 1000 ? READINESS_STATE.STALE : READINESS_STATE.CURRENT;
}

/** Does this connector implement a daily provider? The IDENTICAL predicate
 *  ConnectorSyncService uses to decide DAILY_STATE.UNIMPLEMENTED, so there is
 *  one definition of "this channel can report days". */
function implementsDaily(connector) {
  return Boolean(connector?.fetchDailyRaw && connector?.normalizeDaily);
}

/** Same, for the canonical 30-day refresh — the predicate the sync loop guards
 *  its canonical fetch with. */
function implementsCanonical(connector) {
  return Boolean(connector?.fetchCanonicalRaw && connector?.normalizeCanonical);
}

/**
 * PURE: what this connector can be asked, and what the last run did.
 *
 * ONE LINE PER CAPABILITY (B8-06) — never a single verdict for the source.
 * Three rows, because three is how many capabilities have a predicate in the
 * code. `isSyncable` is not a fourth: its outcome IS the AVAILABILITY axis, and
 * a row for it would be one fact wearing two names.
 *
 * `implemented` is structural and derived here on every read, so the day a
 * Google daily provider ships this reports it with no edit and no migration.
 * `lastRun` is a fact about a past run and can only be read from storage.
 *
 * CANONICAL_WINDOW states its capability and refuses to state an outcome: the
 * sync reports a bare count whose null means "no canonical path" OR "the fetch
 * failed" OR "nothing landed". Until that has a state model, NOT_RECORDED is
 * the true answer, and deriving one from the count would be the invention this
 * slice was approved on the condition of not making.
 *
 * @param {string} platform  channel/platform key
 * @param {object|null} health  the stored health record
 */
export function capabilitiesOf(platform, health) {
  let connector = null;
  // An unregistered platform is not a crash: it implements nothing we can name,
  // which is a true answer about a channel we do not have a connector for.
  try { connector = resolve(platform); } catch { connector = null; }

  const stored = health?.capabilities ?? {};
  const channel = String(platform || '').toUpperCase();

  return [
    {
      capability:  CAPABILITY.DAILY_OBSERVATIONS,
      implemented: implementsDaily(connector),
      // Verbatim when stored. NOT_RECORDED otherwise — including for every row
      // synced before C-04 began writing it. Never back-filled by guessing:
      // the old rows do not carry the fact, and inventing one would be the
      // same class of claim as calling a failed read an empty result.
      lastRun:     stored[CAPABILITY.DAILY_OBSERVATIONS] ?? CAPABILITY_RUN.NOT_RECORDED,
      // C-06 — the class of that outcome, per capability. NOT_RECORDED and
      // FAILED are both COULD_NOT_LOOK; NO_DATA is NOTHING_THERE. A reader can
      // tell "we have no measurement" from "the account had nothing" without
      // learning seven words.
      lastRunKnowledge: CAPABILITY_RUN_KNOWLEDGE.knowledgeOf(
        stored[CAPABILITY.DAILY_OBSERVATIONS] ?? CAPABILITY_RUN.NOT_RECORDED,
      ),
    },
    {
      capability:  CAPABILITY.CANONICAL_WINDOW,
      implemented: implementsCanonical(connector),
      lastRun:     CAPABILITY_RUN.NOT_RECORDED,
      lastRunKnowledge: CAPABILITY_RUN_KNOWLEDGE.knowledgeOf(CAPABILITY_RUN.NOT_RECORDED),
    },
    {
      capability:  CAPABILITY.EXECUTION,
      implemented: EXECUTABLE_CHANNELS.includes(channel),
      // Not exercised by the sync loop at all — a different fact from
      // "exercised but not recorded", which is why it is a different word.
      lastRun:     CAPABILITY_RUN.NOT_APPLICABLE,
      lastRunKnowledge: CAPABILITY_RUN_KNOWLEDGE.knowledgeOf(CAPABILITY_RUN.NOT_APPLICABLE),
    },
  ];
}

/** The channels this module can describe. Exported for callers that enumerate. */
export const READINESS_CHANNELS = Object.freeze(Object.values(CHANNEL));
