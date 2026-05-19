/**
 * Services Layer (Phase 11C)
 *
 * Resilient client services for external communication.
 */

// SSE Client
export { SSEClient, createSSEClient } from './sseClient';
export type { SSEState, SSEClientOptions, SSEMetrics } from './sseClient';

// SSE React Hook
export { useSSE, useExecutionStream } from './useSSE';
export type { UseSSEOptions, UseSSEResult } from './useSSE';
