/**
 * useSSE Hook (Phase 11C)
 *
 * React hook for SSE client integration.
 * Provides automatic connection/cleanup and state management.
 *
 * @example
 * ```tsx
 * function ExecutionMonitor() {
 *   const { state, metrics, connect, disconnect } = useSSE({
 *     onMessage: (event) => {
 *       const data = JSON.parse(event.data);
 *       if (data.type === 'EXECUTION_STATUS') {
 *         updateExecutionStatus(data.status);
 *       }
 *     },
 *     autoConnect: true, // Auto-connect on mount
 *   });
 *
 *   return (
 *     <div>
 *       <span>Connection: {state}</span>
 *       <span>Messages: {metrics.totalMessages}</span>
 *     </div>
 *   );
 * }
 * ```
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { SSEClient, type SSEState, type SSEMetrics, type SSEClientOptions } from './sseClient';

export interface UseSSEOptions {
  /** Message handler */
  onMessage: (event: MessageEvent) => void;
  /** Error handler (optional) */
  onError?: (error: Error) => void;
  /** Auto-connect on mount (default: false) */
  autoConnect?: boolean;
  /** Max reconnect attempts (default: 5) */
  maxRetries?: number;
  /** Base delay for backoff (default: 2000ms) */
  baseDelay?: number;
  /** Max delay between retries (default: 32000ms) */
  maxDelay?: number;
}

export interface UseSSEResult {
  /** Current connection state */
  state: SSEState;
  /** Connection metrics */
  metrics: SSEMetrics;
  /** Connect to stream */
  connect: () => Promise<void>;
  /** Disconnect from stream */
  disconnect: () => void;
  /** Is connected */
  isConnected: boolean;
  /** Is connecting */
  isConnecting: boolean;
  /** Is reconnecting */
  isReconnecting: boolean;
  /** Is failed */
  isFailed: boolean;
}

/**
 * React hook for SSE client
 *
 * Manages SSE connection lifecycle, state, and metrics.
 */
export function useSSE(options: UseSSEOptions): UseSSEResult {
  const [state, setState] = useState<SSEState>('IDLE');
  const [metrics, setMetrics] = useState<SSEMetrics>({
    state: 'IDLE',
    reconnectAttempts: 0,
    lastConnected: null,
    lastDisconnected: null,
    downtime: 0,
    totalMessages: 0,
    totalErrors: 0,
  });

  const clientRef = useRef<SSEClient | null>(null);

  // Initialize client on mount
  useEffect(() => {
    const client = new SSEClient({
      onMessage: options.onMessage,
      onError: options.onError,
      onStateChange: (newState) => {
        setState(newState);
        setMetrics(client.getMetrics());
      },
      maxRetries: options.maxRetries,
      baseDelay: options.baseDelay,
      maxDelay: options.maxDelay,
    });

    clientRef.current = client;

    // Auto-connect if enabled
    if (options.autoConnect) {
      client.connect();
    }

    // Cleanup on unmount
    return () => {
      client.disconnect();
    };
  }, [
    options.onMessage,
    options.onError,
    options.autoConnect,
    options.maxRetries,
    options.baseDelay,
    options.maxDelay,
  ]);

  // Update metrics periodically while connected
  useEffect(() => {
    if (state === 'CONNECTED' || state === 'RECONNECTING') {
      const interval = setInterval(() => {
        if (clientRef.current) {
          setMetrics(clientRef.current.getMetrics());
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [state]);

  // Connect method
  const connect = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.connect();
    }
  }, []);

  // Disconnect method
  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
  }, []);

  // Derived state
  const isConnected = state === 'CONNECTED';
  const isConnecting = state === 'CONNECTING';
  const isReconnecting = state === 'RECONNECTING';
  const isFailed = state === 'FAILED';

  return {
    state,
    metrics,
    connect,
    disconnect,
    isConnected,
    isConnecting,
    isReconnecting,
    isFailed,
  };
}

/**
 * Hook for execution status streaming
 *
 * Simplified hook for monitoring execution status via SSE.
 * Automatically handles EXECUTION_STATUS events.
 *
 * @example
 * ```tsx
 * function ExecutionMonitor({ actionId }) {
 *   const { status, error, isConnected } = useExecutionStream({
 *     onStatusUpdate: (status, error) => {
 *       console.log('Status:', status, error);
 *     },
 *   });
 *
 *   if (!isConnected) return <div>Connecting...</div>;
 *   return <div>Status: {status}</div>;
 * }
 * ```
 */
export function useExecutionStream(options: {
  onStatusUpdate: (status: string, error?: string) => void;
  autoConnect?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'EXECUTION_STATUS') {
          setStatus(data.status);
          setError(data.error || null);
          options.onStatusUpdate(data.status, data.error);
        }
      } catch (err) {
        console.error('[useExecutionStream] Failed to parse message:', err);
      }
    },
    [options]
  );

  const sse = useSSE({
    onMessage: handleMessage,
    autoConnect: options.autoConnect ?? true,
  });

  return {
    ...sse,
    status,
    error,
  };
}
