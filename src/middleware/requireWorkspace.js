// ============================================================
// requireWorkspace — R11 (I60) workspace-context boundary
// ============================================================
// requireAuth answers "who is this?". It does NOT answer "which tenant is
// this?" — and until R11 nothing did. A fully authenticated request whose
// workspace resolution failed (pool blip, provisioning failure) reached the
// handlers with req.workspaceId === null, and because workspaceId is a
// non-nullable UUID column, `where: { workspaceId: null }` matches no rows.
// The customer saw a 200 with an empty account instead of an error: an
// infrastructure failure rendered as a business state.
//
// This middleware makes the tenant context an explicit precondition. It runs
// AFTER requireAuth (which has already converted an identity-layer failure
// into 401/409/503) so reaching here with no workspace means the identity is
// sound. A missing context is looked up strictly: a successful miss is 409;
// a failed read is 503, never an empty list or a setup finding.
//
// Mount it on workspace-scoped routers. Do NOT mount it on user-scoped or
// project-scoped routers (history, projects, credentials): those legitimately
// operate without a workspace and a 409 there would be a lie in the other
// direction.
// ============================================================
import { logger } from '../utils/logger.js';
import { needWorkspace } from '../lib/workspaceResolution.js';

export async function requireWorkspace(req, res, next) {
  const workspaceId = await needWorkspace(req, res);
  if (!workspaceId) {
    logger.warn({
      path:   req.path,
      method: req.method,
      uid:    req.userId,
      authSource: req.authSource ?? null,
    }, '[requireWorkspace] authenticated request with no resolvable workspace');

    return;
  }
  req.workspaceId = workspaceId;
  return next();
}
