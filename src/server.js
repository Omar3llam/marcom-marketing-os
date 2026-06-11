// ============================================================
// MARCOM — Main Server  (server.js)
// ============================================================
// ⚠️ CRITICAL: dotenv MUST be configured FIRST, before any other imports.
// The .env file is in the parent directory (project root).
// ============================================================
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
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
import { firebaseAuthMiddleware, requireAuth } from './middleware/firebaseAuth.js';
import { validateWebhook, captureRawBody } from './middleware/validateWebhook.js';
import { apiLimiter, chatLimiter }          from './middleware/rateLimit.js';
import { errorHandler }     from './middleware/errorHandler.js';
import { masterRouter }     from './routes/master.js';
import { exportRouter }     from './routes/export.js';
import { historyRouter }    from './routes/history.js';
import { contextRouter }    from './routes/context.js';
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
import memoryRouter           from './routes/memory.js';
import decisionMemoryRouter   from './routes/decision-memory/index.js';
import analyticsRouter        from './routes/analytics/index.js';
import attributionRouter      from './routes/attribution.js';
import { observabilityRouter } from './routes/observability/index.js';
import { userRouter }         from './routes/user.js';
import { logger }             from './utils/logger.js';
import { getDb, closeDb }   from './utils/db.js';
import { getFirebaseAdminReadiness } from './utils/firebaseAdmin.js';
import { ensureChatSessionSchema } from './models/chatSession.js';
import { ensureUserContextSchema } from './models/userContext.js';
import { ensureProjectSchema }     from './models/project.js';
import { ensureCredentialSchema }  from './models/credential.js';
import { config }           from './config.js';
import metaMCP              from './services/metaMCP.js';

const app = express();

// ── PATHS ────────────────────────────────────────────────────
const FRONTEND_DIR = join(__dirname, '..', 'frontend');

// ── TRUST PROXY (for accurate IP in rate-limit behind nginx/Heroku) ─
app.set('trust proxy', 1);

// ── CORS ────────────────────────────────────────────────────
// RENDER_EXTERNAL_URL is injected automatically by Render (e.g. https://marcom.onrender.com).
// ALLOWED_ORIGINS can be set manually for custom domains.
const _allowedOrigins = [
  ...config.allowedOrigins,
  process.env.RENDER_EXTERNAL_URL,   // auto-populated on Render
].filter(Boolean);

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
  ],

  // Expose headers the frontend may need to read
  exposedHeaders: ['X-Request-Id'],
}));

// ── CONTENT SECURITY POLICY (defense-in-depth XSS protection) ────────
// Restricts where scripts, styles, and other resources can be loaded from.
// Even if an XSS vulnerability exists in code, CSP blocks execution.
//
// SECURITY NOTE: Fonts are now self-hosted via @fontsource (no Google CDN).
// Firebase Auth requires both accounts.google.com AND *.firebaseapp.com iframes.
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://apis.google.com",                          // Firebase Auth SDK
      // SECURITY NOTE: 'unsafe-inline' is required here. React's style={} prop and
      // several primitive/layout components use inline style objects (274 occurrences
      // across 50 files as of 2026-05-31). Switching to nonces would require threading
      // a per-request nonce through every component that uses style={}. This is a known
      // limitation — tracked as a future hardening task. Mitigation: script-src has no
      // unsafe-inline, so injected scripts cannot run even if styles can be injected.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",                                              // Self-hosted fonts + data URIs
      "img-src 'self' data: https:",                                        // Images + data URIs
      "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.firebase.com https://api.anthropic.com https://api.openai.com", // API calls
      "frame-src https://accounts.google.com https://*.firebaseapp.com",    // Google OAuth + Firebase Auth iframes
      "object-src 'none'",                                                  // Block Flash, Java, etc
      "base-uri 'self'",                                                    // Prevent base tag hijacking
      "form-action 'self'",                                                 // Only submit forms to same origin
    ].join('; ')
  );
  next();
});

// ── FIREBASE AUTH (global — populates req.user on every request) ─────
app.use(firebaseAuthMiddleware);

// ── STATIC FRONTEND (DEV / LEGACY VANILLA SHELL) ─────────────
// In production the React client (client/dist) is served by the
// catch-all block at the bottom of this file. In dev we keep the
// legacy vanilla shell on /, served from frontend/, with the
// Static file serving (no key injection needed with Firebase)
if (config.nodeEnv !== 'production') {
  app.use(express.static(FRONTEND_DIR));
}

// ── HEALTH CHECK — Render.com probe path ─────────────────────
// Lightweight, no DB call. Required for render.yaml
// `healthCheckPath: /api/health`.
app.get('/api/health', (_req, res) => {
  const firebaseAdmin = getFirebaseAdminReadiness();
  res.status(firebaseAdmin.ok ? 200 : 503).json({
    status: firebaseAdmin.ok ? 'ok' : 'degraded',
    firebaseAdmin: firebaseAdmin.status,
    timestamp: new Date().toISOString(),
  });
});

// ── HEALTH CHECK (public, queries DB) ────────────────────────
app.get('/health', async (req, res) => {
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

// ── LUMI CORE ROUTES (Firebase-protected) ─────────────────────────
// Phases 5 + 6: rollback, feed, _health
// BUGFIX (PR #44): Changed from requireJwt → requireAuth (Firebase migration)
app.use('/api/lumi',
  requireAuth,
  apiLimiter,
  lumiRouter
);

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

// Onboarding-wizard context endpoints (user-scoped)
// DEPRECATED: superseded by /api/projects. Kept for backward-compat + migration.
app.use('/api/context',
  requireAuth,
  apiLimiter,
  contextRouter
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
  apiLimiter,
  executionRouter
);

// Artifact Approval — human-in-the-loop review for AI-generated content (PR #28)
app.use('/api/artifacts',
  requireAuth,
  apiLimiter,
  artifactApprovalRouter
);

// Real-Time Events (SSE) — live execution status updates.
// requireAuth is intentionally NOT applied here at the router level:
//   POST /api/events/token  — applies requireAuth internally (Firebase JWT via header)
//   GET  /api/events/stream — validates its own short-lived stream token (not Firebase JWT)
// This split is required because EventSource (SSE) cannot set custom headers,
// so the stream endpoint uses a different, URL-safe auth mechanism.
app.use('/api/events', eventsRouter);

// Decision Memory — CMO learning system (pattern analysis)
app.use('/api/memory',
  requireAuth,
  apiLimiter,
  memoryRouter
);

// Decision Memory Foundation (PR #20) — append-only strategic memory
app.use('/api/decision-memory',
  requireAuth,
  apiLimiter,
  decisionMemoryRouter
);

// Analytics (PR #37) — approval decision intelligence & provider performance
app.use('/api/analytics',
  requireAuth,
  apiLimiter,
  analyticsRouter
);

// Attribution (PR #41) — outcome attribution & real performance metrics
app.use('/api/attribution',
  requireAuth,
  apiLimiter,
  attributionRouter
);

// Observability (PR #45) — Mission Control for live execution monitoring
app.use('/api/observability',
  requireAuth,
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

// Paid Decision Engine — Phase 1.2 (Meta MCP + Claude Orchestrator)
app.use('/api/v1/paid',
  requireAuth,
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
if (config.nodeEnv === 'production') {
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
// 2.  Clerk middleware (populates req.auth)
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

  // Disconnect MetaMCP child process FIRST — before closing the HTTP server.
  // metaMCP.js no longer owns process signals (rogue handlers were removed);
  // disconnecting here ensures the stdio transport is torn down cleanly
  // without interfering with the event loop while the port is still open.
  try {
    await metaMCP.disconnect();
    logger.info('MetaMCP disconnected');
  } catch (err) {
    logger.warn({ err: err.message }, 'MetaMCP disconnect failed (non-fatal)');
  }

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
