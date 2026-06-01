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
  /**
   * Guard for autoConnect — defer connection until this is non-null.
   * Pass the authenticated user's UID (or any workspace-identifying string).
   * When null, connect() is not called even if autoConnect is true.
   * When omitted (undefined), behavior is unchanged: connect fires on mount.
   */
  workspaceId?: string | null;
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
  // Capture autoConnect at construction time — it is static for the lifetime of the hook.
  const autoConnectRef = useRef(options.autoConnect);

  // Store callbacks in refs so SSEClient is not recreated when they change
  const onMessageRef = useRef(options.onMessage);
  const onErrorRef = useRef(options.onError);
  useEffect(() => { onMessageRef.current = options.onMessage; }, [options.onMessage]);
  useEffect(() => { onErrorRef.current = options.onError; }, [options.onError]);

  // Create SSEClient ONCE on mount — never recreate it
  useEffect(() => {
    const client = new SSEClient({
      onMessage: (event) => onMessageRef.current(event),
      onError: (error) => onErrorRef.current?.(error),
      onStateChange: (newState) => {
        setState(newState);
        setMetrics(client.getMetrics());
      },
      maxRetries: options.maxRetries,
      baseDelay: options.baseDelay,
      maxDelay: options.maxDelay,
    });

    clientRef.current = client;

    return () => {
      client.disconnect();
    };
  }, []); // ← EMPTY dependency array: create once, never recreate

  // Deferred autoConnect — fires when workspaceId becomes available.
  // If workspaceId is not passed (undefined), connect immediately on mount.
  // If workspaceId is null, defer until it resolves to a non-null string.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoConnectRef.current) return;
    if (options.workspaceId === null) return;
    clientRef.current?.connect();
  }, [options.workspaceId]);

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

  const connect = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.connect();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
  }, []);

  return {
    state,
    metrics,
    connect,
    disconnect,
    isConnected: state === 'CONNECTED',
    isConnecting: state === 'CONNECTING',
    isReconnecting: state === 'RECONNECTING',
    isFailed: state === 'FAILED',
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
