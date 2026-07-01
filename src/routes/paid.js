// ============================================================
// MARCOM / Lumi — Paid Decision Engine Routes
// ------------------------------------------------------------
// Express router for the Paid Decision Engine API.
//
// Endpoints:
// - GET  /radar    — Proactive radar alerts
// - GET  /health   — Dual-agent orchestrator health
//
// NOTE: /execute was removed — real Meta execution lives in execution.js
// (metaExecutionService, workspace-scoped + 4-layer guards). The paid
// /execute duplicated it via the now-retiring Meta MCP path.
//
// Mount in server.js as:
// app.use('/api/v1/paid', paidRoutes);
// ============================================================
import express from 'express';
import {
  radarHandler,
  healthHandler,
} from '../controllers/paidController.js';

const router = express.Router();

// ── ROUTES ───────────────────────────────────────────────────

/**
 * GET /api/v1/paid/radar
 * Proactive radar alerts (bleeding campaigns) for the caller's workspace,
 * sourced from the connector entity graph. No query params — the workspace is
 * resolved from the auth context and its synced campaigns drive the analysis.
 *
 * Response: { success: true, alerts: [...], source: 'live', timestamp }
 *   503 { success:false, alerts:[], source:'unavailable', message } when no
 *   channel has synced (UI shows "connect a channel") or analysis fails.
 */
router.get('/radar', radarHandler);

/**
 * GET /api/v1/paid/health
 * Health check for Paid Decision Engine
 *
 * Response:
 * {
 *   status: 'healthy' | 'degraded' | 'unhealthy',
 *   components: {
 *     orchestrator: { status, ... }
 *   },
 *   timestamp: '2026-05-04T...'
 * }
 */
router.get('/health', healthHandler);

export default router;
