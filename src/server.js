// ============================================================
// MARCOM — Main Server  (server.js)
// Import order matters:
//   1. Config validation (exits if env vars missing)
//   2. Dotenv (already loaded by config.js via dotenv/config)
//   3. Everything else
// ============================================================
import './config.js';           // Validates env vars; exits on failure
import 'dotenv/config';

import express              from 'express';
import cors                 from 'cors';
import { readFile }         from 'fs/promises';
import { fileURLToPath }    from 'url';
import { dirname, join }    from 'path';
import { clerkAuthMiddleware, requireAuth } from './middleware/clerkAuth.js';
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
import { campaignsRouter }    from './routes/campaigns.js';
import { toolsRouter }        from './routes/tools.js';
import { lumiRouter, quickActionHandler, demoFeedHandler } from './routes/lumi.js';
import { requireJwt }         from './middleware/jwtAuth.js';
import { logger }             from './utils/logger.js';
import { getDb, closeDb }   from './utils/db.js';
import { ensureChatSessionSchema } from './models/chatSession.js';
import { ensureUserContextSchema } from './models/userContext.js';
import { ensureProjectSchema }     from './models/project.js';
import { ensureCredentialSchema }  from './models/credential.js';
import { config }           from './config.js';

const app = express();

// ── PATHS ────────────────────────────────────────────────────
const __dirname    = dirname(fileURLToPath(import.meta.url));
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
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-signature', 'x-webhook-timestamp'],
}));

// ── CLERK (global — populates req.auth on every request) ─────
app.use(clerkAuthMiddleware());

// ── STATIC FRONTEND (DEV / LEGACY VANILLA SHELL) ─────────────
// In production the React client (client/dist) is served by the
// catch-all block at the bottom of this file. In dev we keep the
// legacy vanilla shell on /, served from frontend/, with the
// Clerk publishable key injected at request time.
if (config.nodeEnv !== 'production') {
  app.use(express.static(FRONTEND_DIR, { index: false }));

  app.get('/', async (req, res) => {
    try {
      const html = await readFile(join(FRONTEND_DIR, 'index.html'), 'utf8');
      const injected = html.replace('%%CLERK_PUBLISHABLE_KEY%%', config.clerkPublishableKey);
      res.type('html').send(injected);
    } catch (err) {
      logger.error({ err }, 'Failed to serve index.html');
      res.status(500).send('Application failed to load. Please try again.');
    }
  });
}

// ── HEALTH CHECK — Render.com probe path ─────────────────────
// Lightweight, no DB call. Required for render.yaml
// `healthCheckPath: /api/health`.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── HEALTH CHECK (public, queries DB) ────────────────────────
app.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    const sql = getDb();
    await sql`SELECT 1`;
    dbOk = true;
  } catch { /* DB may not be configured in dev */ }

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    system: 'MARCOM',
    version: '4.0.0',
    db: dbOk ? 'ok' : 'unavailable',
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
// Must be mounted BEFORE the JWT-protected /api/lumi router so
// the middleware doesn't reject HMAC-only callers from email/Slack.
app.post('/api/lumi/quick-action', apiLimiter, quickActionHandler);

// ── LUMI DEMO FEED (PUBLIC — NO JWT, NO HMAC) ────────────────
// Read-only, deterministic fixture for stakeholder demos.
// Mount BEFORE /api/lumi so requireJwt doesn't reject it.
app.get('/api/lumi/demo-feed', apiLimiter, demoFeedHandler);

// ── LUMI CORE ROUTES (JWT-protected) ─────────────────────────
// Phases 5 + 6: rollback, feed, _health
app.use('/api/lumi',
  requireJwt,
  apiLimiter,
  lumiRouter
);

app.use('/api',
  requireAuth,                  // enforces Clerk userId
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

// Meta OAuth flow — /connect is Clerk-gated inside the router;
// /callback is NOT (Meta redirects browser without Clerk JWT).
app.use('/api/auth/meta', apiLimiter, authMetaRouter);

// Campaign analysis — CSV inject + live Meta fetch
app.use('/api/campaigns',
  requireAuth,
  apiLimiter,
  campaignsRouter
);

// Standalone AI-powered tools (content calendar, etc.)
app.use('/api/tools',
  requireAuth,
  apiLimiter,
  toolsRouter
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
  // server.js lives in /src — the client build sits one level up
  const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');
  // Boot-time visibility: surface a missing client build immediately
  // in deploy logs instead of relying on a runtime 500.
  import('fs').then(({ existsSync }) => {
    if (!existsSync(join(CLIENT_DIST, 'index.html'))) {
      logger.error({ path: CLIENT_DIST }, '[server] client build NOT FOUND — vite build likely failed; check buildCommand and NODE_ENV during install');
    } else {
      logger.info({ path: CLIENT_DIST }, '[server] client build detected');
    }
  });
  app.use(express.static(CLIENT_DIST));

  // SPA fallback. Belt-and-braces: explicitly bail if anything
  // /api/ or /webhook/ slipped past — should never happen given
  // mount order, but keeps misconfig from silently 200-ing.
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
      return res.status(404).json({ error: 'Route not found' });
    }
    res.sendFile(join(CLIENT_DIST, 'index.html'));
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
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'MARCOM v4 online');
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
