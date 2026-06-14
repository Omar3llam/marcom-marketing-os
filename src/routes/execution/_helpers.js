// ============================================================
// Execution Router — Shared Helpers
// ============================================================
// Module-internal utilities shared across execution sub-routes.
// Not part of the public route surface; underscore prefix marks
// it as folder-internal.
// ============================================================
import { prisma } from '../../lib/prisma.js';

/**
 * Workspace-isolated lookup of an execution by id.
 * Returns { execution: null } when not found or when the execution
 * belongs to a different workspace. This avoids leaking ID existence.
 *
 * Used by GET /:id/transitions and GET /:id/incident.
 */
export async function loadExecutionForWorkspace(executionId, workspaceId) {
  const execution = await prisma.executionRequest.findUnique({
    where: { id: executionId },
    select: {
      id: true,
      workspaceId: true,
      actionType: true,
      targetId: true,
      status: true,
      version: true,
      correlationId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!execution) return { execution: null };
  if (execution.workspaceId !== workspaceId) return { execution: null };
  return { execution };
}
