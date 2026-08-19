// ============================================================
// MARCOM / Lumi — Meta Execution Router (assembly)
// ============================================================
// This file is the public entry point for the /api/execute mount.
// Each endpoint lives in its own module; this file is responsible
// for registering handlers in the correct order — specific paths
// (`/meta`, `/audit`, `/vitals`, `/active`) BEFORE `/:id/*`
// so Express doesn't match `:id` against literal segments.
//
// Auth is already applied globally in server.js via requireAuth
// on the /api/execute mount. No router-level middleware needed.
// ============================================================
import { Router } from 'express';

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
