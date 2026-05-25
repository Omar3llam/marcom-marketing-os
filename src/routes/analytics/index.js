// ============================================================
// Analytics Routes Index — PR #37
// ============================================================
// Aggregates all analytics route modules.
// Mounted at /api/analytics in server.js.
// ============================================================
import express from 'express';
import { registerApprovalAnalyticsRoutes } from './approvals.js';

const router = express.Router();

// Register approval analytics routes
registerApprovalAnalyticsRoutes(router);

export default router;
