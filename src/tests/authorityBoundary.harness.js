// ============================================================
// The real-money authority boundary — a harness over the REAL chain
// ============================================================
// Slice B asks a question that cannot be answered by reading middleware:
//
//   After a principal's authority is revoked, can that identity still reach
//   either canonical platform-mutation path?
//
// So the chain under test is the shipped one. `POST /api/execute/meta` and
// `POST /api/execute/:id/retry` are the ONLY two paths in the repository that
// can mint a real platform mutation — verified by enumerating every caller of
// enqueueExecution and every writer of ExecutionRequest — and both are mounted
// behind exactly this sequence in server.js:
//
//   firebaseAuthMiddleware  →  requireAuth  →  requireWorkspace
//                           →  requireCollabRole(BUYER, STRATEGIST)
//
// WHAT IS REAL HERE: all four guards, in order, unmodified.
// WHAT IS STUBBED: only the identity STORES — Firebase's token verifier and the
// user row. That is the same split PARITY-02 settled on for the router harness:
// stub what the gate reads, never the gate. A harness that mocked the guards
// could not answer a question about the guards.
//
// The handler is a sentinel that counts. It stands in for the enqueue, because
// what is under test is whether the request ARRIVES, not what the mutation does.
// ============================================================
import express from 'express';

/**
 * Build an app whose two routes are the canonical mutation paths, behind the
 * production guard chain. Call AFTER the suite's vi.mock declarations, so the
 * middlewares resolve against the stubbed identity stores.
 *
 * @returns {Promise<{app: import('express').Express, mutations: {count: number, paths: string[]}}>}
 */
export async function buildAuthorityBoundary() {
  const { firebaseAuthMiddleware, requireAuth } = await import('../middleware/firebaseAuth.js');
  const { requireWorkspace } = await import('../middleware/requireWorkspace.js');
  const { requireFreshAuthority } = await import('../middleware/requireFreshAuthority.js');
  const { WORKSPACE_ROLE } = await import('../services/collaboration/roleScope.js');

  const mutations = { count: 0, paths: [] };

  const app = express();
  app.use(express.json());
  app.use(firebaseAuthMiddleware);

  // The sentinel: reaching it is what "caused a real-money mutation" means here.
  const sentinel = (req, res) => {
    mutations.count += 1;
    mutations.paths.push(req.path);
    res.status(202).json({ queued: true });
  };

  const guards = [
    requireAuth,
    requireWorkspace,
    // Slice B replaced the cached-role gate here with the fresh one, mirroring
    // what meta.js and retry.js now mount. Only this guard LIST changed; no
    // assertion did. authorityBoundary.wiring.test.js reads the real route
    // modules, so a harness that drifted from them would be caught there.
    requireFreshAuthority(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  ];

  app.post('/api/execute/meta', ...guards, sentinel);
  app.post('/api/execute/:id/retry', ...guards, sentinel);

  return { app, mutations };
}

/** The two paths, so a suite cannot test one and claim the boundary. */
export const CANONICAL_MUTATION_PATHS = Object.freeze([
  '/api/execute/meta',
  '/api/execute/exec-1/retry',
]);
