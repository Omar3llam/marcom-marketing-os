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
import { encrypt, decrypt, saveCredentialInTransaction, withCredentialLifecycle } from '../../models/credential.js';
import { nextHealth } from './connectorHealth.js';

// Connector channel/platform identity ↔ marcom_credentials.platform string.
// GA4 is a credential identity, not a CHANNEL enum value: its connector lands
// rows tagged with the matched ad channel (META/GOOGLE), not "GA4".
export const PLATFORM_DB = Object.freeze({ META: 'meta_ads', GOOGLE: 'google_ads', GA4: 'ga4' });
const DB_CHANNEL = Object.freeze({ meta_ads: 'META', google_ads: 'GOOGLE', ga4: 'GA4' });

const dbPlatform = (channel) => PLATFORM_DB[String(channel || '').toUpperCase()] || null;

/**
 * R11 (E3) — a decryption failure is NOT "no credential".
 *
 * `safeDecrypt` swallowed every error and returned null, and `resolveCredential`
 * returns null for "no row". The two became one answer, and the product renders
 * that answer as "not connected" — so a wrong or missing
 * CREDENTIAL_ENCRYPTION_KEY, or a corrupted ciphertext, showed a customer who
 * HAD connected their ad account a screen inviting them to connect it. They
 * would reconnect, the OAuth would succeed, and the same thing would happen
 * again, because the fault was never in the connection.
 *
 * Absent ciphertext still returns null — that genuinely is "no token here".
 * A failure to decrypt one that exists throws, distinctly, with no plaintext
 * and no key material in the message.
 */
export class CredentialDecryptError extends Error {
  constructor(field) {
    super(`Stored credential could not be decrypted (${field}). Check CREDENTIAL_ENCRYPTION_KEY.`);
    this.name = 'CredentialDecryptError';
    this.code = 'DECRYPT_FAILED';
  }
}

const decryptField = (enc, field) => {
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch (err) {
    logger.error({ field, err: err.message }, '[credentialStore] DECRYPT_FAILED — stored credential is unreadable');
    throw new CredentialDecryptError(field);
  }
};

/**
 * The batch variant, for the cross-workspace sync sweep where one bad row must
 * not abort every other workspace's sync. Still LOGS at error level — the
 * difference from the old safeDecrypt is that the failure is reported rather
 * than absorbed into an indistinguishable null.
 */
const tolerateDecrypt = (enc, field) => {
  try {
    return decryptField(enc, field);
  } catch {
    return null;
  }
};

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
  if (rows.length === 0) return null;   // genuinely not connected
  const r = rows[0];
  return {
    // Throws CredentialDecryptError rather than returning null — see above.
    accessToken: decryptField(r.access_token_enc, 'access_token'),
    refreshToken: decryptField(r.refresh_token_enc, 'refresh_token'),
    accountId: r.account_id ?? null,
    expiresAt: r.expires_at ?? null,
  };
}

/** Display rows for the Connections UI — TOKENS ARE NEVER SELECTED. */
export async function listConnections(workspaceId) {
  if (!workspaceId) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT platform, account_id, last_synced_at, is_active, health, metadata, expires_at
    FROM marcom_credentials
    WHERE workspace_id = ${workspaceId}
    ORDER BY platform
  `;
  return rows.map((r) => ({
    platform: (DB_CHANNEL[r.platform] || r.platform),
    isActive: r.is_active !== false,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
    accountId: r.account_id ?? null,
    // The ad accounts the token proves access to (for the picker). Empty when the
    // credential predates the picker — the UI then shows no switch affordance.
    availableAccounts: Array.isArray(r.metadata?.availableAccounts) ? r.metadata.availableAccounts : [],
    health: r.health ?? null,
  }));
}

/**
 * Switch the active ad account for a workspace+channel WITHOUT re-running OAuth.
 * The CALLER MUST first verify accountId ∈ the stored availableAccounts (never a
 * free-form update). Scoped to the single active row resolveCredential reads.
 * @returns {Promise<boolean>} true when a row was updated.
 */
export async function updateCredentialAccount(workspaceId, channel, accountId) {
  const platform = dbPlatform(channel);
  if (!workspaceId || !platform || !accountId) return false;
  const sql = getDb();
  const updated = await sql`
    UPDATE marcom_credentials
    SET account_id = ${String(accountId)}, updated_at = NOW()
    WHERE workspace_id = ${workspaceId} AND platform = ${platform} AND is_active = true
    RETURNING id
  `;
  if (updated.length === 0) return false;
  logger.info({ workspaceId, channel, accountId }, '[credentialStore] switched active ad account');
  return true;
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
      // R11 (E3): the sweep is a FAN-OUT over every workspace, so one
      // undecryptable row must not abort the others. It is still reported as a
      // decrypt failure rather than silently becoming an absent token — the
      // sync loop's own health handling treats a null token as unusable and
      // marks the connector unhealthy, which is the honest outcome, and the
      // error line above names the row.
      accessToken: tolerateDecrypt(r.access_token_enc, 'access_token'),
      refreshToken: tolerateDecrypt(r.refresh_token_enc, 'refresh_token'),
      accountId: r.account_id ?? null,
      health: r.health ?? null,
    }));
}

/** Fold a sync result into the row's health + last_synced_at (reuses pure nextHealth). */
export async function recordSync(workspaceId, channel, { ok, error = null, warning = null, records = 0, capabilities = null, now = new Date() } = {}) {
  const platform = dbPlatform(channel);
  if (!workspaceId || !platform) return null;
  const sql = getDb();
  const cur = await sql`SELECT health FROM marcom_credentials WHERE workspace_id = ${workspaceId} AND platform = ${platform} LIMIT 1`;
  // `capabilities` (C-04) rides the same JSON column — no new column, no
  // migration. nextHealth merges it, so a caller that exercised no capability
  // this run passes null and the last recorded outcome survives untouched.
  const health = nextHealth(cur[0]?.health ?? {}, { platform, ok, error, warning, records, capabilities, now });
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
 * ADDITIVE STAMP (Phase 12c) — relate a legacy project-keyed credential row to the
 * v4 workspace so the workspace-scoped connector can resolve it, WITHOUT re-keying:
 * the same physical row keeps serving the legacy feed by (project_id, user_id).
 *
 * `platform` is the marcom_credentials.platform string (e.g. 'meta_ads'). Enforces
 * one-account-per-(workspace, platform): the stamped row becomes the sole active
 * one; any OTHER row sharing (workspace_id, platform) is deactivated so
 * resolveCredential's LIMIT 1 is unambiguous (not merely newest-wins).
 */
export async function attachWorkspaceToCredential({ projectId, userId, platform, workspaceId } = {}) {
  if (!workspaceId || !platform || !projectId) return { stamped: false };
  const sql = getDb();
  // Link and active-row reconciliation commit together; retry never sees a half-stamp.
  return sql.begin((tx) => attachOnTransaction(tx, { projectId, userId, platform, workspaceId }));
}

async function attachOnTransaction(tx, { projectId, userId, platform, workspaceId }) {
  const stamped = userId
    ? await tx`UPDATE marcom_credentials SET workspace_id = ${workspaceId}, is_active = true, updated_at = NOW() WHERE project_id = ${projectId} AND user_id = ${userId} AND platform = ${platform} RETURNING id`
    : await tx`UPDATE marcom_credentials SET workspace_id = ${workspaceId}, is_active = true, updated_at = NOW() WHERE project_id = ${projectId} AND platform = ${platform} RETURNING id`;
  if (stamped.length === 0) return { stamped: false };
  const keepId = stamped[0].id;
  const losers = await tx`
    UPDATE marcom_credentials SET is_active = false, updated_at = NOW()
    WHERE workspace_id = ${workspaceId} AND platform = ${platform} AND id <> ${keepId} AND is_active = true
    RETURNING id
  `;
  if (losers.length > 0) {
    logger.warn({ workspaceId, platform, deactivated: losers.length }, '[credentialStore] one-account rule deactivated other rows for this channel');
  }
  logger.info({ workspaceId, platform, projectId }, '[credentialStore] stamped workspace on credential');
  return { stamped: true, id: keepId, deactivated: losers.length };
}

export class MetaOAuthAuthorityError extends Error {
  constructor(code) {
    super('Meta connection authority refused');
    this.code = code;
  }
}

/**
 * PILOT-SEC-02: workspace → user → project, before the FIRST credential write.
 * Workspace FOR UPDATE also serializes Prisma lifecycle transactions and other
 * callbacks. User FOR UPDATE orders ordinary role updates/deletions. Provider
 * exchange MUST happen before this function, outside these database locks.
 */
export async function completeMetaOAuthCredential({ userId, projectId, workspaceId, accessToken, accountId, scopes, expiresAt, metadata }) {
  if (!userId || !projectId || !workspaceId || !accessToken || !accountId) {
    throw new MetaOAuthAuthorityError('incomplete_connection');
  }
  let authorityChecked = false;
  try {
    const sql = getDb();
    return await sql.begin(async (tx) => {
      const workspaces = await tx`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      if (!workspaces.length) throw new MetaOAuthAuthorityError('workspace_unavailable');
      const users = await tx`SELECT "workspaceId", "collabRole" FROM users WHERE "clerkId" = ${userId} FOR UPDATE`;
      if (users[0]?.collabRole !== 'STRATEGIST') throw new MetaOAuthAuthorityError('role_forbidden');
      const canonicalId = workspaces[0].id;
      if (users[0].workspaceId !== canonicalId) throw new MetaOAuthAuthorityError('workspace_mismatch');
      const projects = await tx`SELECT project_id FROM marcom_projects WHERE project_id = ${projectId} AND user_id = ${userId} FOR UPDATE`;
      if (!projects.length) throw new MetaOAuthAuthorityError('project_not_found');
      const existing = await tx`SELECT user_id, workspace_id FROM marcom_credentials WHERE project_id = ${projectId} AND platform = 'meta_ads' FOR UPDATE`;
      if (existing.length && (existing[0].user_id !== userId
        || (existing[0].workspace_id && existing[0].workspace_id !== canonicalId))) {
        throw new MetaOAuthAuthorityError('workspace_mismatch');
      }
      authorityChecked = true;
      await saveCredentialInTransaction(tx, userId, { projectId, platform: 'meta_ads', accessToken, accountId, scopes, expiresAt, metadata });
      const linked = await attachOnTransaction(tx, { projectId, userId, platform: 'meta_ads', workspaceId: canonicalId });
      if (!linked.stamped) throw new MetaOAuthAuthorityError('incomplete_connection');
      return linked;
    });
  } catch (err) {
    if (err instanceof MetaOAuthAuthorityError || authorityChecked) throw err;
    throw new MetaOAuthAuthorityError('authority_unavailable');
  }
}

/**
 * A Prisma transaction owns BOTH its raw purge and ORM cascade. It coordinates
 * with raw OAuth transactions through the SAME workspace row, not a shared pool.
 * No provider/Firebase calls or successful-deletion audit belong in operation.
 */
export async function withWorkspaceCredentialTransaction(client, workspaceId, operation) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
    // Freeze destructive roster/ADMIN/last-strategist guards as well as FK joins.
    await tx.$queryRaw`SELECT id FROM users WHERE "workspaceId" = ${workspaceId}::uuid ORDER BY id FOR UPDATE`;
    return operation(tx);
  });
}

/**
 * Upsert a workspace-scoped credential (the OAuth callback writes this). Keyed by
 * (project_id, platform) with project_id = workspaceId so one row per
 * (workspace, channel). Tokens encrypted at rest.
 */
export async function upsertWorkspaceCredential(workspaceId, channel, { userId, accessToken, refreshToken, accountId, scopes, expiresAt } = {}) {
  const platform = dbPlatform(channel);
  if (!workspaceId || !platform) throw new Error('upsertWorkspaceCredential: workspaceId + channel required');
  const accessEnc = accessToken ? encrypt(accessToken) : null;
  const refreshEnc = refreshToken ? encrypt(refreshToken) : null;
  await withCredentialLifecycle({ userId, workspaceId }, async (tx, canonicalId) => {
    const existing = await tx`SELECT workspace_id, user_id FROM marcom_credentials WHERE project_id = ${canonicalId} AND platform = ${platform} FOR UPDATE`;
    if (existing.length && (existing[0].workspace_id !== canonicalId
      && !(existing[0].workspace_id === null && existing[0].user_id === userId))) {
      throw new Error('Credential lifecycle association unavailable');
    }
    await tx`
    INSERT INTO marcom_credentials
      (project_id, user_id, workspace_id, platform, access_token_enc, refresh_token_enc, account_id, scopes, expires_at, is_active, updated_at)
    VALUES
      (${canonicalId}, ${userId}, ${canonicalId}, ${platform}, ${accessEnc}, ${refreshEnc}, ${accountId ?? null}, ${scopes ?? null}, ${expiresAt ?? null}, true, NOW())
    ON CONFLICT (project_id, platform) DO UPDATE SET
      workspace_id      = ${canonicalId},
      access_token_enc  = EXCLUDED.access_token_enc,
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, marcom_credentials.refresh_token_enc),
      account_id        = COALESCE(EXCLUDED.account_id, marcom_credentials.account_id),
      scopes            = COALESCE(EXCLUDED.scopes, marcom_credentials.scopes),
      expires_at        = COALESCE(EXCLUDED.expires_at, marcom_credentials.expires_at),
      is_active         = true,
      updated_at        = NOW()
    `;
    // Workspace-keyed replacements reconcile legacy rows in the SAME commit.
    await attachOnTransaction(tx, { projectId: canonicalId, platform, workspaceId: canonicalId });
  });
  logger.info({ workspaceId, channel }, '[credentialStore] upserted workspace credential');
}

/**
 * Purge credentials for admin and sole-member workspace deletion. Runtime
 * callers supply their locked Prisma transaction; maintenance callers retain
 * the historical two-key purge without claiming lifecycle coordination.
 *
 * This exists because marcom_credentials is a RAW-SQL table deliberately kept
 * out of the Prisma schema, so it has NO foreign key to workspaces and does NOT
 * cascade. Deleting the workspace row alone would leave its encrypted OAuth
 * access + refresh tokens sitting in this table forever, unreachable by the UI
 * and belonging to an account that no longer exists. A destroyed account must
 * not leave live platform credentials behind.
 *
 * Matches on BOTH keys. Phase-12c stamped one row with two identities
 * (project_id from the v1 OAuth path, workspace_id from the workspace-aware
 * one), and a pre-bridge row can still carry a NULL workspace_id while its
 * project_id holds the id — matching only one column would miss those.
 *
 * @returns {Promise<number>} rows deleted (0 when the workspace never connected)
 */
export async function deleteWorkspaceCredentials(workspaceId, transaction = null) {
  if (!workspaceId) return 0;
  if (transaction) {
    // Owner/project evidence must be resolved while users still exist. These
    // locks follow the workspace/user locks held by the deletion transaction.
    await transaction.$queryRaw`
      SELECT p.project_id FROM marcom_projects p
      JOIN users u ON u."clerkId" = p.user_id
      WHERE u."workspaceId" = ${workspaceId}::uuid
      ORDER BY p.project_id FOR UPDATE OF p
    `;
    const ambiguous = await transaction.$queryRaw`
      SELECT c.id FROM marcom_credentials c LEFT JOIN users u ON u."clerkId" = c.user_id
      WHERE (u."workspaceId" = ${workspaceId}::uuid AND c.workspace_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM marcom_projects p WHERE p.project_id = c.project_id AND p.user_id = c.user_id))
        OR (c.project_id = ${workspaceId} AND c.workspace_id IS DISTINCT FROM ${workspaceId}
          AND NOT (c.workspace_id IS NULL AND COALESCE(u."workspaceId" = ${workspaceId}::uuid, false)
            AND EXISTS (SELECT 1 FROM marcom_projects p WHERE p.project_id = c.project_id AND p.user_id = c.user_id)))
      FOR UPDATE OF c
    `;
    if (ambiguous.length) throw new Error('Workspace credential association unavailable');
    const rows = await transaction.$queryRaw`
      DELETE FROM marcom_credentials c
      WHERE c.workspace_id = ${workspaceId}
        OR (c.workspace_id IS NULL AND EXISTS (
          SELECT 1 FROM users u JOIN marcom_projects p ON p.user_id = u."clerkId"
          WHERE u."workspaceId" = ${workspaceId}::uuid
            AND u."clerkId" = c.user_id AND p.project_id = c.project_id
        ))
      RETURNING id
    `;
    return rows.length;
  }
  const sql = getDb();
  const rows = await sql`
    DELETE FROM marcom_credentials
    WHERE workspace_id = ${workspaceId} OR project_id = ${workspaceId}
    RETURNING id
  `;
  const count = rows.length;
  if (count) logger.info({ workspaceId, count }, '[credentialStore] purged workspace credentials');
  return count;
}

// Member removal keeps stamped workspace sources, but must resolve private
// legacy ownership BEFORE its User FK is destroyed. Caller holds workspace/users.
export async function deleteLegacyOwnerCredentials(userId, workspaceId, tx) {
  await tx.$queryRaw`
    SELECT p.project_id FROM marcom_projects p JOIN users u ON u."clerkId" = p.user_id
    WHERE u."clerkId" = ${userId} AND u."workspaceId" = ${workspaceId}::uuid
    ORDER BY p.project_id FOR UPDATE OF p
  `;
  const ambiguous = await tx.$queryRaw`
    SELECT c.id FROM marcom_credentials c WHERE c.user_id = ${userId} AND c.workspace_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM marcom_projects p WHERE p.project_id = c.project_id AND p.user_id = c.user_id)
    FOR UPDATE OF c
  `;
  if (ambiguous.length) throw new Error('Workspace credential association unavailable');
  const rows = await tx.$queryRaw`
    DELETE FROM marcom_credentials c WHERE c.user_id = ${userId} AND c.workspace_id IS NULL
      AND EXISTS (SELECT 1 FROM marcom_projects p JOIN users u ON u."clerkId" = p.user_id
        WHERE p.project_id = c.project_id AND p.user_id = c.user_id AND u."workspaceId" = ${workspaceId}::uuid)
    RETURNING id
  `;
  return rows.length;
}
