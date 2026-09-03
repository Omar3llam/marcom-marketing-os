// ============================================================
// gatingReason — why a campaign has no verdict, and what would give it one (C-07)
// ============================================================
// 🔒 C-07, locked:
//
//   Knowledge     answers "what do we know about the judgment being possible?"
//   Reason        answers "why can we not issue the judgment?"
//   Prerequisite  answers "what must happen for the judgment to become possible?"
//
//   No layer may stand in for another.
//
// ── WHY A SECOND VOCABULARY, AND NOT A SIXTH KNOWLEDGE TOKEN ────────────────
// Measured, not argued. Two of the three reasons below carry the SAME C-06
// token — Lumi knows exactly as much about a campaign that delivered nothing as
// about one it has never measured: NOTHING_THERE, honestly, in both cases. Their
// fixes have nothing in common. A design that published only the token would
// hand the operator one sentence for two unrelated problems, which is precisely
// the defect C-07 exists to end — and one worse than silence, because the
// sentence the client chose was "add revenue data", the wrong instruction for
// two of the three.
//
// ── WHY THIS MODULE IS IN THE SHARED PACKAGE ────────────────────────────────
// The rule, and it is testable: a vocabulary belongs here when THE CLIENT MUST
// BRANCH ON ITS VALUES. HISTORY_STATUS does not qualify — the client reads its
// C-06 token and never its dialect. GATING_REASON does: no token separates two
// of these, so a client that cannot see the reason cannot choose the next
// action. It stays a SEPARATE module from epistemicStatus.js so the two layers
// are visibly orthogonal rather than one enum doing two jobs.
//
// PURE. No I/O, no clock, no logger.
// ============================================================
import { KNOWLEDGE, KNOWLEDGE_VALUES } from './epistemicStatus.js';

/**
 * The reasons a campaign is gated out of the verdict population.
 *
 * All three were produced before C-07 — as two exported constants and one bare
 * English sentence. The sentence is now a domain value: `NO_MEASURABLE_DELIVERY`
 * replaces 'no measured revenue or engagement', which was display text sitting
 * on a domain wire. No alias is kept, deliberately — a fallback would let a
 * consumer go on matching prose and would leave the defect reachable.
 */
export const GATING_REASON = Object.freeze({
  /** We measured it over the verdict window, and it delivered nothing to judge. */
  NO_MEASURABLE_DELIVERY: 'NO_MEASURABLE_DELIVERY',
  /** We have never measured it over the verdict window at all. */
  NO_CANONICAL_WINDOW: 'NO_CANONICAL_WINDOW',
  /** We measured it correctly, and the period we measured ended too long ago. */
  CANONICAL_EVIDENCE_STALE: 'CANONICAL_EVIDENCE_STALE',
});

/** The reason values, for validation and for tests that must be exhaustive. */
export const GATING_REASON_VALUES = Object.freeze(Object.values(GATING_REASON));

/**
 * What has to happen before a verdict becomes possible.
 *
 * A CLASS of action, never a UI string: the wording belongs to the surface (and
 * for DELIVERY it is tailored per industry), while the class is the contract.
 * Three reasons, three prerequisites — which is why a fourth gate needs a
 * ruling rather than a default.
 */
export const PREREQUISITE = Object.freeze({
  /** Measurable delivery, and a revenue source to measure it against. */
  DELIVERY: 'DELIVERY',
  /** A first canonical measurement over the verdict window. */
  FIRST_MEASUREMENT: 'FIRST_MEASUREMENT',
  /** A newer canonical measurement — this campaign has been measured before. */
  FRESH_MEASUREMENT: 'FRESH_MEASUREMENT',
});

/** The prerequisite values, for validation. */
export const PREREQUISITE_VALUES = Object.freeze(Object.values(PREREQUISITE));

/** Raised when a reason declaration is incomplete or does not fit its vocabulary. */
export class GatingReasonDeclarationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GatingReasonDeclarationError';
  }
}

/** Raised when a producer tries to publish a reason nobody has ruled on. */
export class UndeclaredGatingReasonError extends Error {
  constructor(reason) {
    super(
      `"${reason}" is not a declared gating reason. Declare it in gatingReason.js `
      + 'with its knowledge token AND the prerequisite it waits on — a reason with '
      + 'no prerequisite is a label, and the surface will invent an instruction.',
    );
    this.name = 'UndeclaredGatingReasonError';
    this.reason = reason ?? null;
  }
}

/**
 * Declare, for every reason in a vocabulary, what Lumi knows and what it waits on.
 *
 * EXHAUSTIVENESS IS STRUCTURAL, exactly as in C-06: the vocabulary itself is
 * passed in, and a reason added later with no declaration throws at MODULE LOAD
 * rather than reaching a payload as an unexplained absence.
 *
 * @param {Record<string,string>} vocabulary
 * @param {Record<string,{knowledge:string, prerequisite:string}>} declarations
 */
export function declareGatingReasons(vocabulary, declarations) {
  if (!vocabulary || typeof vocabulary !== 'object') {
    throw new GatingReasonDeclarationError('no reason vocabulary was passed');
  }
  if (!declarations || typeof declarations !== 'object') {
    throw new GatingReasonDeclarationError('no declarations were passed');
  }

  const values = Object.values(vocabulary);

  const undeclared = values.filter((v) => !Object.hasOwn(declarations, v));
  if (undeclared.length > 0) {
    throw new GatingReasonDeclarationError(`no declaration for ${undeclared.join(', ')}`);
  }
  const stray = Object.keys(declarations).filter((k) => !values.includes(k));
  if (stray.length > 0) {
    throw new GatingReasonDeclarationError(
      `declared ${stray.join(', ')}, which the vocabulary does not contain`,
    );
  }

  const table = {};
  for (const value of values) {
    const { knowledge, prerequisite } = declarations[value] ?? {};
    if (!KNOWLEDGE_VALUES.includes(knowledge)) {
      throw new GatingReasonDeclarationError(
        `${value}: "${knowledge}" is not one of ${KNOWLEDGE_VALUES.join(' | ')}`,
      );
    }
    // Enforced with the same force as the token. An absence that cannot name its
    // prerequisite IS the defect, so it cannot be the optional half.
    if (!PREREQUISITE_VALUES.includes(prerequisite)) {
      throw new GatingReasonDeclarationError(
        `${value}: "${prerequisite}" is not one of ${PREREQUISITE_VALUES.join(' | ')}`,
      );
    }
    table[value] = Object.freeze({ reason: value, knowledge, prerequisite });
  }
  const frozen = Object.freeze(table);

  return Object.freeze({
    values: Object.freeze([...values]),
    /** The full declaration, or `null` for a reason this build does not know. */
    declarationOf: (reason) => (Object.hasOwn(frozen, reason) ? frozen[reason] : null),
  });
}

/** The registry. Exhaustive over GATING_REASON, checked at module load. */
export const GATING_REASONS = declareGatingReasons(GATING_REASON, {
  // We looked at the window and there is nothing in it to judge. A finding.
  [GATING_REASON.NO_MEASURABLE_DELIVERY]: {
    knowledge: KNOWLEDGE.NOTHING_THERE,
    prerequisite: PREREQUISITE.DELIVERY,
  },
  // We looked at what we hold, and we hold no measurement of this campaign —
  // the same shape as C-04's NEVER_SYNCED, and classified the same way.
  // SAME TOKEN AS THE ROW ABOVE, different prerequisite: this is the pair that
  // proves a token cannot stand in for a reason.
  [GATING_REASON.NO_CANONICAL_WINDOW]: {
    knowledge: KNOWLEDGE.NOTHING_THERE,
    prerequisite: PREREQUISITE.FIRST_MEASUREMENT,
  },
  // We established what there is — a valid measurement — and it does not
  // suffice to decide TODAY. Neither a failure nor an absence.
  [GATING_REASON.CANONICAL_EVIDENCE_STALE]: {
    knowledge: KNOWLEDGE.NOT_ENOUGH,
    prerequisite: PREREQUISITE.FRESH_MEASUREMENT,
  },
});

/** Whether a value is a reason this build has ruled on. */
export function isGatingReason(reason) {
  return GATING_REASONS.declarationOf(reason) !== null;
}

/**
 * The C-06 token for a gating reason — `null`, never a guess, for an
 * unrecognised one, so a surface degrades to silence rather than to a
 * confident wrong claim.
 */
export function knowledgeOfGatingReason(reason) {
  return GATING_REASONS.declarationOf(reason)?.knowledge ?? null;
}

/** The prerequisite for a gating reason, or `null` for an unrecognised one. */
export function prerequisiteOfGatingReason(reason) {
  return GATING_REASONS.declarationOf(reason)?.prerequisite ?? null;
}

/**
 * THE PRODUCER BOUNDARY. Decorates one gated-out row with its knowledge token
 * and its prerequisite, preserving every other field the producer supplied —
 * `measurementAgeDays`, `windowEnd` and `maxAgeDays` are the facts a caller
 * needs to explain the gate without recomputing it, and they ride through
 * untouched.
 *
 * THROWS on an undeclared reason rather than omitting the two layers. C-06's
 * `knowledgeOf` returns null instead, and the difference is deliberate: there,
 * the values came from many vocabularies written long before the registry
 * existed. Here the producer set is closed, declared and ratcheted, so the only
 * way to reach this line with an unknown reason is a code change that skipped
 * the ruling — which the ratchet fails in CI, before it can reach a request.
 */
export function withGatingKnowledge(row) {
  const declaration = GATING_REASONS.declarationOf(row?.reason);
  if (!declaration) throw new UndeclaredGatingReasonError(row?.reason);
  return { ...row, knowledge: declaration.knowledge, prerequisite: declaration.prerequisite };
}
