// ============================================================
// WHO ACTED ON THIS DECISION (C-12, moved from the backend)
// ============================================================
// B4-A split one column into two facts, because they answer different
// questions and nothing could tell them apart:
//
//   humanExecutedAt     an operator SAID they acted. A claim. Nothing verified
//                       it, no platform confirmed it, Lumi did not perform it.
//   platformExecutedAt  the canonical worker reached EXECUTED_SUCCESS on a real
//                       ExecutionRequest. The ONLY evidence Lumi executed.
//
// This vocabulary is that split as a value a reader can branch on without
// comparing timestamps or guessing. It has existed on the backend since B4-A
// with exactly that docstring — and ZERO callers, while the campaign timeline
// compared timestamps, guessed, and told operators a human had performed a
// mutation Lumi's worker landed.
//
// ── WHY IT LIVES HERE AND NOT IN THE BACKEND ────────────────────────────────
// C-07's rule: a vocabulary belongs in the shared package when the CLIENT must
// branch on its values. The last reader standing is a client — the timeline
// label. The computation stays backend-side (`provenanceOf`), because the
// client never derives; it receives.
//
// ── JURISDICTION ────────────────────────────────────────────────────────────
// `_PROVENANCE` sits outside C-06's `_STATUS|_STATE|_REASON|_RUN`, like
// `_CLASS` (C-10) and `_OUTCOME` (C-18), so the epistemic census is untouched.
// The suffix is not the argument: these values report the SUBJECT — who acted —
// not our position on knowing. A row where we could not establish provenance
// does not get a fifth value here; it gets no token, and the reader says so.
// ============================================================

/** The four answers, and NONE is one of them. */
export const EXECUTION_PROVENANCE = Object.freeze({
  /** Nobody acted. A real answer, and NOT the same as "we did not look". */
  NONE: 'NONE',
  /** An operator's self-report only. A claim, never proof Lumi did anything. */
  HUMAN: 'HUMAN',
  /** Lumi executed it on the platform. The only execution evidence there is. */
  PLATFORM: 'PLATFORM',
  /** Both records exist. They do not contradict — neither implies the other. */
  BOTH: 'BOTH',
});

/** The token values, for validation and for tests that must be exhaustive. */
export const EXECUTION_PROVENANCE_VALUES = Object.freeze(Object.values(EXECUTION_PROVENANCE));

/** PURE: is this one of the four? `null`/`undefined` are not — see above. */
export function isExecutionProvenance(value) {
  return EXECUTION_PROVENANCE_VALUES.includes(value);
}
