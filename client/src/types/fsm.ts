// ============================================================
// MARCOM v4.1 — FSM State Machine Types
// ------------------------------------------------------------
// TypeScript definitions for the 8-state decision FSM.
// Based on: BACKEND-CONTRACTS.md § FSM States
//
// FROZEN: These types match backend FSM contracts.
// Do NOT modify without updating BACKEND-CONTRACTS.md first.
// ============================================================

import type { FSMErrorDetails } from './errors';

/**
 * FSM view states (8-state decision pipeline).
 */
export type FSMView =
  | 'COMMAND_CENTER'    // Idle, awaiting input
  | 'INPUT_VALIDATION'  // User uploads CSV / connects Meta
  | 'THEATER'           // Locked — AI analysis in progress
  | 'SUCCESS'           // Decision ready, awaiting confirmation
  | 'CONFIRM_EXECUTION' // User confirms action
  | 'API_EXECUTION'     // Locked — Meta API call in progress
  | 'EXECUTION_QUEUED'  // Action queued in BullMQ
  | 'EXECUTING'         // Action executing on Meta
  | 'EXECUTED_SUCCESS'  // Action succeeded
  | 'EXECUTED_FAILED'   // Action failed
  | 'MEMORY_COMMIT'     // Persist to DecisionMemory
  | 'ERROR';            // Error state

/**
 * Input mode (CSV or Meta live fetch).
 */
export type InputMode = 'csv' | 'meta' | null;

/**
 * Execution status.
 */
export interface ExecutionStatus {
  status: 'QUEUED' | 'EXECUTING' | 'SUCCESS' | 'FAILED';
  error?: string;
  timestamp: string;
}

/**
 * FSM state shape.
 */
export interface FSMState {
  view: FSMView;
  activeMode: InputMode;
  inputData: any;
  outputData: any;
  errorDetails: FSMErrorDetails | null;
  isProcessing: boolean;
  isLocked: boolean;
  theatreStep: number;
  history: Array<any>;
  radarAlerts: Array<any>;
  executionStatus: ExecutionStatus | null;
}

/**
 * FSM actions (state transitions).
 */
export type FSMAction =
  | { type: 'START_FLOW'; mode: 'csv' | 'meta' }
  | { type: 'REVIEW_ALERT'; alertData: any }
  | { type: 'SUBMIT_INPUT'; inputData: any }
  | { type: 'THEATRE_ADVANCE'; step: number }
  | { type: 'PROCESS_SUCCESS'; data: any }
  | { type: 'PROCESS_ERROR'; message: string; code: string; classification: string; retryable: boolean; fallbackAction: string }
  | { type: 'CONFIRM_EXECUTION' }
  | { type: 'EXECUTE_ACTION' }
  | { type: 'EXECUTION_STATUS_UPDATE'; status: string; error?: string; timestamp: string }
  | { type: 'EXECUTION_COMPLETE' }
  | { type: 'COMMIT_TO_MEMORY' }
  | { type: 'RESET_FLOW' }
  | { type: 'REPLAY_DECISION'; data: any }
  | { type: 'LOAD_HISTORY'; history: Array<any> }
  | { type: 'LOAD_RADAR_ALERTS'; alerts: Array<any> }
  | { type: 'CLEAR_HISTORY' };
