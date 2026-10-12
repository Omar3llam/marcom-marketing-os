// Runtime parent liveness, separate from caller/credential ownership authority.
// Reuses the existing NoWorkspace / WorkspaceUnavailable refusal vocabulary.
export class WorkspaceScopeError extends Error {
  constructor(code, cause) {
    super(code === 'NoWorkspace' ? 'NoWorkspace: workspace is unavailable'
      : 'WorkspaceUnavailable: workspace lookup failed', { cause });
    this.name = 'WorkspaceScopeError';
    this.code = code;
  }
}

export const isWorkspaceScopeError = (error) => error instanceof WorkspaceScopeError;

export async function assertWorkspaceLive(client, workspaceId) {
  let workspace;
  try {
    workspace = await client.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  } catch (cause) {
    throw new WorkspaceScopeError('WorkspaceUnavailable', cause);
  }
  if (!workspace) throw new WorkspaceScopeError('NoWorkspace');
}

/** DB writes only: never put provider/AI work inside this transaction.
 * KEY SHARE blocks deletion/key changes, including the lifecycle FOR UPDATE
 * lock, while allowing concurrent parent readers and ordinary non-key updates.
 * Read errors are distinct from a successful miss; operation errors propagate.
 */
export function withLiveWorkspace(client, workspaceId, operation) {
  return client.$transaction(async (tx) => {
    let parent;
    try {
      parent = await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR KEY SHARE`;
    } catch (cause) {
      throw new WorkspaceScopeError('WorkspaceUnavailable', cause);
    }
    if (!parent.length) throw new WorkspaceScopeError('NoWorkspace');
    return operation(tx);
  }, { timeout: 60_000 }); // bounded DB batch; interactive default 5s would truncate large existing batches
}
