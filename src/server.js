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
import { logger }           from './utils/logger.js';
import { getDb, closeDb }   from './utils/db.js';
import { ensureChatSessionSchema } from './models/chatSession.js';
import { ensureUserContextSchema } from './models/userContext.js';
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
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-signature', 'x-webhook-timestamp'],
}));

// ── CLERK (global — populates req.auth on every request) ─────
app.use(clerkAuthMiddleware());

// ── STATIC FRONTEND ──────────────────────────────────────────
// Serve all assets except index.html statically.
// index.html is served via a route below so we can inject env vars.
app.use(express.static(FRONTEND_DIR, { index: false }));

// Serve index.html with CLERK_PUBLISHABLE_KEY injected from env.
// The placeholder %%CLERK_PUBLISHABLE_KEY%% is replaced at request time —
// the key is never hardcoded in the repository.
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
app.use('/api/context',
  requireAuth,
  apiLimiter,
  contextRouter
);

// Chat endpoint also accessible from browser with Clerk token
app.use('/api',
  requireAuth,
  chatLimiter,
  masterRouter
);

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────
app.use(errorHandler);

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
