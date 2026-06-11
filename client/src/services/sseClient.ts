/**
 * SSE Client with Exponential Backoff (Phase 11C)
 *
 * Resilient EventSource wrapper with:
 * - Exponential backoff on reconnect (2s → 32s max)
 * - Retry budget (5 max attempts)
 * - Jitter to prevent thundering herd
 * - Heartbeat timeout detection (30s)
 * - Telemetry integration (Phase 10D)
 * - Automatic token refresh
 *
 * Prevents SSE retry storms identified in Phase 11 audit.
 *
 * @example
 * ```tsx
 * const client = new SSEClient({
 *   onMessage: (event) => handleEvent(event),
 *   onError: (error) => console.error('SSE error:', error),
 *   onStateChange: (state) => updateState(state),
 * });
 *
 * await client.connect();
 * // ... later
 * client.disconnect();
 * ```
 */
import { api } from '@/lib/api';
import { track } from '@/lib/telemetry';
import {
  trackStreamRecovery,
  trackStreamFailure,
  trackError,
} from '@/lib/errorTelemetry';
import { NetworkError, StreamDisconnectError } from '@/contracts/errors';

// ══════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════

export type SSEState =
  | 'IDLE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'FAILED'
  | 'DISCONNECTED';

export interface SSEClientOptions {
  /** Callback for incoming messages */
  onMessage: (event: MessageEvent) => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
  /** Callback for state changes */
  onStateChange?: (state: SSEState) => void;
  /** Maximum reconnect attempts (default: 5) */
  maxRetries?: number;
  /** Base delay for exponential backoff (default: 2000ms) */
  baseDelay?: number;
  /** Maximum delay between retries (default: 32000ms) */
  maxDelay?: number;
  /** Jitter factor (0-1, default: 0.1 = ±10%) */
  jitter?: number;
  /** Heartbeat timeout (default: 30000ms) */
  heartbeatTimeout?: number;
  /** Optional Firebase token getter for legacy callers */
  getAuthToken?: () => Promise<string | null | undefined> | string | null | undefined;
}

export interface SSEMetrics {
  state: SSEState;
  reconnectAttempts: number;
  lastConnected: number | null;
  lastDisconnected: number | null;
  downtime: number;
  totalMessages: number;
  totalErrors: number;
}

// ══════════════════════════════════════════════════════════════
// SSE Client Implementation
// ══════════════════════════════════════════════════════════════

export class SSEClient {
  private eventSource: EventSource | null = null;
  private state: SSEState = 'IDLE';
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private streamToken: string | null = null;
  private lastConnected: number | null = null;
  private lastDisconnected: number | null = null;
  private totalMessages = 0;
  private totalErrors = 0;
  private connectionStartTime: number | null = null;

  // Options
  private readonly onMessage: (event: MessageEvent) => void;
  private readonly onError?: (error: Error) => void;
  private readonly onStateChange?: (state: SSEState) => void;
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly jitter: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly getAuthToken?: SSEClientOptions['getAuthToken'];

  constructor(options: SSEClientOptions) {
    this.onMessage = options.onMessage;
    this.onError = options.onError;
    this.onStateChange = options.onStateChange;
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelay = options.baseDelay ?? 2000;
    this.maxDelay = options.maxDelay ?? 32_000;
    this.jitter = options.jitter ?? 0.1;
    this.heartbeatTimeoutMs = options.heartbeatTimeout ?? 65_000;
    this.getAuthToken = options.getAuthToken;
  }

  /**
   * Connect to SSE stream
   *
   * Obtains stream token, then connects to EventSource.
   * Automatically reconnects on failure (with backoff).
   */
  async connect(): Promise<void> {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') {
      console.warn('[SSEClient] Already connected or connecting');
      return;
    }

    this.transitionTo('CONNECTING');
    this.connectionStartTime = Date.now();

    try {
      // Step 1: Obtain stream token (exchange Firebase JWT for short-lived UUID)
      const authToken = this.getAuthToken ? await this.getAuthToken() : null;
      const tokenResponse = await api.post('/api/events/token', null, authToken ? {
        headers: { Authorization: `Bearer ${authToken}` },
      } : undefined);
      this.streamToken = tokenResponse.data.streamToken;

      if (!this.streamToken) {
        throw new NetworkError({
          message: 'Failed to obtain stream token',
          code: 'SSE_TOKEN_FAILED',
          fallbackAction: 'Retry connection',
        });
      }

      // Step 2: Connect to SSE stream
      const streamUrl = `/api/events/stream?token=${this.streamToken}`;
      this.eventSource = new EventSource(streamUrl);

      // Event handlers
      this.eventSource.onopen = this.handleOpen.bind(this);
      this.eventSource.onmessage = this.handleMessage.bind(this);
      this.eventSource.onerror = this.handleError.bind(this);

      // Start heartbeat monitor
      this.resetHeartbeat();

      track('sse_connect_attempt', {
        attempt: this.reconnectAttempts + 1,
        maxRetries: this.maxRetries,
      });
    } catch (error: any) {
      // Special handling for rate limit — back off much longer
      const isRateLimit = error?.httpStatus === 429 || error?.code === 'RATE_LIMIT_EXCEEDED';
      if (isRateLimit) {
        const retryAfterSec = parseInt(error?.context?.retryAfter || '60', 10);
        const retryMs = Math.max(retryAfterSec * 1000, 60_000);
        console.warn(`[SSEClient] Rate limited on token request — waiting ${retryMs}ms before retry`);
        this.transitionTo('RECONNECTING');
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectAttempts = 0; // reset so retry budget is fresh after the long wait
          this.connect();
        }, retryMs);
        return;
      }
      this.handleConnectionError(error);
    }
  }

  /**
   * Disconnect from SSE stream
   *
   * Graceful shutdown: clears timers, closes EventSource.
   */
  disconnect(): void {
    this.clearTimers();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.transitionTo('DISCONNECTED');
    this.streamToken = null;

    track('sse_disconnect', {
      totalMessages: this.totalMessages,
      totalErrors: this.totalErrors,
      reconnectAttempts: this.reconnectAttempts,
    });
  }

  /**
   * Get current connection state
   */
  getState(): SSEState {
    return this.state;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): SSEMetrics {
    return {
      state: this.state,
      reconnectAttempts: this.reconnectAttempts,
      lastConnected: this.lastConnected,
      lastDisconnected: this.lastDisconnected,
      downtime: this.lastDisconnected && !this.lastConnected
        ? Date.now() - this.lastDisconnected
        : 0,
      totalMessages: this.totalMessages,
      totalErrors: this.totalErrors,
    };
  }

  // ════════════════════════════════════════════════════════════
  // Event Handlers
  // ════════════════════════════════════════════════════════════

  private handleOpen(): void {
    this.transitionTo('CONNECTED');
    this.lastConnected = Date.now();

    // Track recovery if this was a reconnect
    if (this.reconnectAttempts > 0) {
      const downtime = this.lastDisconnected
        ? Date.now() - this.lastDisconnected
        : 0;

      trackStreamRecovery({
        streamType: 'sse',
        endpoint: '/api/events/stream',
        downtime,
        reconnectAttempts: this.reconnectAttempts,
      });

      track('sse_reconnect_success', {
        attempts: this.reconnectAttempts,
        downtime,
      });
    } else {
      track('sse_connect_success', {
        connectionTime: this.connectionStartTime
          ? Date.now() - this.connectionStartTime
          : 0,
      });
    }

    // Reset retry counter on successful connection
    this.reconnectAttempts = 0;
  }

  private handleMessage(event: MessageEvent): void {
    this.totalMessages++;
    this.resetHeartbeat(); // Reset heartbeat timeout on any message

    try {
      // Parse message data
      const data = JSON.parse(event.data);

      // Handle heartbeat
      if (data.type === 'HEARTBEAT') {
        // Heartbeat received — no-op
        return;
      }

      // Forward to callback
      this.onMessage(event);
    } catch (error: any) {
      console.error('[SSEClient] Failed to parse message:', error);
      // Non-fatal — continue streaming
    }
  }

  private handleError(event: Event): void {
    this.totalErrors++;

    console.error('[SSEClient] EventSource error:', event);

    // EventSource automatically attempts reconnect on error
    // We'll handle reconnect logic manually with backoff
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.lastDisconnected = Date.now();

    const error = new StreamDisconnectError({
      message: 'SSE connection lost',
      code: 'SSE_DISCONNECT',
      fallbackAction: 'Reconnecting automatically...',
    });

    trackStreamFailure({
      streamType: 'sse',
      endpoint: '/api/events/stream',
      error,
      willRetry: this.reconnectAttempts < this.maxRetries,
    });

    if (this.onError) {
      this.onError(error);
    }

    // Attempt reconnect with backoff
    this.scheduleReconnect();
  }

  private handleConnectionError(error: Error): void {
    console.error('[SSEClient] Connection error:', error);

    trackError(error, {
      component: 'SSEClient',
      action: 'connect',
    });

    if (this.onError) {
      this.onError(error);
    }

    // Attempt reconnect with backoff
    this.scheduleReconnect();
  }

  // ════════════════════════════════════════════════════════════
  // Reconnect Logic
  // ════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    // Check retry budget
    if (this.reconnectAttempts >= this.maxRetries) {
      this.transitionTo('FAILED');
      console.error('[SSEClient] Max reconnect attempts reached');

      const error = new StreamDisconnectError({
        message: `SSE reconnect failed after ${this.maxRetries} attempts`,
        code: 'SSE_RECONNECT_EXHAUSTED',
        fallbackAction: 'Refresh page or contact support',
      });

      trackError(error, {
        component: 'SSEClient',
        action: 'reconnect',
        reconnectAttempts: this.reconnectAttempts,
      });

      if (this.onError) {
        this.onError(error);
      }

      return;
    }

    this.transitionTo('RECONNECTING');
    this.reconnectAttempts++;

    // Calculate exponential backoff delay with jitter
    const delay = this.calculateBackoffDelay(this.reconnectAttempts);

    track('sse_reconnect_scheduled', {
      attempt: this.reconnectAttempts,
      delay,
      maxRetries: this.maxRetries,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: baseDelay * 2^(attempt-1)
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelay);

    // Add jitter (±jitter%)
    const jitterAmount = cappedDelay * this.jitter * (Math.random() * 2 - 1);
    const finalDelay = Math.floor(cappedDelay + jitterAmount);

    return finalDelay;
  }

  // ════════════════════════════════════════════════════════════
  // Heartbeat Detection
  // ════════════════════════════════════════════════════════════

  private resetHeartbeat(): void {
    this.clearHeartbeatTimeout();

    this.heartbeatTimeout = setTimeout(() => {
      console.warn('[SSEClient] Heartbeat timeout — connection appears dead');

      // Treat as connection error
      const error = new StreamDisconnectError({
        message: 'SSE heartbeat timeout',
        code: 'SSE_HEARTBEAT_TIMEOUT',
        fallbackAction: 'Reconnecting...',
      });

      trackError(error, {
        component: 'SSEClient',
        action: 'heartbeat',
      });

      // Force reconnect
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      this.scheduleReconnect();
    }, this.heartbeatTimeoutMs);
  }

  // ════════════════════════════════════════════════════════════
  // State Management
  // ════════════════════════════════════════════════════════════

  private transitionTo(newState: SSEState): void {
    const oldState = this.state;
    this.state = newState;

    if (this.onStateChange) {
      this.onStateChange(newState);
    }

    track('sse_state_change', {
      from: oldState,
      to: newState,
      reconnectAttempts: this.reconnectAttempts,
    });
  }

  // ════════════════════════════════════════════════════════════
  // Cleanup
  // ════════════════════════════════════════════════════════════

  private clearTimers(): void {
    this.clearReconnectTimeout();
    this.clearHeartbeatTimeout();
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }
}

/**
 * Create SSE client with default options
 *
 * @param onMessage - Message handler
 * @param onError - Error handler (optional)
 * @returns SSEClient instance
 */
export function createSSEClient(
  onMessage: (event: MessageEvent) => void,
  onError?: (error: Error) => void,
  options: Partial<SSEClientOptions> = {}
): SSEClient {
  return new SSEClient({
    onMessage,
    onError,
    ...options,
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 32_000,
    jitter: 0.1,
    heartbeatTimeout: 65_000,
  });
}
