// ============================================================
// Execution mount — the authorization baseline  (Slice C)
// ============================================================
// The mount at /api/execute already supplied authentication, workspace
// resolution and two rate limiters. It did not supply AUTHORIZATION: that was
// opt-in, per route. Thirteen of eighteen routes had never opted in, so a
// CLIENT seat — which the role model grants the REPORT and nothing else — could
// read the execution audit log, worker vitals, live executions, traces,
// incidents, checkpoints and artifacts of its workspace.
//
// The thirteen were the manifestation. The defect was that a route which
// forgets a gate is not refused; it is published.
//
// So authorization becomes a property OF THE MOUNT. Every request entering this
// router meets the operator gate unless the route is on an explicit exception
// list. A route added tomorrow inherits the refusal by construction, and its
// author has to make a deliberate, visible decision to open it — which is the
// opposite of the arrangement this replaces.
//
//   /api/execute
//      ├── authentication        requireAuth        (server.js)
//      ├── workspace / tenancy   requireWorkspace   (server.js)
//      ├── rate limiting         apiLimiter + executionLimiter
//      └── authorization         THIS FILE          ← the baseline
//             ├── explicit CLIENT exception  → CLIENT or operator
//             └── default                    → operator role required
//
//      Either way a role must RESOLVE. An exception widens the audience; it
//      never removes the question.
//
// ⚠️ WHAT THIS IS NOT. It is not a tenancy check. Which workspace's rows a
// request may see is decided by requireWorkspace upstream and by the
// workspace-qualified predicate in every handler, and it stays there. A gate
// that answered both questions would make each one harder to reason about, and
// the cross-tenant cases in src/tests are deliberately independent of role for
// that reason.
//
// ⚠️ NOR IS IT A REPLACEMENT for the gates the routes already carry. POST /meta
// and POST /:id/retry keep requireFreshAuthority — the baseline is a FLOOR, and
// a route needing a stricter or fresher authority still declares it. Slice B's
// money boundary re-reads both authorities from their shared sources; nothing
// here weakens that, and the baseline running first cannot satisfy it.
//
// ⚠️ THE BASELINE IS SCOPED TO THIS ROUTER. `router.use(...)` here applies to
// the execution router only, because server.js mounts it at a path. That is not
// the hazard recorded in [[lumi-flat-mount-middleware-leak]], where the lumi
// sub-routers are flat-mounted at '/' and a path-less `use` leaks onto every
// sibling mounted after it. This router has exactly one mount and exactly one
// importer of its route registrars — verified, and asserted in the wiring test.
// ============================================================
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';

/**
 * The tier that may reach the execution surface.
 *
 * Taken from the rule the product had already written above GET /:id, the one
 * read that was gated: "The roles that may queue a mutation are the roles that
 * may read the mutation log. A CLIENT seat cannot execute and has no business
 * reading what was executed."
 */
export const OPERATOR_ROLES = Object.freeze([WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST]);

/**
 * Routes on this mount that a CLIENT seat may read.
 *
 * ⚠️ EMPTY, AND DELIBERATELY KEPT. The classification behind Slice C found no
 * route with evidence of a CLIENT audience — not in the role model, not in a
 * client surface, not in a comment. The list is not removed for being empty:
 * it is the seam that makes exposing an operational read to CLIENT a decision
 * somebody writes down, rather than a gate somebody forgets. An absent
 * mechanism and an empty list are different things, and only one of them can be
 * reviewed.
 *
 * Each entry is `{ method, path }`, where `path` is the route as registered on
 * this router — the same spelling index.js uses, `:params` and all.
 *
 * @type {ReadonlyArray<{ method: string, path: string }>}
 */
export const CLIENT_READABLE = Object.freeze([]);

/** Turn one exception entry into a matcher over (method, path). */
function compileException(entry) {
  const pattern = entry.path
    .split('/')
    .map((segment) => (segment.startsWith(':')
      ? '[^/]+'
      : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  const rx = new RegExp(`^${pattern}/?$`);
  const method = entry.method.toUpperCase();
  return (reqMethod, reqPath) => reqMethod === method && rx.test(reqPath);
}

/**
 * Build the mount's authorization baseline.
 *
 * @param {object} [options]
 * @param {ReadonlyArray<{method: string, path: string}>} [options.clientReadable]
 *        The exception list. Injectable so the EXCEPTION MECHANISM can be
 *        exercised by a test even while the shipped list is empty — an
 *        unexercised mechanism is one that quietly stops working.
 */
export function buildExecutionAuthorizationBaseline({ clientReadable = CLIENT_READABLE } = {}) {
  const operatorGate = requireCollabRole(...OPERATOR_ROLES);
  // ⚠️ AN EXCEPTION WIDENS THE AUDIENCE; IT DOES NOT REMOVE THE QUESTION.
  // The list is called CLIENT_READABLE — readable by a CLIENT — and a seat
  // whose role cannot be resolved is not a CLIENT, it is a seat something is
  // wrong with. Letting an exception fall straight through to next() would have
  // quietly re-opened the hole R11 (I61) closed: an unresolvable role reaching
  // a route because nobody asked. So an excepted route still demands a role,
  // from a wider set.
  const exceptedGate = requireCollabRole(...OPERATOR_ROLES, WORKSPACE_ROLE.CLIENT);
  const exceptions = clientReadable.map(compileException);

  return function executionAuthorizationBaseline(req, res, next) {
    // req.path inside a mounted router is the path RELATIVE to the mount, which
    // is the same spelling the exception list uses.
    const excepted = exceptions.some((matches) => matches(req.method, req.path));
    return (excepted ? exceptedGate : operatorGate)(req, res, next);
  };
}

/** The baseline the execution router actually mounts. */
export const executionAuthorizationBaseline = buildExecutionAuthorizationBaseline();
