// ============================================================
// MARCOM / Lumi — Observability Routes (Mission Control)
// ============================================================
// Read-only execution monitoring endpoints for live system health.
// All routes are workspace-scoped and require authentication.
//
// Routes:
//   GET /api/observability/live      — execution health + queue
//   GET /api/observability/providers — provider performance (24h)
//   GET /api/observability/failures  — recent failure log (24h)
// ============================================================
import { Router } from 'express';
import { liveRouter } from './live.js';
import { providersRouter } from './providers.js';
import { failuresRouter } from './failures.js';

export const observabilityRouter = Router();

// Mount sub-routers
observabilityRouter.use(liveRouter);
observabilityRouter.use(providersRouter);
observabilityRouter.use(failuresRouter);
