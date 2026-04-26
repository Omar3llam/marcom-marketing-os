// ============================================================
// MARCOM — Credential Store
// AES-256-GCM encryption at rest for OAuth tokens (Google Ads,
// LinkedIn Ads, Meta, etc.).  Key loaded from CREDENTIAL_ENCRYPTION_KEY
// (64 hex chars = 32 bytes).  Gracefully no-ops when key is absent —
// callers receive null from getCredential() and an error on saveCredential().
// ============================================================
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getDb }   from '../utils/db.js';
import { logger }  from '../utils/logger.js';

// ── KEY SETUP ────────────────────────────────────────────────
let _encKey = null;

function getEncKey() {
  if (_encKey) return _encKey;
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    logger.warn('[credentials] CREDENTIAL_ENCRYPTION_KEY not set or too short — credential encryption unavailable');
    return null;
  }
  _encKey = Buffer.from(hex.slice(0, 64), 'hex');
  return _encKey;
}

// ── ENCRYPTION HELPERS ───────────────────────────────────────
// Format stored:  <iv_hex>:<authTag_hex>:<ciphertext_hex>

function encrypt(plaintext) {
  const key = getEncKey();
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
  const iv  = randomBytes(12);                             // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

function decrypt(stored) {
  const key = getEncKey();
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
  const [ivHex, tagHex, ctHex] = stored.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid stored credential format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(ctHex, 'hex')) + decipher.final('utf8');
}

// ── SCHEMA MIGRATION ─────────────────────────────────────────
export async function ensureCredentialSchema() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS marcom_credentials (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id      TEXT        NOT NULL,
      user_id         TEXT        NOT NULL,
      platform        TEXT        NOT NULL,
      access_token_enc  TEXT,
      refresh_token_enc TEXT,
      account_id      TEXT,
      scopes          TEXT,
      expires_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (project_id, platform)
    )
  `;
  // Index for per-user look-ups (list all credentials for a user)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_marcom_credentials_user
      ON marcom_credentials (user_id)
  `;
  logger.info('[credentials] Schema ensured');
}

// ── PUBLIC API ───────────────────────────────────────────────

/**
 * Upsert a credential record.
 * @param {string} userId
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.platform        — e.g. 'google_ads', 'linkedin_ads'
 * @param {string} [params.accessToken]
 * @param {string} [params.refreshToken]
 * @param {string} [params.accountId]
 * @param {string} [params.scopes]
 * @param {Date}   [params.expiresAt]
 */
export async function saveCredential(userId, { projectId, platform, accessToken, refreshToken, accountId, scopes, expiresAt }) {
  const sql = getDb();

  const accessEnc  = accessToken  ? encrypt(accessToken)  : null;
  const refreshEnc = refreshToken ? encrypt(refreshToken) : null;

  const rows = await sql`
    INSERT INTO marcom_credentials
      (project_id, user_id, platform, access_token_enc, refresh_token_enc, account_id, scopes, expires_at, updated_at)
    VALUES
      (${projectId}, ${userId}, ${platform}, ${accessEnc}, ${refreshEnc}, ${accountId ?? null}, ${scopes ?? null}, ${expiresAt ?? null}, NOW())
    ON CONFLICT (project_id, platform)
    DO UPDATE SET
      access_token_enc  = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      account_id        = COALESCE(EXCLUDED.account_id,  marcom_credentials.account_id),
      scopes            = COALESCE(EXCLUDED.scopes,       marcom_credentials.scopes),
      expires_at        = COALESCE(EXCLUDED.expires_at,   marcom_credentials.expires_at),
      updated_at        = NOW()
    WHERE marcom_credentials.user_id = ${userId}
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new Error(`saveCredential: conflict row ownership mismatch for project ${projectId} / platform ${platform}`);
  }
  logger.info({ userId, projectId, platform }, '[credentials] Saved');
  return _decryptRow(rows[0]);
}

/**
 * Retrieve a decrypted credential for a project+platform.
 * Returns null if not found.
 */
export async function getCredential(userId, projectId, platform) {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM marcom_credentials
    WHERE project_id = ${projectId}
      AND platform   = ${platform}
      AND user_id    = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return _decryptRow(rows[0]);
}

/**
 * List all credentials for a user (tokens redacted — metadata only).
 */
export async function listCredentials(userId, projectId) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, project_id, platform, account_id, scopes, expires_at, created_at, updated_at
    FROM marcom_credentials
    WHERE user_id    = ${userId}
      AND project_id = ${projectId}
    ORDER BY platform
  `;
  return rows;
}

/**
 * Delete a credential record (hard delete).
 */
export async function deleteCredential(userId, projectId, platform) {
  const sql = getDb();
  await sql`
    DELETE FROM marcom_credentials
    WHERE project_id = ${projectId}
      AND platform   = ${platform}
      AND user_id    = ${userId}
  `;
  logger.info({ userId, projectId, platform }, '[credentials] Deleted');
}

// ── INTERNAL HELPERS ─────────────────────────────────────────
function _decryptRow(row) {
  return {
    id:           row.id,
    projectId:    row.project_id,
    platform:     row.platform,
    accountId:    row.account_id,
    scopes:       row.scopes,
    expiresAt:    row.expires_at,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    accessToken:  row.access_token_enc  ? decrypt(row.access_token_enc)  : null,
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null,
  };
}
