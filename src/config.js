// ============================================================
// MARCOM — Config Validation
// Import at the very top of server.js before anything else.
// Exits with code 1 if any required variable is missing.
// ============================================================

const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'WEBHOOK_SECRET',
];

const missing = REQUIRED.filter(k => !process.env[k]);

if (missing.length > 0) {
  // Use process.stderr directly — logger may not be ready yet
  process.stderr.write(
    `[MARCOM] FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}\n` +
    `Copy .env.example to .env and fill in all values.\n`
  );
  process.exit(1);
}

export const config = {
  anthropicApiKey:      process.env.ANTHROPIC_API_KEY,
  anthropicModel:       process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
  databaseUrl:          process.env.DATABASE_URL,
  clerkPublishableKey:  process.env.CLERK_PUBLISHABLE_KEY,
  clerkSecretKey:       process.env.CLERK_SECRET_KEY,
  webhookSecret:        process.env.WEBHOOK_SECRET,
  n8nExportWebhook:     process.env.N8N_EXPORT_WEBHOOK || '',
  port:                 parseInt(process.env.PORT || '3000', 10),
  nodeEnv:              process.env.NODE_ENV || 'development',
  logLevel:             process.env.LOG_LEVEL || 'info',
  allowedOrigins:       (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
};
