// ============================================================
// SLICE C — a harness over the REAL /api/execute mount
// ------------------------------------------------------------
// The question Slice C asks is about the MOUNT, not about any one route:
//
//   Can a CLIENT seat reach an execution-operational surface that the product's
//   own role model does not grant to CLIENT?
//
// ⚠️ THE HARNESS MUST NOT DECLARE THE ROUTE TABLE. PARITY-02 measured what
// happens when it does: a smoke test declared its own routes and once asserted
// the opposite of the product. Slice B hit the same shape from the other side —
// a harness that replicated the guard chain could not answer a question about
// the guard chain. So this file imports the SHIPPED router object and mounts it
// whole. Every route the product registers is reachable here; none is listed
// here. A route added to routes/execution/index.js tomorrow appears in this
// harness with no edit, which is precisely the inheritance closure condition 4
// asks for.
//
// WHAT IS REAL
//   • routes/execution/index.js — the assembled router, unmodified
//   • firebaseAuthMiddleware, requireAuth, requireWorkspace — in server.js order
//   • every route-level gate the product mounts (requireCollabRole,
//     requireFreshAuthority) — real, never stubbed
//
// WHAT IS STUBBED — by the suite, not here
//   • the identity stores only: Firebase's verifier and the user row
//   • the heavy services each handler calls, so a permitted request can reach a
//     handler and come back with something rather than a crash
//
// WHAT IS DELIBERATELY ABSENT, and why it is safe
//   apiLimiter and executionLimiter sit between requireWorkspace and the router
//   in server.js. They are omitted: a suite that walks 18 routes across 4 roles
//   would trip a shared counter and start answering 429, which is neither the
//   question nor a stable signal. Rate limiting is not an authorization control
//   and nothing in Slice C turns on it.
//
// ⚠️ IF THE FIX LANDS AT THE server.js MOUNT rather than inside the router,
// this harness will not see it, and the honest response is to add it HERE and
// say so — never to relax an assertion. executeMountAuthorization.wiring.test.js
// reads the real source of BOTH server.js and index.js, so a harness that
// drifted from the shipped mount is caught there rather than believed.
// ============================================================
import express from 'express';

/**
 * Build an app serving the real execution router behind the real upstream
 * chain. Call AFTER the suite's vi.mock declarations so the middlewares resolve
 * against the stubbed identity stores.
 *
 * @returns {Promise<import('express').Express>}
 */
export async function buildExecuteMount() {
  const { firebaseAuthMiddleware, requireAuth } = await import('../middleware/firebaseAuth.js');
  const { requireWorkspace } = await import('../middleware/requireWorkspace.js');
  const executionRouter = (await import('../routes/execution/index.js')).default;

  const app = express();
  app.use(express.json());
  app.use(firebaseAuthMiddleware);
  app.use('/api/execute', requireAuth, requireWorkspace, executionRouter);
  return app;
}

/**
 * Seats used across the Slice C suites. Each role gets its OWN uid so the
 * short-TTL workspace cache in firebaseAuth (uid -> { workspaceId, role,
 * collabRole }) can never serve one role's entry to another's request. That is
 * a property of the fixture, not something a test has to remember to reset.
 */
export const SEATS = Object.freeze({
  STRATEGIST: { uid: 'seat-strategist', collabRole: 'STRATEGIST' },
  BUYER:      { uid: 'seat-buyer',      collabRole: 'BUYER' },
  CLIENT:     { uid: 'seat-client',     collabRole: 'CLIENT' },
  NO_ROLE:    { uid: 'seat-no-role',    collabRole: null },
  /**
   * A fully authorized operator in a DIFFERENT workspace. Closure condition 7
   * asks that tenant isolation survive Slice C, and the only way to know is to
   * keep a seat that has every role privilege and none of the tenancy.
   */
  FOREIGN_OPERATOR: { uid: 'seat-foreign', collabRole: 'STRATEGIST', workspaceId: 'ws-2' },
});

export const WORKSPACE_ID = 'ws-1';
export const OTHER_WORKSPACE_ID = 'ws-2';

/** The user row firebaseAuth would read for a seat. */
export function rowFor(seat) {
  return {
    id: 'u-' + seat.uid,
    workspaceId: seat.workspaceId ?? WORKSPACE_ID,
    role: 'USER',
    collabRole: seat.collabRole,
  };
}

/** The bearer token a seat presents. The suite's verifier stub decodes the uid. */
export function tokenFor(seat) {
  return 'token-for-' + seat.uid;
}
