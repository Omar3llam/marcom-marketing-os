// ============================================================
// Which classes does this read accept? (C-10)
// ============================================================
// 🔒 C-10. Discovery counted 31 reads of the `decisions` table. Eight address a
// row by id — class-safe by construction, since an id names one row. The other
// twenty-three are POPULATION reads, and twenty-one of them said nothing at all
// about the kind of decision they wanted:
//
//     where: { workspaceId }                    ← what is written
//     where: { workspaceId, decision class }    ← what is meant
//
// Eleven were blind. The other ten were scoped THROUGH `rootCause` — via
// `connectorDecisionScope()` or `startsWith: 'guardrail:'` — which is a class
// filter written as a string match, and string matching is what stops being the
// source of truth in this slice.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
//     Absence of a class filter is not evidence that the reader accepts every
//     class. A general reader says so. A scoped reader says what it accepts.
//
// A general read stays behaviourally identical — an empty fragment — but it
// becomes a CALL: greppable, countable, and ratcheted. That is the whole
// difference between "this reader accepts everything" and "nobody has looked at
// this reader since a third class existed".
//
// ── WHY A LEDGER RATHER THAN INLINE ARRAYS ──────────────────────────────────
//
// Because the question the rulings ask is not answerable file by file: "which
// readers would a fifth class silently reach?" needs one place that knows all
// of them. Eleven blind reads accumulated precisely because no such place
// existed and nothing pointed at them when GUARDRAIL and ALLOCATION arrived.
//
// A leaf module, imported by services, routes and workers alike — the same
// argument `decisionIdentity.js` makes for its own existence.
// ============================================================
import { DECISION_CLASS, DECISION_CLASS_VALUES, isDecisionClass } from '@marcom/runtime-contracts';

/**
 * The token a genuinely class-agnostic reader declares.
 *
 * A UNIQUE SENTINEL, never `[]`. An empty array would produce
 * `{ decisionClass: { in: [] } }` — a read that matches nothing — and would be
 * indistinguishable from a declaration somebody emptied by accident. The two
 * mean opposite things and must not share a spelling.
 */
export const ALL_CLASSES = Symbol('DECISION_CLASS:ALL');

/** Raised when a read reaches the table without appearing in the ledger below. */
export class UndeclaredReaderError extends Error {
  constructor(readerId) {
    super(`decisionClassScope: reader "${readerId}" has not declared which decision classes it accepts`);
    this.name = 'UndeclaredReaderError';
  }
}

const S = DECISION_CLASS.SIGNAL;

/**
 * Every population read of `decisions`, and what it accepts.
 *
 * THE REASON IS PART OF THE DECLARATION for the general readers — it is the
 * thing a future reviewer needs, and the thing eleven blind reads never had.
 */
export const DECISION_READERS = Object.freeze({
  // ── Scoped to SIGNAL ──────────────────────────────────────────────────────
  //
  // Each of these asks a question only the connector engine's own call can
  // answer. A guardrail episode states what a RULE says; an allocation move is
  // a budget proposal; an experiment is a test conclusion. None of them is a
  // judgement about how an entity is performing, which is what every reader
  // below is actually asking for.

  /** The verdict identity projection behind the Campaigns feed's decisionId. */
  'verdict/latest-decisions': [S],
  /** persistNode's "is this the same call as last time" comparison. */
  'verdict/previous': [S],
  /** supersedeDroppedConnectorVerdicts — stale connector verdicts only. */
  'verdict/supersede-dropped': [S],
  /** The track record shown beside a live verdict. */
  'decisions/learning-key': [S],
  /** by-entity stamp: `explainedAt` / `intentAt`. */
  'decisions/stamp-by-entity': [S],
  /** by-entity signal: `humanExecutedAt` / `dismissedAt`. */
  'decisions/signal-by-entity': [S],
  /** The campaign timeline and its counts. */
  'memory/decision-history': [S],
  /** The sidebar's recent-decisions list. */
  'memory/recent-decisions': [S],
  /** The attention band's Signal partition (C-01). */
  'loop/signal-verdicts': [S],

  // C-10's live defect. `channelId` is `MetricSnapshot.entityId`, the same ids
  // Decisions are written against, so under a standing breach the newest row is
  // a guardrail episode from the 15-minute sweep — and VERDICT_APPETITE.KILL is
  // 0.0. A policy breach drained a channel's budget, and the plan's own
  // reasoning trail published "Drain <ch>: KILL verdict — pull budget out."
  // Scoping this ALSO removes the loop where allocation's own previous
  // REALLOCATE rows (appetite 0.5) fed the next plan's inputs.
  'allocation/appetite': [S],
  'allocation/appetite-incremental': [S],

  /** "Latest verdict per entity" for the weekly testing agenda. */
  'test-generator/latest-verdict': [S],
  /** The collaboration inbox, which publishes each row as ALERT_KIND.RADAR. */
  'collaboration/inbox': [S],
  /** Causal learning: what happened when the recommendation was carried out. */
  'learning/patterns': [S],
  /** Comparable past outcomes for one similarity key. */
  'learning/track-record': [S],
  /** Was Lumi's call right — the accuracy population. */
  'accuracy/population': [S],
  /** Which acted-on calls still owe an outcome. */
  'accuracy/pending-outcomes': [S],

  // ── Scoped to GUARDRAIL ───────────────────────────────────────────────────

  /** The open-episode population; `openHitKey` carries the class implicitly. */
  'loop/guardrail-episodes': [DECISION_CLASS.GUARDRAIL],
  /** Which of the pairs this sweep judged already have an episode running. */
  'guardrail/open-episodes': [DECISION_CLASS.GUARDRAIL],
  /** Closing every open episode of a revoked rule (C-05). */
  'guardrail/revoke-close': [DECISION_CLASS.GUARDRAIL],
  /** The feed's guardrail radar block. */
  'feed/guardrail-verdicts': [DECISION_CLASS.GUARDRAIL],

  // ── Genuinely general ─────────────────────────────────────────────────────
  //
  // Three, and each is general because of what it ASKS, not because nobody got
  // round to scoping it.

  /**
   * ALL — the leadership report narrates the whole account. It needs
   * ALLOCATION in particular: the "where the money went" section reads the plan
   * id out of an allocation row, which is what its regex was for.
   */
  'narrative/report': ALL_CLASSES,
  /**
   * ALL — "did anything happen in this workspace during the window". A class
   * predicate here would make a workspace with only guardrail activity look
   * dormant, and the worker would decline to write a report about a real week.
   */
  'narrative/activity': ALL_CLASSES,
  /**
   * ALL — "did Lumi land a platform mutation". The EXECUTE stage of the loop
   * asks whether the system turned, and a mutation counts however it was
   * proposed. This one reads `platformExecutedAt`, which has a single writer.
   */
  'loop/platform-executions': ALL_CLASSES,
});

/**
 * The `where` fragment for a declared reader.
 *
 * Spread it: `where: { workspaceId, ...scopeFor('accuracy/population') }`. It
 * owns only the `decisionClass` key, so it composes with every other predicate
 * and — unlike `INTERVENED_WHERE` — never collides on `OR`.
 *
 * @param {string} readerId a key of DECISION_READERS
 * @returns {object} `{ decisionClass: { in: [...] } }`, or `{}` for a general reader
 */
export function scopeFor(readerId) {
  const declared = DECISION_READERS[readerId];
  if (declared === undefined) throw new UndeclaredReaderError(readerId);
  if (declared === ALL_CLASSES) return {};
  // A fresh object per call. Prisma mutates nothing, but a shared literal
  // spread into two where clauses invites someone to add a key to one and
  // change both — the reason connectorDecisionScope() is a function too.
  return { decisionClass: { in: [...declared] } };
}

/** The general readers, for the census that keeps a fourth one deliberate. */
export const GENERAL_READERS = Object.freeze(
  Object.entries(DECISION_READERS).filter(([, v]) => v === ALL_CLASSES).map(([k]) => k),
);

// Exhaustiveness at MODULE LOAD, the shape C-06 established: a declaration that
// names something which is not a class is a typo or a rename, and it must fail
// before a scoped read silently matches nothing and renders an empty surface
// that looks like an empty account.
for (const [readerId, declared] of Object.entries(DECISION_READERS)) {
  if (declared === ALL_CLASSES) continue;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`decisionClassScope: "${readerId}" must declare at least one class, or ALL_CLASSES`);
  }
  for (const cls of declared) {
    if (!isDecisionClass(cls)) {
      throw new Error(
        `decisionClassScope: "${readerId}" declares "${String(cls)}", which is not one of ${DECISION_CLASS_VALUES.join(', ')}`,
      );
    }
  }
}
