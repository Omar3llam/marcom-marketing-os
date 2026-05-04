// ============================================================
// MARCOM / Lumi — Paid Decision Engine Routes
// ------------------------------------------------------------
// Express router for the Paid Decision Engine API.
//
// Endpoints:
// - GET  /radar    — Proactive radar alerts
// - POST /analyze  — CSV/manual campaign analysis
// - POST /execute  — Execute Meta API actions
// - GET  /health   — Health check
//
// Mount in server.js as:
// app.use('/api/v1/paid', paidRoutes);
// ============================================================
import express from 'express';
import multer from 'multer';
import {
  radarHandler,
  analyzeHandler,
  executeHandler,
  healthHandler,
} from '../controllers/paidController.js';

const router = express.Router();

// ── MULTER CONFIGURATION ─────────────────────────────────────
// Store CSV files in memory (not disk) for processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Only accept CSV files
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ── ROUTES ───────────────────────────────────────────────────

/**
 * GET /api/v1/paid/radar
 * Fetches proactive radar alerts (bleeding campaigns)
 *
 * Query Params (optional):
 * - adAccountId: Meta Ad Account ID (default: from env)
 * - datePreset: Date range (default: last_7d)
 *
 * Response:
 * {
 *   success: true,
 *   alerts: [...],
 *   source: 'live' | 'mock',
 *   timestamp: '2026-05-04T...'
 * }
 */
router.get('/radar', radarHandler);

/**
 * POST /api/v1/paid/analyze
 * Analyzes campaign data from CSV upload or JSON body
 *
 * Body (CSV upload):
 * - Content-Type: multipart/form-data
 * - Field: file (CSV file)
 *
 * Body (JSON - specific campaign):
 * {
 *   campaignId: 'meta_campaign_id',
 *   adAccountId: 'act_123456' (optional),
 *   datePreset: 'last_7d' (optional)
 * }
 *
 * Body (JSON - direct data):
 * {
 *   campaigns: [{
 *     campaign_id: '...',
 *     campaign_name: '...',
 *     spend: 1000,
 *     ...
 *   }]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   verdict: { ... },
 *   source: 'csv' | 'api' | 'json',
 *   timestamp: '2026-05-04T...'
 * }
 */
router.post('/analyze', upload.single('file'), analyzeHandler);

/**
 * POST /api/v1/paid/execute
 * Executes a Meta API action via MCP
 *
 * Body:
 * {
 *   action_type: 'pause_campaign' | 'resume_campaign' | 'update_budget',
 *   target_id: 'meta_campaign_id',
 *   payload: { budget: 500 } (optional)
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: 'Action executed successfully',
 *   action: { type, target_id, timestamp },
 *   result: { ... }
 * }
 */
router.post('/execute', executeHandler);

/**
 * GET /api/v1/paid/health
 * Health check for Paid Decision Engine
 *
 * Response:
 * {
 *   status: 'healthy' | 'degraded' | 'unhealthy',
 *   components: {
 *     metaMCP: { status, ... },
 *     orchestrator: { status, ... }
 *   },
 *   timestamp: '2026-05-04T...'
 * }
 */
router.get('/health', healthHandler);

// ── ERROR HANDLER ────────────────────────────────────────────
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'File too large (max 10MB)',
        classification: 'validation',
      });
    }
    return res.status(400).json({
      success: false,
      error: error.message,
      classification: 'validation',
    });
  }

  if (error.message === 'Only CSV files are allowed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type. Please upload a CSV file.',
      classification: 'validation',
    });
  }

  // Pass to global error handler
  next(error);
});

export default router;
