// ============================================================
// connectorHealth — per-connector observability (architect-required)
// ============================================================
// After 3–4 connectors `lastSyncedAt` alone can't answer "is Google working? did
// Meta fail? when did it last SUCCEED? how many rows?" This adds a small health
// record, persisted in the EXISTING Integration.metadata.health (display-safe;
// no new Prisma model, no migration — tokens stay in their typed fields).
//
//   { platform, lastSuccessfulSync, lastAttemptedSync, lastError, recordsImported }
//
// Staleness keys off lastSuccessfulSync (never a failed attempt) — see isStale.
// A per-run audit table (ConnectorSyncRun, the LoopRun pattern) is the documented
// follow-up if run HISTORY (not just last-state) is later wanted.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * PURE: fold a sync result into the next health record. Success advances
 * lastSuccessfulSync + recordsImported and CLEARS lastError; failure advances
 * lastAttemptedSync + lastError but PRESERVES the prior lastSuccessfulSync (so
 * staleness stays honest — a failed attempt is not "fresh").
 */
export function nextHealth(prev = {}, { platform, ok, error = null, records = 0, now = new Date() } = {}) {
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    platform: platform ?? prev.platform ?? null,
    lastAttemptedSync: iso,
    lastSuccessfulSync: ok ? iso : (prev.lastSuccessfulSync ?? null),
    lastError: ok ? null : (error ? String(error) : 'unknown error'),
    recordsImported: ok ? records : (prev.recordsImported ?? 0),
  };
}

/**
 * Persist health into Integration.metadata.health for one integration. Also
 * advances Integration.lastSyncedAt on success (the freshness anchor). Never
 * touches token fields.
 */
export async function recordSyncHealth(integration, { ok, error, records, now = new Date() }) {
  const prevMeta = integration.metadata && typeof integration.metadata === 'object' ? integration.metadata : {};
  const health = nextHealth(prevMeta.health, { platform: integration.platform, ok, error, records, now });
  const data = { metadata: { ...prevMeta, health } };
  if (ok) data.lastSyncedAt = now;
  await prisma.integration.update({ where: { id: integration.id }, data });
  logger.info({ platform: integration.platform, ok, records }, '[connectorHealth] recorded');
  return health;
}
