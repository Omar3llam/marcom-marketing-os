// ============================================================
// MARCOM / Lumi — One-time migration: credentials → OAuthToken
// ------------------------------------------------------------
// Run with:  npm run migrate:credentials
//
// Reads every row from the legacy `marcom_credentials` table
// (encrypted with the existing AES-256-GCM scheme) and inserts
// an equivalent row into the new Prisma-managed `oauth_tokens`
// table with `encryption_version = "v0-legacy"`.
//
// The legacy ciphertext is preserved verbatim. The Phase 4
// re-key job will re-encrypt under the current
// CREDENTIAL_ENCRYPTION_KEY and bump encryptionVersion to "v1".
//
// Ownership mapping:
//   legacy.user_id  → User.clerkId   (legacy user_ids are
//                     Clerk subjects like "user_2abc...").
//
// Safe to re-run: the script skips rows whose
// (userId, provider) pair is already present.
// ============================================================
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { getDb } from '../src/utils/db.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const sql = getDb();

  // 1. Pull legacy rows
  let legacy;
  try {
    legacy = await sql`
      SELECT id, project_id, user_id, platform,
             access_token_enc, refresh_token_enc,
             account_id, scopes, expires_at, created_at, updated_at
      FROM marcom_credentials
    `;
  } catch (err) {
    if (/relation .* does not exist/i.test(err.message)) {
      logger.info('[migrate-credentials] legacy table absent — nothing to migrate');
      return;
    }
    throw err;
  }

  logger.info({ count: legacy.length }, '[migrate-credentials] starting');

  let inserted = 0, skipped = 0, orphaned = 0;

  for (const row of legacy) {
    // Resolve legacy user_id (Clerk subject) → internal User.id
    const user = await prisma.user.findUnique({
      where: { clerkId: row.user_id },
      select: { id: true },
    });
    if (!user) {
      orphaned++;
      logger.warn({ legacyUserId: row.user_id, platform: row.platform },
        '[migrate-credentials] no User row for legacy user — skipping');
      continue;
    }

    // Idempotency: collapse to one OAuthToken per (user, provider).
    // The legacy table is keyed (project_id, platform); for the new
    // one we treat platform as the provider and assume one token
    // per user/provider during the cutover. Phase 4 may add a
    // projectId column if multi-account fan-out is required.
    const existing = await prisma.oAuthToken.findFirst({
      where: { userId: user.id, provider: row.platform },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.oAuthToken.create({
      data: {
        userId:            user.id,
        provider:          row.platform,
        // Store the legacy ciphertext blobs verbatim. The
        // encryptionVersion tag tells the credential service to
        // route reads through the legacy decryptor.
        accessToken:       row.access_token_enc  || '',
        refreshToken:      row.refresh_token_enc || null,
        encryptionVersion: 'v0-legacy',
        expiresAt:         row.expires_at,
      },
    });
    inserted++;
  }

  logger.info({ inserted, skipped, orphaned, total: legacy.length },
    '[migrate-credentials] complete');
}

main()
  .catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, '[migrate-credentials] fatal');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
