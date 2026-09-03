// ============================================================
// MARCOM / Lumi — promotion snapshot (C-05)
// ------------------------------------------------------------
// What a promotion RECORDED, frozen at the instant it was authorized.
//
// ── WHY THIS IS BY VALUE AND NOT A patternId ────────────────────────────────
//
// R-6 established that `AccountPattern` is a MEASUREMENT that is upserted in
// place: `PatternService` recomputes `accuracy`, `support`, `statement` and
// `status` on the same row every sweep. So the row a promotion was authorized
// on is not preserved by pointing at it — following that pointer a month later
// answers "what does Lumi believe now", wearing the label of "what did Lumi
// believe when a person granted this rule its authority".
//
// Those are different questions, and only one of them justifies a grant. Every
// field below is copied by value for that reason, and the result is deep-frozen
// so no later code can quietly reconcile it with the present.
//
// ── WHAT A PROMOTION ACTUALLY GRANTS ────────────────────────────────────────
//
// A promoted GuardrailRule is evaluated by GuardrailSweepService, which writes
// `status: 'PROPOSED'`. The row then rides the same confirm→execute governance
// as every other decision. So the authority granted is:
//
//     to JUDGE the account on this rule, and to RAISE a proposal — durably,
//     without being asked again. Never to ACT.
//
// `GRANTED_AUTHORITY` states that in the record itself, because a provenance
// entry that merely said "promoted" would let a later reader (or a later
// screen) infer more autonomy than was ever handed over.
//
// Pure: no DB, no clock, no env. Everything it needs is passed in — including
// the accuracy floor, which is env-driven and therefore a property of the
// MOMENT rather than of the code.
// ============================================================

/** ApprovalRequest.subjectType for a promotion. Not 'PLAN' — see PromotionService. */
export const PROMOTION_SUBJECT_TYPE = 'PATTERN_PROMOTION';

/** CollaborationEventType values C-05 adds. */
export const AUTONOMY_EVENT = Object.freeze({
  GRANTED: 'AUTONOMY_GRANTED',
  REVOKED: 'AUTONOMY_REVOKED',
});

/** What the grant permits — stated, so nothing has to infer it. */
export const GRANTED_AUTHORITY = Object.freeze({
  RAISE_PROPOSED_DECISION: 'RAISE_PROPOSED_DECISION',
});

/** Recorded on the ApprovalRequest when the system, not the approver, refused. */
export const REFUSAL = Object.freeze({
  BELIEF_DEGRADED: 'BELIEF_DEGRADED',
  OUTCOME:         'REFUSED_BELIEF_DEGRADED',
});

/** ISO-8601, or null. Json columns do not preserve Date, and a promotion record
 *  that changed shape on its way to storage would be a poor thing to trust. */
function instant(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * What Lumi believed about this pattern, copied out of the row.
 *
 * Nullable measurements stay null. `accuracy: null` means "no outcome has been
 * measured yet" and must never arrive as 0 — R10 (I54) already removed an
 * invented 0.5 prior from this model for exactly that reason.
 *
 * @param {object} pattern — an AccountPattern row
 * @returns {object} frozen
 */
export function beliefSnapshot(pattern) {
  if (!pattern) throw new Error('beliefSnapshot: pattern required');
  return Object.freeze({
    patternId:        pattern.id ?? null,
    patternKey:       pattern.patternKey ?? null,
    kind:             pattern.kind ?? null,
    statement:        pattern.statement ?? null,
    basis:            pattern.basis ?? null,
    status:           pattern.status ?? null,
    support:          pattern.support ?? null,
    effectiveSupport: pattern.effectiveSupport ?? null,
    accuracy:         pattern.accuracy ?? null,
    confidence:       pattern.confidence ?? null,
    firstObservedAt:  instant(pattern.firstObservedAt),
    lastObservedAt:   instant(pattern.lastObservedAt),
  });
}

/**
 * What the account has just authorized Lumi to do on its own.
 *
 * The rule spec is copied rather than referenced for the same reason as the
 * belief: `guardrail_rules` is mutable, and a threshold edited later would
 * silently restate what was granted.
 *
 * @param {object} rule — a GuardrailRule row
 * @returns {object} frozen
 */
export function grantedAutonomy(rule) {
  if (!rule) throw new Error('grantedAutonomy: rule required');
  return Object.freeze({
    ruleId:        rule.id ?? null,
    ruleName:      rule.name ?? null,
    metric:        rule.metric ?? null,
    comparator:    rule.comparator ?? null,
    threshold:     rule.threshold ?? null,
    unit:          rule.unit ?? null,
    scopeLevel:    rule.scopeLevel ?? null,
    audienceTag:   rule.audienceTag ?? null,
    sustainedDays: rule.sustainedDays ?? null,
    emitVerdict:   rule.emitVerdict ?? null,
    // The honest ceiling on what was handed over.
    authority:     GRANTED_AUTHORITY.RAISE_PROPOSED_DECISION,
  });
}

/**
 * The gate that was passed: who asked, who granted, under which floor, when.
 *
 * `minAccuracyApplied` is required rather than defaulted. The floor comes from
 * `PATTERN_PROMOTE_MIN_ACCURACY` and is read at module load, so a rule promoted
 * under 0.75 and one promoted under 0.6 are not the same claim — and reading
 * today's floor when displaying an old grant would relabel it.
 *
 * `selfApproved` is recorded, never hidden. Today only a STRATEGIST may request
 * a promotion and only a STRATEGIST may grant one, so one person can legitimately
 * do both. That is a real two-step authorization; it is not four eyes, and an
 * audit trail that let it be mistaken for one would be worse than none.
 */
function gateSnapshot(gate) {
  if (!gate) throw new Error('promotionSnapshot: gate required');
  if (gate.minAccuracyApplied == null) throw new Error('promotionSnapshot: gate.minAccuracyApplied required');
  return Object.freeze({
    requestId:          gate.requestId ?? null,
    requestedById:      gate.requestedById ?? null,
    approvedById:       gate.approvedById ?? null,
    selfApproved:       Boolean(gate.selfApproved),
    minAccuracyApplied: gate.minAccuracyApplied,
    requestedAt:        instant(gate.requestedAt),
    decidedAt:          instant(gate.decidedAt),
  });
}

/**
 * The whole authorization record, ready to be stored as CollaborationEvent
 * `detail` and never edited again.
 *
 * @param {{ pattern: object, rule: object, gate: object }} input
 * @returns {{ belief: object, autonomy: object, gate: object }} deep-frozen
 */
export function promotionSnapshot({ pattern, rule, gate } = {}) {
  if (!rule) throw new Error('promotionSnapshot: rule required');
  return Object.freeze({
    belief:   beliefSnapshot(pattern),
    autonomy: grantedAutonomy(rule),
    gate:     gateSnapshot(gate),
  });
}
