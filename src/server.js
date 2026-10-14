// ============================================================
// MARCOM — Main Server  (server.js)
// ============================================================
// ⚠️ CRITICAL: dotenv MUST be configured FIRST, before any other imports.
// The .env file is in the parent directory (project root).
// ============================================================
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ENV_PATH   = resolve(__dirname, '..', '.env');

// Load .env from parent directory BEFORE any other imports
dotenvConfig({ path: ENV_PATH });

// ============================================================
// Now it's safe to import config.js (which validates env vars)
// ============================================================
import './config.js';           // Validates env vars; exits on failure

import express              from 'express';
import cors                 from 'cors';
import path from 'path';
import { shouldServeFrontend } from './lib/frontendServing.js';
import { securityHeaders }  from './middleware/securityHeaders.js';
import { firebaseAuthMiddleware, requireAuth } from './middleware/firebaseAuth.js';
import { requireWorkspace } from './middleware/requireWorkspace.js';
import { validateWebhook, captureRawBody } from './middleware/validateWebhook.js';
import { dedupeWebhookEvent } from './middleware/webhookDedup.js';
import { apiLimiter, chatLimiter, authLimiter, syncLimiter, adminSeedLimiter, executionLimiter, streamLimiter, healthLimiter } from './middleware/rateLimit.js';
import { errorHandler }     from './middleware/errorHandler.js';
import { masterRouter }     from './routes/master.js';
import { exportRouter }     from './routes/export.js';
import { historyRouter }    from './routes/history.js';
import { projectsRouter }     from './routes/projects.js';
import { credentialsRouter }  from './routes/credentials.js';
import { authMetaRouter }     from './routes/auth/meta.js';
import { authGoogleRouter }   from './routes/auth/google.js';
import { campaignsRouter }    from './routes/campaigns.js';
import { toolsRouter }        from './routes/tools.js';
import { lumiRouter, quickActionHandler, demoFeedHandler } from './routes/lumi/index.js';
import paidRouter             from './routes/paid.js';
import executionRouter        from './routes/execution/index.js';
import artifactApprovalRouter from './routes/artifact-approval.js';
import eventsRouter           from './routes/events.js';
// R7 — /api/memory and /api/decision-memory retired. Both served the legacy
// DecisionMemory table: the first rendered rows into a display string the
// sidebar parsed verdicts back out of, the second had no client consumer at
// all. Canonical decision history is GET /api/lumi/decisions/recent.
import analyticsRouter        from './routes/analytics/index.js';
import attributionRouter      from './routes/attribution.js';
import { observabilityRouter } from './routes/observability/index.js';
import { userRouter }         from './routes/user.js';
import { adminRouter }        from './routes/admin/index.js';
import { teamRouter }         from './routes/team/index.js';
import { requireAdmin }       from './middleware/requireAdmin.js';
import { logger }             from './utils/logger.js';
import { getDb, closeDb }   from './utils/db.js';
import { getFirebaseAdminReadiness } from './utils/firebaseAdmin.js';
import { ensureChatSessionSchema } from './models/chatSession.js';
import { ensureUserContextSchema } from './models/userContext.js';
import { ensureProjectSchema }     from './models/project.js';
import { ensureCredentialSchema }  from './models/credential.js';
import { config }           from './config.js';

const app = express();

// ── TRUST PROXY (for accurate IP in rate-limit behind nginx/Heroku) ─
app.set('trust proxy', 1);

// ── SECURITY HEADERS (Helmet + hand-tuned CSP) ───────────────
// Full stack lives in middleware/securityHeaders.js (unit-tested there):
// Helmet defaults (HSTS 1y, nosniff, XFO deny, Referrer-Policy, …) plus the
// Firebase-Auth-aware CSP with frame-ancestors 'none'.
app.use(securityHeaders);

// ── CORS ────────────────────────────────────────────────────
// RENDER_EXTERNAL_URL is injected automatically by Render (e.g. https://marcom.onrender.com).
// ALLOWED_ORIGINS can be set manually for custom domains.
const _allowedOrigins = [
  ...config.allowedOrigins,
  process.env.RENDER_EXTERNAL_URL,   // auto-populated on Render
].filter(Boolean);

if (config.nodeEnv === 'production' && _allowedOrigins.length === 0) {
  logger.warn('[cors] No production origins configured; browser clients will be rejected by CORS.');
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || _allowedOrigins.includes(origin) || config.nodeEnv === 'development') {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },

  // GAP 3 FIX: add PUT (used by PUT /api/campaigns/me/context)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  // GAP 1 FIX: credentials: true enables cookie forwarding for
  // Meta OAuth callback session. Required for any cross-origin
  // request that uses cookies OR Authorization header reliably.
  credentials: true,

  // GAP 2 FIX: cache preflight for 10 minutes.
  // Without this, EVERY request with Authorization header triggers
  // an OPTIONS preflight first — doubles request count on Render.
  // 600s = safe default (doesn't affect token refresh frequency).
  maxAge: 600,

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-webhook-signature',
    'x-webhook-timestamp',
    // R11 (I58) — the invitation credential travels as a request header, so a
    // cross-origin preflight has to permit it or the JOIN silently degrades to
    // fresh-workspace provisioning. Same-origin today (Express serves the
    // client, Vite proxies /api in dev), which is why its absence never bit.
    'x-invitation-token',
  ],

  // Expose headers the frontend may need to read
  // x-invitation-claimed: the server's confirmation that the invitation was
  // actually consumed. The client drops its carrier copy on this and nothing
  // else, so it must be readable rather than filtered out by CORS.
  exposedHeaders: ['X-Request-Id', 'x-invitation-claimed'],
}));

// ── FIREBASE AUTH (global — populates req.user on every request) ─────
app.use(firebaseAuthMiddleware);

// ── HEALTH CHECK — Render.com probe path ─────────────────────
// Lightweight, no DB call. Required for render.yaml
// `healthCheckPath: /api/health`.
// R11 (F11): both health routes were unauthenticated AND uncapped, and /health
// performs a DB round trip. 60/min is generous for any real probe cadence.
app.get('/api/health', healthLimiter, (_req, res) => {
  const firebaseAdmin = getFirebaseAdminReadiness();
  res.status(firebaseAdmin.ok ? 200 : 503).json({
    status: firebaseAdmin.ok ? 'ok' : 'degraded',
    firebaseAdmin: firebaseAdmin.status,
    timestamp: new Date().toISOString(),
  });
});

// ── HEALTH CHECK (public, queries DB) ────────────────────────
app.get('/health', healthLimiter, async (req, res) => {
  let dbOk = false;
  try {
    const sql = getDb();
    if (sql) {
      await sql`SELECT 1`;
      dbOk = true;
    }
  } catch { /* DB may not be configured in dev */ }

  const firebaseAdmin = getFirebaseAdminReadiness();
  const ok = dbOk && firebaseAdmin.ok;

  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    system: 'MARCOM',
    version: '4.0.0',
    db: dbOk,
    firebaseAdmin: firebaseAdmin.status,
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// ── WEBHOOK ROUTES (n8n → MARCOM)
// Raw body capture must run before express.json() for HMAC verification.
// Protected by HMAC-SHA256 webhook signature (not Clerk).
// ─────────────────────────────────────────────────────────────
app.use('/webhook',
  captureRawBody,               // saves req.rawBody before body is parsed
  validateWebhook,              // HMAC-SHA256 + replay protection
  dedupeWebhookEvent,           // optional provider event-id dedup
  express.json({ limit: '10mb' }),
  chatLimiter,
  masterRouter
);

// ── API ROUTES (browser → MARCOM)
// Standard JSON body parsing + Clerk JWT enforcement.
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LUMI QUICK-ACTION (HMAC-signed link, NO JWT) ─────────────
// ── LUMI QUICK ACTION (HMAC-protected, not JWT) ─────────────
// Used by email/Slack "one-click approve" links. HMAC signature
// validation happens inside quickActionHandler (line 157-160).
// Must be mounted BEFORE the JWT-protected /api/lumi router so
// the middleware doesn't reject HMAC-only callers from email/Slack.
app.post('/api/lumi/quick-action', apiLimiter, quickActionHandler);

// ── LUMI DEMO FEED (PUBLIC — NO JWT, NO HMAC) ────────────────
// Read-only, deterministic fixture for stakeholder demos.
// Mount BEFORE /api/lumi so requireJwt doesn't reject it.
app.get('/api/lumi/demo-feed', apiLimiter, demoFeedHandler);

// Connector sync — stricter cap (5/min) than the blanket apiLimiter to guard
// the Meta/Google fetch loop from abuse. Registered BEFORE the /api/lumi mount
// so it runs ahead of requireAuth on this specific path.
app.use('/api/lumi/connections/sync', syncLimiter);

// ── LUMI CORE ROUTES (Firebase-protected) ─────────────────────────
// Phases 5 + 6: rollback, feed, _health
// BUGFIX (PR #44): Changed from requireJwt → requireAuth (Firebase migration)
app.use('/api/lumi',
  requireAuth,
  requireWorkspace,   // R11 (I60): tenant context is a precondition, not a maybe
  apiLimiter,
  lumiRouter
);

// OAuth endpoints — stricter brute-force cap (20/15min) across both providers.
// Registered before the provider mounts so it applies to initiation + callback.
app.use('/api/auth', authLimiter);

// Meta OAuth flow — MUST be mounted BEFORE blanket /api + requireAuth
// because /callback is NOT authenticated (Meta redirects browser without token).
app.use('/api/auth/meta', apiLimiter, authMetaRouter);
// Google Ads OAuth — same rule: /callback is unauthenticated (Google redirects).
app.use('/api/auth/google', apiLimiter, authGoogleRouter);

app.use('/api',
  requireAuth,                  // enforces Firebase UID (formerly Clerk)
  apiLimiter,
  exportRouter
);

// Chat history endpoints — user-scoped, light rate-limit
app.use('/api/history',
  requireAuth,
  apiLimiter,
  historyRouter
);

// Project management endpoints (user-scoped)
app.use('/api/projects',
  requireAuth,
  apiLimiter,
  projectsRouter
);

// Credential vault — encrypted OAuth tokens for ad platforms
app.use('/api/credentials',
  requireAuth,
  apiLimiter,
  credentialsRouter
);

// Campaign analysis — CSV inject + live Meta fetch
app.use('/api/campaigns',
  requireAuth,
  apiLimiter,
  campaignsRouter
);

// Meta Execution — production-grade action execution with audit logging
app.use('/api/execute',
  requireAuth,
  requireWorkspace,   // R11 (I60)
  apiLimiter,
  // R11: a dedicated workspace-keyed cap. Queueing a real ad-platform mutation
  // had no limiter of its own — it shared the blanket apiLimiter with every
  // read in the product, and that limiter was keying on an IP.
  executionLimiter,
  executionRouter
);

// Artifact Approval — human-in-the-loop review for AI-generated content (PR #28)
app.use('/api/artifacts',
  requireAuth,
  requireWorkspace,   // R11 (I60)
  apiLimiter,
  artifactApprovalRouter
);

// Real-Time Events (SSE) — live execution status updates.
// requireAuth is intentionally NOT applied here at the router level:
//   POST /api/events/token  — applies requireAuth internally (Firebase JWT via header)
//   GET  /api/events/stream — validates its own short-lived stream token (not Firebase JWT)
// This split is required because EventSource (SSE) cannot set custom headers,
// so the stream endpoint uses a different, URL-safe auth mechanism.
// R11 (F11): streamLimiter is IP-keyed and mounted here rather than inside the
// router, because GET /stream presents a short-lived token in place of an
// identity. Each connection holds a socket and a heartbeat interval for as long
// as it lives, and the endpoint had no cap at all.
app.use('/api/events', streamLimiter, eventsRouter);

// Analytics (PR #37) — approval decision intelligence & provider performance
app.use('/api/analytics',
  requireAuth,
  requireWorkspace,   // R11 (I60)
  apiLimiter,
  analyticsRouter
);

// Attribution (PR #41) — outcome attribution & real performance metrics
app.use('/api/attribution',
  requireAuth,
  requireWorkspace,   // R11 (I60)
  apiLimiter,
  attributionRouter
);

// Observability (PR #45) — Mission Control for live execution monitoring
app.use('/api/observability',
  requireAuth,
  requireWorkspace,   // R11 (I60)
  apiLimiter,
  observabilityRouter
);

// User account management — profile, workspace, account deletion
app.use('/api/user',
  requireAuth,
  apiLimiter,
  userRouter
);

// Standalone AI-powered tools (content calendar, etc.)
app.use('/api/tools',
  requireAuth,
  apiLimiter,
  toolsRouter
);

// Team & Roles — workspace roster, invitations, collab-role management.
// requireAuth is applied INSIDE the router (after the public GET /invite/accept
// link handler), so it is NOT set here. STRATEGIST-only mutations are gated
// per-route with requireCollabRole.
app.use('/api/team',
  apiLimiter,
  teamRouter
);

// Demo seed — stricter spam cap (10/hour) on the workspace-minting endpoint.
// Registered before the /api/admin mount so it runs ahead of requireAuth/requireAdmin.
app.use('/api/admin/demo/seed', adminSeedLimiter);

// Internal admin panel — system status, workspace/user inventory, demo
// management. requireAdmin gates EVERY sub-route (UserRole.ADMIN, granted only
// via the ADMIN_EMAILS allowlist). Mounted after requireAuth so unauthenticated
// callers are 401'd before the role check.
app.use('/api/admin',
  requireAuth,
  requireAdmin,
  // R11 (I60): the destructive admin guards compare against the ADMIN'S OWN
  // workspace ("you cannot delete the workspace you are in"). A null
  // workspaceId made that comparison silently never match — the guard failed
  // open on the single most destructive route in the system.
  requireWorkspace,
  apiLimiter,
  adminRouter
);

// Paid Decision Engine — Phase 1.2 (Meta MCP + Claude Orchestrator)
app.use('/api/v1/paid',
  requireAuth,
  requireWorkspace,   // R11 (I60)
  apiLimiter,
  paidRouter
);

// Chat endpoint also accessible from browser with Clerk token
app.use('/api',
  requireAuth,
  chatLimiter,
  masterRouter
);

// ── PRODUCTION: serve React client (client/dist) ─────────────
// MUST be registered AFTER every /api/* and /webhook/* mount so
// the catch-all never shadows a real route.
if (shouldServeFrontend(config.nodeEnv, process.env.SERVE_FRONTEND)) {
  // server.js lives in /src — the client build sits one level up.
  // path.resolve produces an absolute path regardless of cwd, which
  // matters on Render where the worker process cwd is not always
  // the repo root.
  const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');
  const INDEX_HTML  = path.resolve(CLIENT_DIST, 'index.html');

  // Boot-time visibility: log cwd + path resolution + dist contents so a
  // missing build is debuggable straight from Render's deploy log.
  import('fs').then(({ existsSync, readdirSync, statSync }) => {
    logger.info({
      cwd:       process.cwd(),
      __dirname,
      CLIENT_DIST,
      INDEX_HTML,
    }, '[server] static-serving paths');

    if (existsSync(INDEX_HTML)) {
      logger.info({
        path:      CLIENT_DIST,
        contents:  readdirSync(CLIENT_DIST),
        indexSize: statSync(INDEX_HTML).size,
      }, '[server] client build detected');
    } else {
      logger.error({ path: CLIENT_DIST },
        '[server] client build NOT FOUND — vite build likely failed; check buildCommand and NODE_ENV during install');
      // Walk up to find the highest existing ancestor and list its contents.
      let probe = CLIENT_DIST;
      for (let i = 0; i < 4; i++) {
        const parent = path.resolve(probe, '..');
        if (existsSync(parent)) {
          try {
            logger.error({ parent, contents: readdirSync(parent) }, '[server] parent dir listing');
          } catch { /* ignore */ }
          break;
        }
        probe = parent;
      }
    }
  });

  app.use(express.static(CLIENT_DIST));

  // SPA fallback. MUST be the LAST registered route before errorHandler.
  // Belt-and-braces: explicitly bail if anything /api/ or /webhook/
  // slipped past — should never happen given mount order, but keeps a
  // misconfig from silently 200-ing.
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
      return res.status(404).json({ error: 'Route not found' });
    }
    res.sendFile(INDEX_HTML, (err) => {
      if (err) {
        logger.error({ err: err.message, path: INDEX_HTML }, '[server] sendFile failed for SPA fallback');
        if (!res.headersSent) {
          res.status(500).type('text/plain').send(
            'Frontend build is missing on the server. ' +
            'Check Render deploy logs for "[server] client build NOT FOUND".',
          );
        }
      }
    });
  });
}

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────
app.use(errorHandler);

// ── ROUTE ORDER (final, do not reorder) ──────────────────────
// 1.  CORS
// 2.  firebaseAuthMiddleware (populates req.user / req.userId / req.workspaceId)
// 3.  Static + GET '/'              [dev only — vanilla shell]
// 4.  GET  /api/health              [Render probe]
// 5.  GET  /health                  [legacy probe + DB ping]
// 6.  /webhook/*                    [HMAC]
// 7.  POST /api/lumi/quick-action   [HMAC, NO JWT]
// 7b. GET  /api/lumi/demo-feed      [PUBLIC — stakeholder demo]
// 8.  /api/lumi/*                   [JWT]
// 9.  /api/*                        [Clerk JWT — history, projects,
//                                    credentials, campaigns, tools, etc.]
// 10. PRODUCTION: static client/dist + GET '*' SPA fallback
// 11. errorHandler  (last)
// ────────────────────────────────────────────────────────────

// ── START + GRACEFUL SHUTDOWN ────────────────────────────────
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, host: '0.0.0.0', env: config.nodeEnv }, 'MARCOM v4 online');

  // Try to connect to DB and run schema migrations.
  // In dev mode, if DB is unavailable, just log and continue.
  const sql = getDb();
  if (sql) {
    // Idempotent migration for the chat-history feature — adds the title
    // column + per-user index if they don't exist. Non-fatal on failure.
    ensureChatSessionSchema().catch(err =>
      logger.warn({ err: err.message }, 'ensureChatSessionSchema failed at startup')
    );
    ensureUserContextSchema().catch(err =>
      logger.warn({ err: err.message }, 'ensureUserContextSchema failed at startup')
    );
    ensureProjectSchema().catch(err =>
      logger.warn({ err: err.message }, 'ensureProjectSchema failed at startup')
    );
    ensureCredentialSchema().catch(err =>
      logger.warn({ err: err.message }, 'ensureCredentialSchema failed at startup')
    );
  } else if (config.nodeEnv === 'development') {
    logger.info('[DEV MODE] PostgreSQL bypassed. Phase 1 AI/Meta endpoints will work without DB.');
  } else {
    logger.error('DATABASE_URL is required in production. Server started but DB-dependent routes will fail.');
  }
});

async function shutdown(signal) {
  logger.info({ signal }, 'Graceful shutdown initiated');

  server.close(async () => {
    logger.info('HTTP server closed');
    await closeDb();
    logger.info('DB connections closed');
    process.exit(0);
  });
  // Force exit after 10 s
  setTimeout(() => { logger.error('Forced shutdown after timeout'); process.exit(1); }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
