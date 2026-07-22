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
      error: 'INCOMPLETE_CONTEXT',
      message: 'Set a workspace name to continue.',
      hint: 'User must complete onboarding to set a workspace name.',
    });
  }

  // Backward-compatible identity check. A workspace only needs an IDENTITY to be
  // usable — a name (new onboarding) or companyName (legacy/aliased). industry
  // and market are NO LONGER required here: every downstream prompt builder now
  // degrades gracefully when they're absent (buildSystemPrompt omits the line;
  // copilot renders "MENA"/"unknown"), so gating on them only blocked name-only,
  // connect-first users for no benefit. Mirrors withContextAliases + isOnboarded.
  const identity = (context.companyName ?? context.name ?? '').toString().trim();
  if (identity.length === 0) {
    logger.warn({ userId: req.userId }, '[contextGuard] no workspace identity (name/companyName)');
    return res.status(400).json({
      error: 'INCOMPLETE_CONTEXT',
      message: 'Set a workspace name to continue.',
    });
  }

  // Attach validated context to request for downstream use
  req.context = context;

  logger.debug(
    { userId: req.userId, company: identity },
    '[contextGuard] context validated'
  );

  next();
}
