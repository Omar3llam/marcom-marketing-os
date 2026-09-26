// Strict workspace resolution: a successful miss is absence; a failed read is not.
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

export class WorkspaceUnavailableError extends Error {
  constructor(cause) {
    super('workspace lookup failed', { cause });
    this.name = 'WorkspaceUnavailableError';
    this.source = 'USER_WORKSPACE';
  }
}

export async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { clerkId: req.userId }, select: { workspaceId: true },
    });
    return user?.workspaceId ?? null;
  } catch (cause) {
    throw new WorkspaceUnavailableError(cause);
  }
}

/** Return a workspace id, or send the explicit failure/absence response. */
export async function needWorkspace(req, res) {
  // Preserve identity-layer decisions when used without the outer auth gate.
  if (req.authError) {
    res.status(req.authError.status).json({ error: req.authError.code, message: req.authError.message });
    return null;
  }
  if (req.authInfraError) {
    res.status(503).json({ error: 'AuthInfrastructureUnavailable', message: 'Authentication infrastructure is not ready.' });
    return null;
  }
  let workspaceId;
  try {
    workspaceId = await resolveWorkspaceId(req);
  } catch (err) {
    logger.error({ err: err.cause?.message ?? err.message, source: err.source, userId: req.userId }, '[workspace-resolution] lookup failed');
    res.status(503).json({ error: 'WorkspaceUnavailable', message: 'Could not resolve your workspace right now.' });
    return null;
  }
  if (!workspaceId) {
    res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
    return null;
  }
  return workspaceId;
}
