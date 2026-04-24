// ============================================================
// MARCOM — Structured Logger (pino)
// ============================================================
import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    base: { service: 'marcom' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-webhook-secret"]',
        'req.headers["x-webhook-signature"]',
        '*.api_key',
        '*.apiKey',
        '*.password',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  },
  process.env.NODE_ENV !== 'production'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } })
    : undefined
);
