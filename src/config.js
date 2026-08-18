// ============================================================
// MARCOM — Config Validation
// Import at the very top of server.js before anything else.
// Exits with code 1 if any required variable is missing.
// ============================================================

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'WEBHOOK_SECRET',
];

// ── R11 (E3/E7) — required in PRODUCTION only ────────────────
//
// CREDENTIAL_ENCRYPTION_KEY was an optional warn. Without it every OAuth token
// in marcom_credentials is undecryptable, and the connector layer's
// safeDecrypt() turns that into `null`, which the product renders as "not
// connected". A missing key is a total credential outage that presents as a
// customer having never connected their ad account. It must stop the boot.
//
// OAUTH_STATE_SECRET is new: OAuth state signing used to reuse WEBHOOK_SECRET,
// so one key authenticated inbound n8n webhooks AND signed the state carrying
// userId/workspaceId through an OAuth redirect. A leak in either domain forged
// the other, and rotating for one broke the other at the same instant.
// Development falls back to WEBHOOK_SECRET so a local checkout still works.
const REQUIRED_IN_PRODUCTION = [
  'CREDENTIAL_ENCRYPTION_KEY',
  'OAUTH_STATE_SECRET',
];

const missing = [
  ...REQUIRED.filter(k => !process.env[k]),
  ...(IS_PRODUCTION ? REQUIRED_IN_PRODUCTION.filter(k => !process.env[k]) : []),
];

if (missing.length > 0) {
  // Use process.stderr directly — logger may not be ready yet
  process.stderr.write(
    `[MARCOM] FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}\n` +
    `Copy .env.example to .env and fill in all values.\n`
  );
  process.exit(1);
}

// ── R11 (E7) — entropy floor on the signing secrets ──────────
// A short secret is a forgeable one, and neither of these has any reason to be
// short. Checked only in production so a local checkout is not blocked by a
// throwaway value.
const MIN_SECRET_LENGTH = 32;
if (IS_PRODUCTION) {
  const weak = ['WEBHOOK_SECRET', 'OAUTH_STATE_SECRET', 'CREDENTIAL_ENCRYPTION_KEY']
    .filter(k => process.env[k] && process.env[k].length < MIN_SECRET_LENGTH);
  if (weak.length > 0) {
    process.stderr.write(
      `[MARCOM] FATAL: These secrets are shorter than ${MIN_SECRET_LENGTH} characters:\n  ${weak.join('\n  ')}\n` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n`
    );
    process.exit(1);
  }
  if (process.env.OAUTH_STATE_SECRET === process.env.WEBHOOK_SECRET) {
    process.stderr.write(
      `[MARCOM] FATAL: OAUTH_STATE_SECRET must not equal WEBHOOK_SECRET.\n` +
      `They authenticate different trust domains; sharing one means a leak in either forges the other.\n`
    );
    process.exit(1);
  }
}

// Optional vars — warn but don't exit
const OPTIONAL_WARN = [
  ...(IS_PRODUCTION ? [] : REQUIRED_IN_PRODUCTION),
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_REDIRECT_URI',
];
OPTIONAL_WARN.forEach(k => {
  if (!process.env[k]) {
    process.stderr.write(`[MARCOM] WARN: ${k} is not set — dependent features will report degraded readiness.\n`);
  }
});

export const config = {
  anthropicApiKey:              process.env.ANTHROPIC_API_KEY,
  anthropicModel:               process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  databaseUrl:                  process.env.DATABASE_URL,
  firebaseServiceAccountJson:   process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  webhookSecret:                process.env.WEBHOOK_SECRET,
  n8nExportWebhook:             process.env.N8N_EXPORT_WEBHOOK || '',
  port:                         parseInt(process.env.PORT || '3000', 10),
  nodeEnv:                      process.env.NODE_ENV || 'development',
  logLevel:                     process.env.LOG_LEVEL || 'info',
  allowedOrigins:               (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
};
