// ============================================================
// MARCOM / Lumi - SSE adapter
// ============================================================
// Keeps the historical connectExecutionStream API while delegating
// reconnect, jitter, heartbeat, and token exchange to SSEClient.
// ============================================================
import { createSSEClient } from '@/services/sseClient';

export function connectExecutionStream(getFirebaseToken, handlers = {}) {
  const {
    onExecutionUpdate = () => {},
    onTransition      = () => {},
    onError           = () => {},
    onConnected       = () => {},
  } = handlers;

  const getAuthToken = typeof getFirebaseToken === 'function'
    ? getFirebaseToken
    : () => Promise.resolve(getFirebaseToken);

  const client = createSSEClient(
    (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        onError({ message: err.message, code: 'SSE_PARSE_ERROR' });
        return;
      }

      if (data.type === 'CONNECTED') {
        onConnected();
        return;
      }
      if (data.type === 'EXECUTION_STATUS') {
        onExecutionUpdate(data);
        return;
      }
      if (data.type === 'execution.transition') {
        onTransition(data);
      }
    },
    (error) => onError(error),
    { getAuthToken }
  );

  client.connect().catch((error) => onError(error));

  return function disconnect() {
    client.disconnect();
  };
}
