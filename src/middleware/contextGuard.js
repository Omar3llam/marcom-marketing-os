// ============================================================
// MARCOM — Context Guard Middleware (Multi-Tenant Enforcement)
// ============================================================
// Strict validation layer for multi-tenant isolation.
// Every AI-driven route MUST have req.user.context populated
// with at least: companyName, industry, market.
//
// This middleware prevents data leaks and ensures tenant
// isolation by validating context exists before AI execution.
// ============================================================
import { logger } from '../utils/logger.js';

/**
 * Middleware: Validate that user context is complete.
 * Returns 400 if context is missing required fields.
 * Populates req.context for use by AI functions.
 *
 * Usage in routes:
 *   router.use(contextGuard);   // e.g. src/routes/decision-memory/index.js
 */
export function contextGuard(req, res, next) {
  // Check if req.user exists
  if (!req.user || !req.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  // Check if context exists
  const context = req.user.context;
  if (!context || typeof context !== 'object') {
    logger.warn({ userId: req.userId }, '[contextGuard] missing or invalid context object');
    return res.status(400).json({
      error: 'Context not initialized',
      hint: 'User must complete onboarding to set company, industry, and market context',
    });
  }

  // Validate required context fields
  const required = ['companyName', 'industry', 'market'];
  const missing = required.filter((field) => !context[field] || context[field].toString().trim() === '');

  if (missing.length > 0) {
    logger.warn(
      { userId: req.userId, missing },
      '[contextGuard] incomplete context — missing required fields'
    );
    return res.status(400).json({
      error: 'Context not initialized or incomplete',
      missing,
      hint: `Context must include: ${required.join(', ')}`,
    });
  }

  // Attach validated context to request for downstream use
  req.context = context;

  logger.debug(
    { userId: req.userId, company: context.companyName, industry: context.industry, market: context.market },
    '[contextGuard] context validated'
  );

  next();
}
