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

export function encrypt(plaintext) {
  const key = getEncKey();
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
  const iv  = randomBytes(12);                             // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(stored) {
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
  try {
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
    // Phase 12B — make marcom_credentials the workspace-scoped connector
    // connection-of-record. Idempotent column adds (raw-SQL table, no Prisma
    // migration). workspace_id is the connector key (set by the workspace-aware
    // OAuth connect endpoint); health/last_synced_at carry connector observability.
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS workspace_id   TEXT`;
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`;
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT true`;
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS health         JSONB`;
    // metadata carries the ad-account picker payload (availableAccounts the token
    // proves access to) so a user can switch the active account without re-OAuth.
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS metadata       JSONB`;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_marcom_credentials_workspace
        ON marcom_credentials (workspace_id, platform)
    `;
    logger.info('[credentials] schema ensured ✓');
  } catch (err) {
    const code = err?.code || err?.sqlState;

    if (code === '42P07' || code === '42710') {
      // 42P07 = duplicate_table, 42710 = duplicate_object (index/constraint)
      logger.debug({ code }, '[credentials] schema already exists (expected)');
    } else {
      logger.warn({ code, msg: err.message }, '[credentials] ensureSchema failed');
    }
  }
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
export async function saveCredential(userId, { projectId, platform, accessToken, refreshToken, accountId, scopes, expiresAt, metadata }) {
  return withCredentialLifecycle({ userId, projectId }, async (tx, workspaceId) => {
    const existing = await tx`SELECT user_id, workspace_id FROM marcom_credentials WHERE project_id = ${projectId} AND platform = ${platform} FOR UPDATE`;
    if (existing.length && (existing[0].user_id !== userId
      || (existing[0].workspace_id && existing[0].workspace_id !== workspaceId))) {
      throw new Error('Credential lifecycle association unavailable');
    }
    return saveCredentialInTransaction(tx, userId, { projectId, platform, accessToken, refreshToken, accountId, scopes, expiresAt, metadata });
  });
}

/** Lifecycle only: permission policy remains with each caller. Never trust the
 * preliminary lookup after locking: membership may have changed meanwhile.
 * All writers coordinate with deletion via workspace -> user -> project.
 */
export async function withCredentialLifecycle({ userId, projectId, workspaceId }, operation) {
  if (!userId || (!projectId && !workspaceId)) throw new Error('Credential lifecycle association unavailable');
  const sql = getDb();
  return sql.begin(async (tx) => {
    const owners = await tx`SELECT "workspaceId" FROM users WHERE "clerkId" = ${userId}`;
    const target = workspaceId || owners[0]?.workspaceId;
    if (!target) throw new Error('Credential lifecycle association unavailable');
    const workspaces = await tx`SELECT id FROM workspaces WHERE id = ${target}::uuid FOR UPDATE`;
    if (!workspaces.length) throw new Error('Credential lifecycle workspace unavailable');
    const canonicalId = workspaces[0].id;
    const users = await tx`SELECT "workspaceId" FROM users WHERE "clerkId" = ${userId} FOR UPDATE`;
    if (users.length !== 1 || users[0].workspaceId !== canonicalId) throw new Error('Credential lifecycle association unavailable');
    if (projectId) {
      const projects = await tx`SELECT project_id FROM marcom_projects WHERE project_id = ${projectId} AND user_id = ${userId} FOR UPDATE`;
      if (projects.length !== 1) throw new Error('Credential lifecycle association unavailable');
    }
    return operation(tx, canonicalId);
  });
}

// Only callers already holding lifecycle/authority locks may inject a client.
export async function saveCredentialInTransaction(sql, userId, { projectId, platform, accessToken, refreshToken, accountId, scopes, expiresAt, metadata }) {

  const accessEnc  = accessToken  ? encrypt(accessToken)  : null;
  const refreshEnc = refreshToken ? encrypt(refreshToken) : null;

  const rows = await sql`
    INSERT INTO marcom_credentials
      (project_id, user_id, platform, access_token_enc, refresh_token_enc, account_id, scopes, expires_at, metadata, updated_at)
    VALUES
      (${projectId}, ${userId}, ${platform}, ${accessEnc}, ${refreshEnc}, ${accountId ?? null}, ${scopes ?? null}, ${expiresAt ?? null}, ${metadata ? sql.json(metadata) : null}, NOW())
    ON CONFLICT (project_id, platform)
    DO UPDATE SET
      access_token_enc  = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      account_id        = COALESCE(EXCLUDED.account_id,  marcom_credentials.account_id),
      scopes            = COALESCE(EXCLUDED.scopes,       marcom_credentials.scopes),
      expires_at        = COALESCE(EXCLUDED.expires_at,   marcom_credentials.expires_at),
      metadata          = COALESCE(EXCLUDED.metadata,     marcom_credentials.metadata),
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
