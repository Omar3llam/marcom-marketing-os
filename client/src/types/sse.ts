// ============================================================
// MARCOM v4.1 — Server-Sent Events Types
// ------------------------------------------------------------
// TypeScript definitions for real-time execution updates.
// Based on: BACKEND-CONTRACTS.md § Real-Time Events (SSE)
//
// FROZEN: These types match backend SSE contracts.
// Do NOT modify without updating BACKEND-CONTRACTS.md first.
// ============================================================

/**
 * POST /api/events/token response.
 */
export interface SSETokenResponse {
  streamToken: string;
  expiresIn: number;
}

/**
 * SSE execution status.
 */
export type SSEExecutionStatus =
  | 'QUEUED'
  | 'EXECUTING'
  | 'EXECUTED_SUCCESS'
  | 'EXECUTED_FAILED';

/**
 * SSE event types.
 */
export type SSEEvent =
  | {
      type: 'CONNECTED';
      timestamp: string;
    }
  | {
      type: 'EXECUTION_STATUS';
      status: SSEExecutionStatus;
      targetId: string;
      actionType: string;
      auditLogId?: string;
      error?: string;
      timestamp: string;
    };

/**
 * SSE connection state.
 */
export type SSEConnectionState =
  | 'idle'        // Not connected
  | 'connecting'  // Fetching stream token
  | 'connected'   // EventSource open
  | 'error'       // Connection failed
  | 'closed';     // EventSource closed

/**
 * SSE reconnection config.
 */
export interface SSEReconnectConfig {
  maxAttempts: number;
  delayMs: number[];
}
