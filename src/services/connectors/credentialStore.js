// ============================================================
// credentialStore — the connectors' single credential seam (Phase 12B)
// ============================================================
// Phase 12 read Integration (never populated). The only populated, encrypted
// store is marcom_credentials (the v1 raw-SQL table the working Meta OAuth
// writes). Phase 12B makes it the connector connection-of-record, WORKSPACE-
// scoped: the workspace-aware OAuth connect endpoint writes workspace_id, and
// every connector resolves creds from here by (workspace_id, platform).
//
// Tokens are AES-256-GCM encrypted at rest (reuses models/credential.js helpers).
// Display reads NEVER select the token columns.
// ============================================================
import { getDb } from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { encrypt, decrypt } from '../../models/credential.js';
import { nextHealth } from './connectorHealth.js';

// Connector channel enum ↔ marcom_credentials.platform string.
export const PLATFORM_DB = Object.freeze({ META: 'meta_ads', GOOGLE: 'google_ads' });
const DB_CHANNEL = Object.freeze({ meta_ads: 'META', google_ads: 'GOOGLE' });

const dbPlatform = (channel) => PLATFORM_DB[String(channel || '').toUpperCase()] || null;
const safeDecrypt = (enc) => { try { return enc ? decrypt(enc) : null; } catch { return null; } };

/**
 * Resolve decrypted credentials for a workspace+channel, or null. The connector's
 * authenticate() reads exactly this.
 */
export async function resolveCredential(workspaceId, channel) {
  const platform = dbPlatform(channel);
  if (!workspaceId || !platform) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT access_token_enc, refresh_token_enc, account_id, expires_at
    FROM marcom_credentials
    WHERE workspace_id = ${workspaceId} AND platform = ${platform} AND is_active = true
    ORDER BY updated_at DESC LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    accessToken: safeDecrypt(r.access_token_enc),
    refreshToken: safeDecrypt(r.refresh_token_enc),
    accountId: r.account_id ?? null,
    expiresAt: r.expires_at ?? null,
  };
}

/** Display rows for the Connections UI — TOKENS ARE NEVER SELECTED. */
export async function listConnections(workspaceId) {
  if (!workspaceId) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT platform, account_id, last_synced_at, is_active, health, expires_at
    FROM marcom_credentials
    WHERE workspace_id = ${workspaceId}
    ORDER BY platform
  `;
  return rows.map((r) => ({
    platform: (DB_CHANNEL[r.platform] || r.platform),
    isActive: r.is_active !== false,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
    accountId: r.account_id ?? null,
    health: r.health ?? null,
  }));
}

/** Active, connector-syncable credentials (workspace-scoped). For the sync loop. */
export async function listActiveSyncable(workspaceId = null) {
  const sql = getDb();
  const rows = workspaceId
    ? await sql`SELECT workspace_id, platform, access_token_enc, refresh_token_enc, account_id, health FROM marcom_credentials WHERE is_active = true AND workspace_id = ${workspaceId}`
    : await sql`SELECT workspace_id, platform, access_token_enc, refresh_token_enc, account_id, health FROM marcom_credentials WHERE is_active = true AND workspace_id IS NOT NULL`;
  return rows
    .filter((r) => DB_CHANNEL[r.platform])
    .map((r) => ({
      workspaceId: r.workspace_id,
      channel: DB_CHANNEL[r.platform],
      accessToken: safeDecrypt(r.access_token_enc),
      refreshToken: safeDecrypt(r.refresh_token_enc),
      accountId: r.account_id ?? null,
      health: r.health ?? null,
    }));
}

/** Fold a sync result into the row's health + last_synced_at (reuses pure nextHealth). */
export async function recordSync(workspaceId, channel, { ok, error = null, records = 0, now = new Date() } = {}) {
  const platform = dbPlatform(channel);
  if (!workspaceId || !platform) return null;
  const sql = getDb();
  const cur = await sql`SELECT health FROM marcom_credentials WHERE workspace_id = ${workspaceId} AND platform = ${platform} LIMIT 1`;
  const health = nextHealth(cur[0]?.health ?? {}, { platform, ok, error, records, now });
  await sql`
    UPDATE marcom_credentials
    SET health = ${sql.json(health)},
        last_synced_at = ${ok ? now : sql`last_synced_at`},
        updated_at = NOW()
    WHERE workspace_id = ${workspaceId} AND platform = ${platform}
  `;
  logger.info({ workspaceId, channel, ok, records }, '[credentialStore] recordSync');
  return health;
}

/**
 * Upsert a workspace-scoped credential (the OAuth callback writes this). Keyed by
 * (project_id, platform) with project_id = workspaceId so one row per
 * (workspace, channel). Tokens encrypted at rest.
 */
export async function upsertWorkspaceCredential(workspaceId, channel, { userId, accessToken, refreshToken, accountId, scopes, expiresAt } = {}) {
  const platform = dbPlatform(channel);
  if (!workspaceId || !platform) throw new Error('upsertWorkspaceCredential: workspaceId + channel required');
  const sql = getDb();
  const accessEnc = accessToken ? encrypt(accessToken) : null;
  const refreshEnc = refreshToken ? encrypt(refreshToken) : null;
  await sql`
    INSERT INTO marcom_credentials
      (project_id, user_id, workspace_id, platform, access_token_enc, refresh_token_enc, account_id, scopes, expires_at, is_active, updated_at)
    VALUES
      (${workspaceId}, ${userId ?? workspaceId}, ${workspaceId}, ${platform}, ${accessEnc}, ${refreshEnc}, ${accountId ?? null}, ${scopes ?? null}, ${expiresAt ?? null}, true, NOW())
    ON CONFLICT (project_id, platform) DO UPDATE SET
      workspace_id      = ${workspaceId},
      access_token_enc  = EXCLUDED.access_token_enc,
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, marcom_credentials.refresh_token_enc),
      account_id        = COALESCE(EXCLUDED.account_id, marcom_credentials.account_id),
      scopes            = COALESCE(EXCLUDED.scopes, marcom_credentials.scopes),
      expires_at        = COALESCE(EXCLUDED.expires_at, marcom_credentials.expires_at),
      is_active         = true,
      updated_at        = NOW()
  `;
  logger.info({ workspaceId, channel }, '[credentialStore] upserted workspace credential');
}
