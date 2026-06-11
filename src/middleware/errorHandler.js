// ============================================================
// MARCOM — Global Error Handler
// ============================================================
import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  logger.error({
    err: err.message,
    stack: err.stack,
    code: err.code,
    reqId: req.id,
    status,
    method: req.method,
    path: req.originalUrl || req.path,
    userId: req.userId ?? null,
    workspaceId: req.workspaceId ?? null,
  }, 'Unhandled error');

  res.status(status).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'An internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
