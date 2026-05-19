/**
 * Decision Orchestration FSM (Phase 11)
 *
 * Explicit state machine for decision execution lifecycle.
 * Prevents race conditions, state divergence, and execution chaos.
 *
 * Architecture:
 * - 11 states with explicit transitions
 * - Timeout guards (90s execution limit)
 * - Retry budget (5 max attempts with exponential backoff)
 * - Circuit breaker integration
 * - SSE fallback (polling if stream drops)
 * - Cancellation semantics (wait for in-flight completion)
 *
 * States:
 *   IDLE → VALIDATING → PLANNING → EXECUTING → STREAMING
 *     → PARTIAL_SUCCESS | SUCCESS | DEGRADED | RETRYING | FAILED | ABORTED
 */
import { setup, assign, fromPromise, raise } from 'xstate';
import type { LumiFeedResponse } from '@/contracts/schemas';
import type { AppError } from '@/contracts/errors';
import { track } from '@/lib/telemetry';
import {
  trackError,
  trackRetryAttempt,
  trackErrorResolution,
  trackDegradedState,
} from '@/lib/errorTelemetry';

// ══════════════════════════════════════════════════════════════
// Context Types
// ══════════════════════════════════════════════════════════════

export interface DecisionContext {
  // Input/Output
  mode: 'csv' | 'meta' | 'campaign' | null;
  inputData: any;
  outputData: LumiFeedResponse | null;

  // Execution tracking
  actionId: string | null;
  idempotencyKey: string | null;
  executionStartTime: number | null;

  // Error state
  error: AppError | null;
  retryCount: number;
  retryDelay: number;
  lastRetryTime: number | null;

  // Circuit state
  circuitOpen: boolean;
  circuitOpenUntil: number | null;

  // SSE state
  sseConnected: boolean;
  sseDropped: boolean;
  pollAttempts: number;

  // History
  history: any[];
  radarAlerts: any[];

  // Metadata
  stateStartTime: number;
  executionTimeoutAt: number | null;
}

export interface DecisionEvent {
  type: string;
  [key: string]: any;
}

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

const EXECUTION_TIMEOUT_MS = 90_000; // 90s
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY = 2000; // 2s
const RETRY_MAX_DELAY = 32_000; // 32s
const CIRCUIT_BREAKER_OPEN_DURATION = 60_000; // 60s
const SSE_POLL_MAX_ATTEMPTS = 10;
const SSE_POLL_INTERVAL = 5000; // 5s

// ══════════════════════════════════════════════════════════════
// Machine Definition
// ══════════════════════════════════════════════════════════════

export const decisionMachine = setup({
  types: {
    context: {} as DecisionContext,
    events: {} as DecisionEvent,
  },

  guards: {
    /**
     * Check if retry budget exhausted
     */
    canRetry: ({ context }) => {
      return context.retryCount < RETRY_MAX_ATTEMPTS;
    },

    /**
     * Check if circuit breaker is open
     */
    isCircuitOpen: ({ context }) => {
      if (!context.circuitOpen) return false;
      if (!context.circuitOpenUntil) return false;

      // Circuit auto-closes after timeout
      if (Date.now() > context.circuitOpenUntil) {
        return false; // Circuit closed
      }

      return true; // Circuit still open
    },

    /**
     * Check if execution timeout exceeded
     */
    isExecutionTimeout: ({ context }) => {
      if (!context.executionTimeoutAt) return false;
      return Date.now() > context.executionTimeoutAt;
    },

    /**
     * Check if SSE connection dropped during execution
     */
    isSseDropped: ({ context }) => {
      return context.sseDropped && context.pollAttempts < SSE_POLL_MAX_ATTEMPTS;
    },

    /**
     * Check if error is retryable
     */
    isRetryableError: ({ context }) => {
      return context.error?.retryable ?? false;
    },
  },

  actions: {
    /**
     * Track state transition for observability
     */
    trackTransition: ({ context }, params: { from: string; to: string; reason?: string }) => {
      const elapsed = Date.now() - context.stateStartTime;
      track('fsm_transition', {
        from: params.from,
        to: params.to,
        reason: params.reason,
        elapsed,
        actionId: context.actionId,
        retryCount: context.retryCount,
      });
    },

    /**
     * Track error occurrence
     */
    trackErrorOccurred: ({ context }) => {
      if (context.error) {
        trackError(context.error, {
          component: 'DecisionMachine',
          action: 'execution',
          actionId: context.actionId || undefined,
        });
      }
    },

    /**
     * Track retry attempt
     */
    trackRetry: ({ context }) => {
      if (context.error) {
        trackRetryAttempt(context.error, {
          attempt: context.retryCount + 1,
          delay: context.retryDelay,
          maxAttempts: RETRY_MAX_ATTEMPTS,
          strategy: 'exponential_backoff',
        });
      }
    },

    /**
     * Track error resolution
     */
    trackResolution: ({ context }) => {
      if (context.error) {
        const timeToResolve = Date.now() - (context.lastRetryTime || context.executionStartTime || Date.now());
        trackErrorResolution({
          errorCode: context.error.code || 'UNKNOWN',
          resolutionMethod: context.retryCount > 0 ? 'retry' : 'auto_recovery',
          timeToResolve,
          requestId: context.error.requestId,
        });
      }
    },

    /**
     * Track degraded state
     */
    trackDegraded: ({ context }) => {
      trackDegradedState({
        feature: 'decision_execution',
        degradationType: 'fallback',
        cause: context.circuitOpen ? 'circuit_breaker_open' : 'orchestrator_failure',
      });
    },

    /**
     * Open circuit breaker
     */
    openCircuit: assign({
      circuitOpen: true,
      circuitOpenUntil: Date.now() + CIRCUIT_BREAKER_OPEN_DURATION,
    }),

    /**
     * Close circuit breaker
     */
    closeCircuit: assign({
      circuitOpen: false,
      circuitOpenUntil: null,
    }),

    /**
     * Increment retry count and calculate backoff delay
     */
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1,
      retryDelay: ({ context }) => {
        const attempt = context.retryCount + 1;
        const delay = Math.min(
          RETRY_BASE_DELAY * Math.pow(2, attempt - 1),
          RETRY_MAX_DELAY
        );
        // Add jitter (±10%)
        const jitter = delay * 0.1 * (Math.random() * 2 - 1);
        return Math.floor(delay + jitter);
      },
      lastRetryTime: Date.now(),
    }),

    /**
     * Reset retry state
     */
    resetRetry: assign({
      retryCount: 0,
      retryDelay: RETRY_BASE_DELAY,
      lastRetryTime: null,
    }),

    /**
     * Set execution timeout
     */
    setExecutionTimeout: assign({
      executionStartTime: Date.now(),
      executionTimeoutAt: Date.now() + EXECUTION_TIMEOUT_MS,
    }),

    /**
     * Clear execution timeout
     */
    clearExecutionTimeout: assign({
      executionStartTime: null,
      executionTimeoutAt: null,
    }),

    /**
     * Mark SSE as dropped
     */
    markSseDropped: assign({
      sseDropped: true,
      pollAttempts: 0,
    }),

    /**
     * Increment SSE poll attempts
     */
    incrementPollAttempts: assign({
      pollAttempts: ({ context }) => context.pollAttempts + 1,
    }),

    /**
     * Reset SSE state
     */
    resetSseState: assign({
      sseDropped: false,
      pollAttempts: 0,
    }),

    /**
     * Update state start time (for elapsed tracking)
     */
    updateStateStartTime: assign({
      stateStartTime: Date.now(),
    }),

    /**
     * Store error
     */
    storeError: assign({
      error: (_, params: { error: AppError }) => params.error,
    }),

    /**
     * Clear error
     */
    clearError: assign({
      error: null,
    }),

    /**
     * Store output data
     */
    storeOutput: assign({
      outputData: (_, params: { data: LumiFeedResponse }) => params.data,
    }),
  },

  actors: {
    /**
     * Validate input data
     */
    validateInput: fromPromise(async ({ input }: { input: { data: any; mode: string } }) => {
      const { validateInput: validateInputService } = await import('./services');
      return validateInputService({ data: input.data, mode: input.mode });
    }),

    /**
     * Plan execution (call orchestrator)
     */
    planExecution: fromPromise(async ({ input }: { input: { data: any; mode: string } }) => {
      const { planExecution: planExecutionService } = await import('./services');
      return planExecutionService({ data: input.data, mode: input.mode });
    }),

    /**
     * Execute action via Meta API
     */
    executeAction: fromPromise(async ({ input }: { input: { actionId: string; idempotencyKey: string; plan: any } }) => {
      const { executeAction: executeActionService } = await import('./services');

      // Extract action details from plan
      const firstAlert = input.plan?.campaigns?.[0]?.alerts?.[0];
      if (!firstAlert) {
        throw new Error('No alert in plan to execute');
      }

      // Map verdict to actionType
      const actionTypeMap: Record<string, string> = {
        KILL: 'PAUSE_CAMPAIGN',
        PAUSE: 'PAUSE_CAMPAIGN',
        HOLD: 'PAUSE_CAMPAIGN',
        SCALE: 'SCALE_CAMPAIGN',
        OPTIMIZE: 'OPTIMIZE_CAMPAIGN',
      };
      const actionType = actionTypeMap[firstAlert.verdict] || 'PAUSE_CAMPAIGN';

      // Extract target info
      const targetId = input.plan?.campaigns?.[0]?.id || 'unknown';
      const targetType = 'campaign';

      return executeActionService({
        actionId: input.actionId,
        idempotencyKey: input.idempotencyKey,
        actionType,
        targetId,
        targetType,
        options: {},
      });
    }),

    /**
     * Poll execution status (fallback when SSE drops)
     */
    pollExecutionStatus: fromPromise(async ({ input }: { input: { actionId: string } }) => {
      const { pollExecutionStatus: pollExecutionStatusService } = await import('./services');
      return pollExecutionStatusService({ actionId: input.actionId });
    }),
  },
}).createMachine({
  id: 'decisionMachine',

  initial: 'idle',

  context: {
    mode: null,
    inputData: null,
    outputData: null,
    actionId: null,
    idempotencyKey: null,
    executionStartTime: null,
    error: null,
    retryCount: 0,
    retryDelay: RETRY_BASE_DELAY,
    lastRetryTime: null,
    circuitOpen: false,
    circuitOpenUntil: null,
    sseConnected: false,
    sseDropped: false,
    pollAttempts: 0,
    history: [],
    radarAlerts: [],
    stateStartTime: Date.now(),
    executionTimeoutAt: null,
  },

  states: {
    /**
     * IDLE — Waiting for user input
     */
    idle: {
      entry: ['updateStateStartTime', 'clearError', 'resetRetry'],
      on: {
        START_FLOW: {
          target: 'validating',
          actions: assign({
            mode: ({ event }) => event.mode,
            inputData: ({ event }) => event.inputData,
          }),
        },
      },
    },

    /**
     * VALIDATING — Validate input data
     */
    validating: {
      entry: 'updateStateStartTime',
      invoke: {
        src: 'validateInput',
        input: ({ context }) => ({ data: context.inputData, mode: context.mode }),
        onDone: {
          target: 'planning',
          actions: assign({
            inputData: ({ event }) => event.output.data,
          }),
        },
        onError: {
          target: 'failed',
          actions: [
            assign({
              error: ({ event }) => event.error as AppError,
            }),
            'trackErrorOccurred',
          ],
        },
      },
    },

    /**
     * PLANNING — Call orchestrator (Claude + GPT)
     */
    planning: {
      entry: ['updateStateStartTime', 'closeCircuit'],
      always: [
        {
          guard: 'isCircuitOpen',
          target: 'degraded',
          actions: 'trackDegraded',
        },
      ],
      invoke: {
        src: 'planExecution',
        input: ({ context }) => ({ data: context.inputData, mode: context.mode }),
        onDone: {
          target: 'executing',
          actions: [
            assign({
              outputData: ({ event }) => event.output.plan,
              actionId: ({ event }) => event.output.actionId,
              idempotencyKey: ({ event }) => event.output.idempotencyKey,
            }),
            'setExecutionTimeout',
          ],
        },
        onError: [
          {
            guard: ({ context }) => context.retryCount === 2,
            target: 'degraded',
            actions: ['openCircuit', 'trackDegraded'],
          },
          {
            guard: 'canRetry',
            target: 'retrying',
            actions: [
              'storeError',
              'incrementRetry',
              'trackRetry',
            ],
          },
          {
            target: 'failed',
            actions: [
              'storeError',
              'trackErrorOccurred',
            ],
          },
        ],
      },
    },

    /**
     * EXECUTING — Execute action via Meta API
     */
    executing: {
      entry: ['updateStateStartTime', 'resetSseState'],
      after: {
        [EXECUTION_TIMEOUT_MS]: {
          target: 'failed',
          actions: assign({
            error: {
              message: 'Execution timeout (90s exceeded)',
              code: 'EXECUTION_TIMEOUT',
              classification: 'platform',
              severity: 'high',
              retryable: true,
            } as any,
          }),
        },
      },
      invoke: {
        src: 'executeAction',
        input: ({ context }) => ({
          actionId: context.actionId!,
          idempotencyKey: context.idempotencyKey!,
          plan: context.outputData,
        }),
        onDone: {
          target: 'streaming',
        },
        onError: [
          {
            guard: 'canRetry',
            target: 'retrying',
            actions: [
              'storeError',
              'incrementRetry',
              'trackRetry',
            ],
          },
          {
            target: 'failed',
            actions: [
              'storeError',
              'trackErrorOccurred',
            ],
          },
        ],
      },
      on: {
        SSE_DISCONNECTED: {
          actions: 'markSseDropped',
        },
        EXECUTION_TIMEOUT_OVERRIDE: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => event.error,
          }),
        },
      },
    },

    /**
     * STREAMING — Waiting for SSE status updates
     */
    streaming: {
      entry: 'updateStateStartTime',
      always: [
        {
          guard: 'isSseDropped',
          target: 'polling',
        },
      ],
      on: {
        SSE_STATUS_UPDATE: [
          {
            guard: ({ event }) => event.status === 'EXECUTED_SUCCESS',
            target: 'success',
            actions: ['clearExecutionTimeout', 'trackResolution'],
          },
          {
            guard: ({ event }) => event.status === 'EXECUTED_FAILED',
            target: 'failed',
            actions: [
              assign({
                error: ({ event }) => event.error,
              }),
              'clearExecutionTimeout',
              'trackErrorOccurred',
            ],
          },
          {
            guard: ({ event }) => event.status === 'PARTIAL_SUCCESS',
            target: 'partialSuccess',
            actions: 'clearExecutionTimeout',
          },
        ],
        SSE_DISCONNECTED: {
          target: 'polling',
          actions: 'markSseDropped',
        },
        CANCEL: {
          target: 'aborted',
          actions: 'clearExecutionTimeout',
        },
      },
    },

    /**
     * POLLING — SSE dropped, polling for status
     */
    polling: {
      entry: 'updateStateStartTime',
      invoke: {
        src: 'pollExecutionStatus',
        input: ({ context }) => ({ actionId: context.actionId! }),
        onDone: [
          {
            guard: ({ event }) => event.output.status === 'EXECUTED_SUCCESS',
            target: 'success',
            actions: ['clearExecutionTimeout', 'trackResolution'],
          },
          {
            guard: ({ event }) => event.output.status === 'EXECUTED_FAILED',
            target: 'failed',
            actions: [
              assign({
                error: ({ event }) => event.output.error,
              }),
              'clearExecutionTimeout',
              'trackErrorOccurred',
            ],
          },
          {
            actions: 'incrementPollAttempts',
          },
        ],
        onError: {
          target: 'failed',
          actions: [
            assign({
              error: ({ event }) => event.error as AppError,
            }),
            'clearExecutionTimeout',
            'trackErrorOccurred',
          ],
        },
      },
      after: {
        [SSE_POLL_INTERVAL]: [
          {
            guard: ({ context }) => context.pollAttempts >= SSE_POLL_MAX_ATTEMPTS,
            target: 'failed',
            actions: assign({
              error: {
                message: 'Execution status polling exhausted',
                code: 'POLL_EXHAUSTED',
                classification: 'stream',
                severity: 'high',
                retryable: false,
              } as any,
            }),
          },
          {
            target: 'polling',
            reenter: true,
          },
        ],
      },
    },

    /**
     * RETRYING — Exponential backoff retry
     */
    retrying: {
      entry: 'updateStateStartTime',
      after: {
        2000: {
          guard: ({ context }) => context.retryCount === 1,
          target: 'planning',
        },
        4000: {
          guard: ({ context }) => context.retryCount === 2,
          target: 'planning',
        },
        8000: {
          guard: ({ context }) => context.retryCount === 3,
          target: 'planning',
        },
        16000: {
          guard: ({ context }) => context.retryCount === 4,
          target: 'planning',
        },
        32000: {
          guard: ({ context }) => context.retryCount >= 5,
          target: 'planning',
        },
      },
      on: {
        CANCEL: {
          target: 'aborted',
        },
      },
    },

    /**
     * DEGRADED — Circuit open, fallback mode
     */
    degraded: {
      entry: ['updateStateStartTime', 'clearExecutionTimeout'],
      on: {
        RETRY: {
          target: 'planning',
          guard: ({ context }) => !context.circuitOpen || Date.now() > (context.circuitOpenUntil || 0),
          actions: 'resetRetry',
        },
        RESET: {
          target: 'idle',
        },
      },
    },

    /**
     * PARTIAL_SUCCESS — Some actions succeeded, some failed
     */
    partialSuccess: {
      entry: ['updateStateStartTime', 'clearExecutionTimeout'],
      on: {
        CONFIRM: {
          target: 'success',
        },
        RETRY_FAILED: {
          target: 'retrying',
        },
        RESET: {
          target: 'idle',
        },
      },
    },

    /**
     * SUCCESS — Execution completed successfully
     */
    success: {
      entry: ['updateStateStartTime', 'clearExecutionTimeout', 'resetRetry'],
      on: {
        COMMIT_TO_MEMORY: {
          target: 'idle',
          actions: assign({
            history: ({ context }) => [context.outputData, ...context.history].slice(0, 20),
          }),
        },
        RESET: {
          target: 'idle',
        },
      },
    },

    /**
     * FAILED — Execution failed (non-retryable or retry budget exhausted)
     */
    failed: {
      entry: ['updateStateStartTime', 'clearExecutionTimeout'],
      on: {
        RETRY: [
          {
            guard: 'canRetry',
            target: 'planning',
            actions: ['incrementRetry', 'trackRetry'],
          },
          {
            // Retry budget exhausted
            actions: 'trackErrorOccurred',
          },
        ],
        RESET: {
          target: 'idle',
        },
      },
    },

    /**
     * ABORTED — User cancelled execution
     */
    aborted: {
      entry: ['updateStateStartTime', 'clearExecutionTimeout'],
      on: {
        RESET: {
          target: 'idle',
        },
      },
    },
  },
});
