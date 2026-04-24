// ============================================================
// MARCOM — Global Error Handler
// ============================================================
import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  logger.error({ err, reqId: req.id, status }, 'Unhandled error');

  res.status(status).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'An internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
