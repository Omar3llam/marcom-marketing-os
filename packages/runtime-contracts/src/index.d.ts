// ============================================================
// @marcom/runtime-contracts · TypeScript declarations
// ============================================================
// Companion .d.ts for the .js runtime modules. Authored by hand
// so frontend TypeScript consumers get type safety without a
// build step on the package itself.
// ============================================================

export const SUPPORTED_CURRENCY_CODES: ReadonlyArray<string>;

// ── ExecutionStatus ─────────────────────────────────────────

export type ExecutionStatusValue =
  | 'PENDING'
  | 'QUEUED'
  | 'EXECUTING'
  | 'EXECUTED_SUCCESS'
  | 'EXECUTED_FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED';

export const ExecutionStatus: {
  readonly PENDING: 'PENDING';
  readonly QUEUED: 'QUEUED';
  readonly EXECUTING: 'EXECUTING';
  readonly EXECUTED_SUCCESS: 'EXECUTED_SUCCESS';
  readonly EXECUTED_FAILED: 'EXECUTED_FAILED';
  readonly TIMED_OUT: 'TIMED_OUT';
  readonly CANCELLED: 'CANCELLED';
};

export const TERMINAL_STATUSES: ReadonlyArray<ExecutionStatusValue>;
export const IN_FLIGHT_STATUSES: ReadonlyArray<ExecutionStatusValue>;
export const FAILURE_STATUSES: ReadonlyArray<ExecutionStatusValue>;

export function isTerminalState(status: string): boolean;
export function isInFlightState(status: string): boolean;
export function isFailureState(status: string): boolean;

export const STATE_TRANSITION_MATRIX: Readonly<
  Record<ExecutionStatusValue, ReadonlyArray<ExecutionStatusValue>>
>;

export function isLegalTransition(
  fromStatus: ExecutionStatusValue,
  toStatus: ExecutionStatusValue
): boolean;

export function getAllowedNextStates(
  currentStatus: ExecutionStatusValue
): ReadonlyArray<ExecutionStatusValue>;

export function getTransitionMatrix(): typeof STATE_TRANSITION_MATRIX;

export class IllegalTransitionError extends Error {
  readonly name: 'IllegalTransitionError';
  readonly fromStatus: ExecutionStatusValue;
  readonly toStatus: ExecutionStatusValue;
  readonly executionId: string | null;
  constructor(
    fromStatus: ExecutionStatusValue,
    toStatus: ExecutionStatusValue,
    executionId?: string | null
  );
}

// ── TransitionActor ─────────────────────────────────────────

export type TransitionActorValue =
  | 'WORKER'
  | 'TIMEOUT_HANDLER'
  | 'USER'
  | 'API'
  | 'RECONCILIATION'
  | 'RETRY_POLICY'
  | 'SUPERVISOR'
  | 'SYSTEM';

export const TransitionActor: {
  readonly WORKER: 'WORKER';
  readonly TIMEOUT_HANDLER: 'TIMEOUT_HANDLER';
  readonly USER: 'USER';
  readonly API: 'API';
  readonly RECONCILIATION: 'RECONCILIATION';
  readonly RETRY_POLICY: 'RETRY_POLICY';
  readonly SUPERVISOR: 'SUPERVISOR';
  readonly SYSTEM: 'SYSTEM';
};

export function isValidActor(actor: string): boolean;

// ── Timeout policy ──────────────────────────────────────────

export const TIMEOUT_POLICY: Readonly<
  Record<ExecutionStatusValue, number | null>
>;

export function getTimeoutForStatus(
  status: ExecutionStatusValue
): number | null;

export function getTimeoutOverageMs(
  status: string,
  elapsedMs: number | null | undefined
): number | null;

export function isExecutionTimedOut(
  execution: { status: string; updatedAt: Date | string },
  now?: Date
): boolean;

// ── Reconciliation ──────────────────────────────────────────

export interface ExecutionReconciliationPayload {
  executionId: string;
  status: ExecutionStatusValue;
  version: number;
  updatedAt: string;
  correlationId: string;
  activeStep?: string | null;
  retryMetadata?: {
    attempt: number;
    maxAttempts: number;
    nextRetryAt?: string | null;
  } | null;
  isTerminal: boolean;
}

export function validateReconciliationPayload(
  payload: Partial<ExecutionReconciliationPayload>
): true;

export function createReconciliationPayload(
  execution: Record<string, unknown>
): ExecutionReconciliationPayload;

// ── Epistemic status (C-06) ─────────────────────────────────

export const KNOWLEDGE: {
  readonly KNOWN: 'KNOWN';
  readonly COULD_NOT_LOOK: 'COULD_NOT_LOOK';
  readonly NOT_ENOUGH: 'NOT_ENOUGH';
  readonly NOTHING_THERE: 'NOTHING_THERE';
  readonly CANNOT_ASK: 'CANNOT_ASK';
};

export type KnowledgeToken = typeof KNOWLEDGE[keyof typeof KNOWLEDGE];

export const KNOWLEDGE_VALUES: readonly KnowledgeToken[];

export class VocabularyDeclarationError extends Error {}

export interface StatusVocabularyDeclaration {
  readonly name: string;
  readonly values: readonly string[];
  readonly mapping: Readonly<Record<string, KnowledgeToken>>;
  knowledgeOf(value: string | null | undefined): KnowledgeToken | null;
}

export function declareStatusVocabulary(
  name: string,
  vocabulary: Record<string, string>,
  mapping: Record<string, KnowledgeToken>
): StatusVocabularyDeclaration;

// -- Gating reasons (C-07) -----------------------------------

export const GATING_REASON: {
  readonly NO_MEASURABLE_DELIVERY: 'NO_MEASURABLE_DELIVERY';
  readonly NO_CANONICAL_WINDOW: 'NO_CANONICAL_WINDOW';
  readonly CANONICAL_EVIDENCE_STALE: 'CANONICAL_EVIDENCE_STALE';
};

export type GatingReason = typeof GATING_REASON[keyof typeof GATING_REASON];

export const GATING_REASON_VALUES: readonly GatingReason[];

export const PREREQUISITE: {
  readonly DELIVERY: 'DELIVERY';
  readonly FIRST_MEASUREMENT: 'FIRST_MEASUREMENT';
  readonly FRESH_MEASUREMENT: 'FRESH_MEASUREMENT';
};

export type Prerequisite = typeof PREREQUISITE[keyof typeof PREREQUISITE];

export const PREREQUISITE_VALUES: readonly Prerequisite[];

export class GatingReasonDeclarationError extends Error {}

export class UndeclaredGatingReasonError extends Error {
  readonly reason: string | null;
}

export interface GatingReasonDeclaration {
  readonly reason: GatingReason;
  readonly knowledge: KnowledgeToken;
  readonly prerequisite: Prerequisite;
}

export interface GatingReasonRegistry {
  readonly values: readonly string[];
  declarationOf(reason: string | null | undefined): GatingReasonDeclaration | null;
}

export const GATING_REASONS: GatingReasonRegistry;

export function declareGatingReasons(
  vocabulary: Record<string, string>,
  declarations: Record<string, { knowledge: KnowledgeToken; prerequisite: Prerequisite }>
): GatingReasonRegistry;

export function isGatingReason(reason: string | null | undefined): boolean;

export function knowledgeOfGatingReason(reason: string | null | undefined): KnowledgeToken | null;

export function prerequisiteOfGatingReason(reason: string | null | undefined): Prerequisite | null;

export function withGatingKnowledge<T extends { reason: string }>(
  row: T
): T & { knowledge: KnowledgeToken; prerequisite: Prerequisite };

// -- Confidence dimensions (C-09) ----------------------------

export const COMPLETENESS_FIELD: {
  readonly LPV: 'LPV';
  readonly ATC: 'ATC';
  readonly CREATED_TIME: 'CREATED_TIME';
  readonly OBJECTIVE: 'OBJECTIVE';
};

export type CompletenessField = typeof COMPLETENESS_FIELD[keyof typeof COMPLETENESS_FIELD];

export const COMPLETENESS_FIELD_VALUES: readonly CompletenessField[];

export function isCompletenessField(field: string | null | undefined): boolean;

/**
 * The decomposition of dataConfidence. Present exactly when dataConfidence is,
 * and null otherwise — an unknown sample yields no dimensions rather than a
 * fabricated sampleQuality of 0.
 */
export interface ConfidenceDimensions {
  readonly sampleQuality: number;
  readonly impressions: number;
  readonly dataCompleteness: number;
  readonly dataCompletenessMissingFields: readonly CompletenessField[];
  readonly temporalQuality: number;
  /** null when the age could not be established — the 0.70 above is a default, not a measurement. */
  readonly daysRunning: number | null;
}

// -- Plan promotion outcomes (C-18) --------------------------

export const PROMOTION_OUTCOME: {
  readonly PROMOTED: 'PROMOTED';
  readonly PROMOTED_WITH_NO_MOVES: 'PROMOTED_WITH_NO_MOVES';
  readonly PROMOTED_MOVES_NOT_MEASURABLE: 'PROMOTED_MOVES_NOT_MEASURABLE';
  readonly ALREADY_PROMOTED: 'ALREADY_PROMOTED';
};

export type PromotionOutcome = typeof PROMOTION_OUTCOME[keyof typeof PROMOTION_OUTCOME];

export const PROMOTION_OUTCOME_VALUES: readonly PromotionOutcome[];

export function isPromotionOutcome(value: string | null | undefined): boolean;

// -- Decision classes (C-10) ---------------------------------

export const DECISION_CLASS: {
  readonly SIGNAL: 'SIGNAL';
  readonly GUARDRAIL: 'GUARDRAIL';
  readonly ALLOCATION: 'ALLOCATION';
  readonly EXPERIMENT: 'EXPERIMENT';
};

export type DecisionClass = typeof DECISION_CLASS[keyof typeof DECISION_CLASS];

export const DECISION_CLASS_VALUES: readonly DecisionClass[];

export function isDecisionClass(value: string | null | undefined): boolean;

// ── C-12 · who acted on a decision ─────────────────────────────────────────
export const EXECUTION_PROVENANCE: {
  readonly NONE: 'NONE';
  readonly HUMAN: 'HUMAN';
  readonly PLATFORM: 'PLATFORM';
  readonly BOTH: 'BOTH';
};

export type ExecutionProvenance = typeof EXECUTION_PROVENANCE[keyof typeof EXECUTION_PROVENANCE];

export const EXECUTION_PROVENANCE_VALUES: readonly ExecutionProvenance[];

export function isExecutionProvenance(value: string | null | undefined): boolean;

/**
 * Which live object an Experiment attention item is about (C-13). The class
 * (EXPERIMENT) says what kind of call it is; this says which row it concerns.
 */
export const EXPERIMENT_SUBJECT: {
  readonly AB_TEST: 'AB_TEST';
  readonly HOLDOUT: 'HOLDOUT';
};

export type ExperimentSubject = typeof EXPERIMENT_SUBJECT[keyof typeof EXPERIMENT_SUBJECT];

export const EXPERIMENT_SUBJECT_VALUES: readonly ExperimentSubject[];

export function isExperimentSubject(value: string | null | undefined): boolean;
