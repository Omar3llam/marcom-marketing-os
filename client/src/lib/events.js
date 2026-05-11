// ============================================================
// MARCOM / Lumi — SSE Client (Real-Time Execution Updates)
// ============================================================
// EventSource wrapper with auto-reconnect and error handling.
// Streams execution lifecycle events from /api/events/stream.
//
// Usage:
//   const disconnect = connectExecutionStream(token, {
//     onExecutionUpdate: (event) => { ... },
//     onError: (err) => { ... },
//     onConnected: () => { ... },
//   });
//
//   // Later: disconnect();
// ============================================================

const SSE_ENDPOINT = '/api/events/stream';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Connect to the SSE execution stream with automatic token refresh.
 * @param {string|Function} tokenOrGetter - Firebase JWT token or function that returns a fresh token
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onExecutionUpdate - Called with execution status events
 * @param {Function} handlers.onError - Called on stream error
 * @param {Function} handlers.onConnected - Called when connection established
 * @returns {Function} disconnect - Call to close the stream
 */
export function connectExecutionStream(tokenOrGetter, handlers = {}) {
  const {
    onExecutionUpdate = () => {},
    onError = () => {},
    onConnected = () => {},
  } = handlers;

  let eventSource = null;
  let reconnectAttempts = 0;
  let isClosed = false;
  let reconnectTimer = null;

  // Support both static token and token getter function
  const getToken = typeof tokenOrGetter === 'function'
    ? tokenOrGetter
    : () => Promise.resolve(tokenOrGetter);

  async function connect() {
    if (isClosed) return;

    // ✅ Get fresh token on each connection attempt
    // This handles token expiration (Firebase JWTs expire after 1 hour)
    let token;
    try {
      token = await getToken();
      if (!token) {
        console.warn('[SSE] No token available — cannot connect');
        onError({ message: 'Authentication token required' });
        return;
      }
    } catch (err) {
      console.error('[SSE] Failed to get token:', err);
      onError({ message: 'Failed to get authentication token', code: 'TOKEN_ERROR' });
      return;
    }

    // EventSource doesn't support custom headers (no Authorization).
    // Instead, pass token as query param (server validates via firebaseAuth).
    const url = `${SSE_ENDPOINT}?token=${encodeURIComponent(token)}`;

    try {
      eventSource = new EventSource(url);

      // ── Connection opened ────────────────────────────────
      eventSource.addEventListener('open', () => {
        console.log('[SSE] Connection established');
        reconnectAttempts = 0; // Reset on successful connection
      });

      // ── Message received ─────────────────────────────────
      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'CONNECTED') {
            console.log('[SSE] Stream connected at', data.timestamp);
            onConnected();
            return;
          }

          if (data.type === 'EXECUTION_STATUS') {
            console.log('[SSE] Execution update:', data);
            onExecutionUpdate(data);
            return;
          }

          console.debug('[SSE] Unknown message type:', data.type);
        } catch (err) {
          console.error('[SSE] Failed to parse message:', err);
        }
      });

      // ── Error occurred ───────────────────────────────────
      eventSource.addEventListener('error', (err) => {
        console.error('[SSE] Stream error:', err);

        // Close current connection
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }

        // Attempt reconnect if not manually closed
        // ✅ Each reconnect will fetch a fresh token via getToken()
        // This handles 401 errors from token expiration (1h JWT lifetime)
        if (!isClosed) {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(
              `[SSE] Reconnecting with fresh token in ${RECONNECT_DELAY_MS}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
            );

            reconnectTimer = setTimeout(() => {
              connect(); // Will call getToken() again for fresh token
            }, RECONNECT_DELAY_MS);
          } else {
            console.error('[SSE] Max reconnect attempts reached — giving up');
            onError({
              message: 'Connection lost and could not reconnect',
              code: 'MAX_RECONNECT_EXCEEDED',
            });
          }
        }
      });
    } catch (err) {
      console.error('[SSE] Failed to create EventSource:', err);
      onError({ message: err.message, code: 'EVENTSOURCE_CREATION_FAILED' });
    }
  }

  // Start initial connection
  connect();

  // Return disconnect function
  return function disconnect() {
    console.log('[SSE] Disconnecting');
    isClosed = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
