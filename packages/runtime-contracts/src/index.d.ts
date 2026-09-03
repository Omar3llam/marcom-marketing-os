// ============================================================
// @marcom/runtime-contracts · TypeScript declarations
// ============================================================
// Companion .d.ts for the .js runtime modules. Authored by hand
// so frontend TypeScript consumers get type safety without a
// build step on the package itself.
// ============================================================

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
