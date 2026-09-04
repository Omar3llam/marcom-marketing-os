// ============================================================
// @marcom/runtime-contracts
// ============================================================
// Single source of truth for runtime contracts shared across:
//   - backend (src/)
//   - workers (src/workers/)
//   - frontend (client/src/)
//
// What lives here:
//   - ExecutionStatus + transition matrix + helpers
//   - TransitionActor enum (matches Prisma)
//   - Timeout policy + overage detection
//   - Reconciliation payload contract
//   - Epistemic status tokens + vocabulary declarations (C-06)
//   - Gating reasons + their prerequisites (C-07)
//   - Confidence dimension field identities (C-09)
//   - Plan promotion outcomes (C-18)
//   - Decision classes (C-10)
//
// What does NOT live here:
//   - Date-arithmetic helpers tied to a specific runtime (e.g. retry
//     backoff timers — these stay in their respective services)
//   - UI/visual semantics (colors, dots, layout — stay in client)
//   - Prisma schema (stays in prisma/schema.prisma; the enum here
//     mirrors it and the comment is the contract)
// ============================================================

export {
  ExecutionStatus,
  TERMINAL_STATUSES,
  IN_FLIGHT_STATUSES,
  FAILURE_STATUSES,
  STATE_TRANSITION_MATRIX,
  isTerminalState,
  isInFlightState,
  isFailureState,
  isLegalTransition,
  getAllowedNextStates,
  getTransitionMatrix,
  IllegalTransitionError,
} from './executionStatus.js';

export {
  TransitionActor,
  isValidActor,
} from './transitionActors.js';

export {
  TIMEOUT_POLICY,
  getTimeoutForStatus,
  getTimeoutOverageMs,
  isExecutionTimedOut,
} from './timeoutPolicy.js';

export {
  validateReconciliationPayload,
  createReconciliationPayload,
} from './reconciliation.js';

export {
  KNOWLEDGE,
  KNOWLEDGE_VALUES,
  declareStatusVocabulary,
  VocabularyDeclarationError,
} from './epistemicStatus.js';

export {
  GATING_REASON,
  GATING_REASON_VALUES,
  PREREQUISITE,
  PREREQUISITE_VALUES,
  GATING_REASONS,
  declareGatingReasons,
  isGatingReason,
  knowledgeOfGatingReason,
  prerequisiteOfGatingReason,
  withGatingKnowledge,
  GatingReasonDeclarationError,
  UndeclaredGatingReasonError,
} from './gatingReason.js';

export {
  COMPLETENESS_FIELD,
  COMPLETENESS_FIELD_VALUES,
  isCompletenessField,
} from './confidenceDimensions.js';

export {
  PROMOTION_OUTCOME,
  PROMOTION_OUTCOME_VALUES,
  isPromotionOutcome,
} from './promotionOutcome.js';

export {
  DECISION_CLASS,
  DECISION_CLASS_VALUES,
  isDecisionClass,
} from './decisionClass.js';

export {
  EXECUTION_PROVENANCE,
  EXECUTION_PROVENANCE_VALUES,
  isExecutionProvenance,
} from './executionProvenance.js';
