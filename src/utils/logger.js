// ============================================================
// MARCOM — Structured Logger (pino)
// ============================================================
import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    base: { service: 'marcom' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // ── R11 (I72) — no log line carries a credential ─────────
    // The previous list covered the webhook headers and a few *.api_key-shaped
    // fields, and missed every name the OAuth code actually uses: accessToken,
    // access_token, refreshToken, refresh_token, and plain `token`. Those are
    // exactly the fields that ride along when a credential object, an axios
    // error config, or a request body is logged wholesale.
    //
    // Wildcards are one level deep in pino, so each name is listed at the top
    // level, one level down (`*.x`), and two (`*.*.x`) — which is where a
    // credential nested inside an error's `config` or a connector's `auth`
    // actually sits. Redaction is a backstop, not the control: R11 also stopped
    // putting tokens into URLs, so there is less for it to catch.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-webhook-secret"]',
        'req.headers["x-webhook-signature"]',
        'req.headers["x-invitation-token"]',
        ...['api_key', 'apiKey', 'password', 'secret',
          'accessToken', 'access_token', 'refreshToken', 'refresh_token',
          'token', 'clientSecret', 'client_secret', 'authorization', 'Authorization',
        ].flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
      ],
      censor: '[REDACTED]',
    },
  },
  process.env.NODE_ENV !== 'production'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } })
    : undefined
);
