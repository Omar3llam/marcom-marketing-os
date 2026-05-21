// ============================================================
// MARCOM / Lumi — SSE Client (Real-Time Execution Updates)
// ============================================================
// EventSource wrapper with automatic token exchange + reconnect.
//
// SECURITY: Firebase JWTs must never appear in URLs (server logs
// record query params in plaintext). Instead:
//   1. Exchange Firebase JWT → short-lived UUIDv4 stream token
//      via POST /api/events/token (Authorization header — not URL)
//   2. Open EventSource with the UUID token in the URL
//      (UUID carries no PII, single-use, 60s TTL)
//
// Usage:
//   const disconnect = connectExecutionStream(getToken, {
//     onExecutionUpdate: (event) => { ... },
//     onError: (err) => { ... },
//     onConnected: () => { ... },
//   });
//   // Later: disconnect();
// ============================================================

const SSE_ENDPOINT = '/api/events/stream';
const TOKEN_ENDPOINT = '/api/events/token';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Connect to the SSE execution stream.
 * @param {Function} getFirebaseToken - async function returning a fresh Firebase ID token
 * @param {Object}   handlers
 * @param {Function} handlers.onExecutionUpdate - fires on legacy 'EXECUTION_STATUS' events
 * @param {Function} handlers.onTransition      - fires on 'execution.transition' events (Phase 11C)
 * @param {Function} handlers.onError
 * @param {Function} handlers.onConnected
 * @returns {Function} disconnect
 */
export function connectExecutionStream(getFirebaseToken, handlers = {}) {
  const {
    onExecutionUpdate = () => {},
    onTransition      = () => {},
    onError           = () => {},
    onConnected       = () => {},
  } = handlers;

  let eventSource       = null;
  let reconnectAttempts = 0;
  let isClosed          = false;
  let reconnectTimer    = null;

  // Support both a static token string (legacy) and a token getter function.
  const getToken = typeof getFirebaseToken === 'function'
    ? getFirebaseToken
    : () => Promise.resolve(getFirebaseToken);

  async function connect() {
    if (isClosed) return;

    // ── Step 1: Exchange Firebase JWT for a short-lived stream token ──
    // The exchange happens via a POST with the Authorization header —
    // the Firebase JWT never touches a URL or server access log.
    let streamToken;
    try {
      const firebaseToken = await getToken();
      if (!firebaseToken) {
        console.warn('[SSE] No Firebase token available — cannot connect');
        onError({ message: 'Authentication token required', code: 'NO_TOKEN' });
        return;
      }

      const response = await fetch(TOKEN_ENDPOINT, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${firebaseToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(body.error || `Token exchange failed (${response.status})`),
          { status: response.status, code: 'TOKEN_EXCHANGE_FAILED' },
        );
      }

      const data = await response.json();
      streamToken = data.streamToken;

      if (!streamToken) {
        throw new Error('Token exchange returned no streamToken');
      }
    } catch (err) {
      console.error('[SSE] Token exchange failed:', err.message);
      onError({ message: err.message, code: err.code || 'TOKEN_EXCHANGE_FAILED' });

      // Retry after delay — the Firebase token may have just expired.
      if (!isClosed && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        onError({ message: 'Max reconnect attempts reached', code: 'MAX_RECONNECT_EXCEEDED' });
      }
      return;
    }

    // ── Step 2: Open EventSource with the safe stream token ──
    // The UUIDv4 token in the URL carries no PII, is single-use,
    // and expires after 60 seconds.
    const url = `${SSE_ENDPOINT}?token=${streamToken}`;

    try {
      eventSource = new EventSource(url);

      eventSource.addEventListener('open', () => {
        console.log('[SSE] Connection established');
        reconnectAttempts = 0;
      });

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

          // Phase 11C — lifecycle service broadcasts these on every
          // successful transition. The Operations Live Monitor uses
          // them to drop polling.
          if (data.type === 'execution.transition') {
            onTransition(data);
            return;
          }

          console.debug('[SSE] Unknown message type:', data.type);
        } catch (err) {
          console.error('[SSE] Failed to parse message:', err);
        }
      });

      eventSource.addEventListener('error', () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }

        // Each reconnect will call connect() which re-exchanges for a fresh
        // stream token — this also handles Firebase token expiration.
        if (!isClosed) {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(
              `[SSE] Reconnecting with fresh token in ${RECONNECT_DELAY_MS}ms`
              + ` (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
            );
            reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
          } else {
            console.error('[SSE] Max reconnect attempts reached — giving up');
            onError({ message: 'Connection lost', code: 'MAX_RECONNECT_EXCEEDED' });
          }
        }
      });
    } catch (err) {
      console.error('[SSE] Failed to create EventSource:', err);
      onError({ message: err.message, code: 'EVENTSOURCE_CREATION_FAILED' });
    }
  }

  connect();

  return function disconnect() {
    console.log('[SSE] Disconnecting');
    isClosed = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (eventSource)    { eventSource.close(); eventSource = null; }
  };
}
