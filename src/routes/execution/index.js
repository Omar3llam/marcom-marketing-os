// ============================================================
// MARCOM / Lumi — Meta Execution Router (assembly)
// ============================================================
// This file is the public entry point for the /api/execute mount.
// Each endpoint lives in its own module; this file is responsible
// for registering handlers in the correct order — specific paths
// (`/meta`, `/audit`, `/vitals`, `/active`) BEFORE `/:id/*`
// so Express doesn't match `:id` against literal segments.
//
// Auth is applied in server.js via requireAuth + requireWorkspace on the
// /api/execute mount. AUTHORIZATION is applied HERE, once, for every route
// this router assembles — see ./authorizationBaseline.js. The line this
// replaces read "No router-level middleware needed", and that assumption is
// why thirteen reads shipped with no role gate: each route was trusted to opt
// in, and thirteen times nobody did.
// ============================================================
import { Router } from 'express';

import { executionAuthorizationBaseline } from './authorizationBaseline.js';

import { registerMetaRoute } from './meta.js';
import { registerAuditRoute } from './audit.js';
import { registerVitalsRoute } from './vitals.js';
import { registerActiveRoute } from './active.js';
import { registerMetricsSummaryRoute } from './metrics.js';
import { registerReconciliationRoute } from './reconciliation.js';
import { registerTransitionsRoute } from './transitions.js';
import { registerIncidentRoute } from './incident.js';
import { registerRetryRoute } from './retry.js';
import { registerTraceRoute } from './trace.js';
import { registerResumeRoute } from './resume.js';         // PR #29
import { registerCheckpointRoute } from './checkpoint.js';  // PR #29
import { registerArtifactsRoute } from './artifacts.js';    // PR #35
import { registerDetailRoute } from './detail.js';          // R13-D / B3-B

const router = Router();

// ── THE AUTHORIZATION BASELINE — before any route is registered ────────────
// Every request into this router meets it, so a route added below inherits the
// refusal without its author doing anything. A route needing a stricter or
// fresher authority still declares its own (POST /meta and POST /:id/retry
// carry Slice B's requireFreshAuthority): this is a floor, not a ceiling.
router.use(executionAuthorizationBaseline);

// Specific paths first — order matters for Express route matching.
registerMetaRoute(router);
registerAuditRoute(router);
registerVitalsRoute(router);
registerActiveRoute(router);
registerMetricsSummaryRoute(router);
registerCheckpointRoute(router);  // PR #29: /paused, /:id/checkpoint

// :id paths last — must not shadow the literal segments above.
registerReconciliationRoute(router);
registerTransitionsRoute(router);
registerIncidentRoute(router);
registerRetryRoute(router);
registerTraceRoute(router);
registerResumeRoute(router);       // PR #29: /:id/resume
registerArtifactsRoute(router);    // PR #35: /:executionId/artifacts, /artifacts/:id

// LAST, deliberately. `GET /:id` matches any single segment, so registering it
// before the literal one-segment routes above (`/audit`, `/vitals`, `/active`,
// `/paused`) would swallow every one of them and answer 404 for each.
registerDetailRoute(router);       // R13-D / B3-B: GET /:id

export default router;
