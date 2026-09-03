// ============================================================
// connectorHealth — per-connector observability (architect-required)
// ============================================================
// After 3–4 connectors `lastSyncedAt` alone can't answer "is Google working? did
// Meta fail? when did it last SUCCEED? how many rows?" This adds a small health
// record, persisted in marcom_credentials.health (display-safe; no new Prisma
// model, no migration — tokens stay in their encrypted columns).
//
//   { platform, lastSuccessfulSync, lastAttemptedSync, lastError, recordsImported }
//
// Staleness keys off lastSuccessfulSync (never a failed attempt) — see isStale.
// Persistence lives in credentialStore.recordSync (writes marcom_credentials.health);
// this module stays PURE so the fold is trivially testable.
// ============================================================

/**
 * PURE: fold a sync result into the next health record. Success advances
 * lastSuccessfulSync + recordsImported and CLEARS lastError; failure advances
 * lastAttemptedSync + lastError but PRESERVES the prior lastSuccessfulSync (so
 * staleness stays honest — a failed attempt is not "fresh").
 *
 * `lastWarning` is a THIRD state between success and failure: the sync worked,
 * but the data it landed is knowingly incomplete (e.g. an account with more
 * ad-sets than the pagination ceiling). It is cleared on any clean sync, so it
 * never outlives the condition that caused it. A partial sync that reported
 * plain success would be the "looks complete, isn't" failure this codebase
 * keeps correcting.
 *
 * `capabilities` (C-04) records WHAT EACH CAPABILITY DID on this run, keyed by
 * capability name. Before C-04 the sync computed `DAILY_STATE` — five values
 * with a comment block arguing every distinction between them — and threw it
 * away at the end of the run, so `GET /connections` could not answer "why is
 * the daily population empty?" at all. It is MERGED rather than replaced: a run
 * reports only the capabilities it exercised, and a run that exercised none
 * must not erase what the last one established.
 *
 * That merge means a capability outcome can outlive the run that produced it —
 * a daily SUCCESS from yesterday standing beside today's `lastError`. That is
 * the same deliberate behaviour as `lastWarning` above, and for the same
 * reason: the axes describe different facts about different runs, and forcing
 * them to agree would invent a third fact neither of them supports.
 */
export function nextHealth(prev = {}, { platform, ok, error = null, warning = null, records = 0, capabilities = null, now = new Date() } = {}) {
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  const nextCapabilities = { ...(prev.capabilities ?? {}), ...(capabilities ?? {}) };
  return {
    platform: platform ?? prev.platform ?? null,
    lastAttemptedSync: iso,
    lastSuccessfulSync: ok ? iso : (prev.lastSuccessfulSync ?? null),
    lastError: ok ? null : (error ? String(error) : 'unknown error'),
    // Only a SUCCESSFUL sync can assert "complete but partial"; on failure the
    // prior warning is preserved rather than invented or cleared.
    lastWarning: ok ? (warning ? String(warning) : null) : (prev.lastWarning ?? null),
    recordsImported: ok ? records : (prev.recordsImported ?? 0),
    // Omitted entirely when nothing has ever been recorded, so a legacy row
    // stays legacy-shaped and the projection reports NOT_RECORDED rather than
    // reading an empty object as an answer.
    ...(Object.keys(nextCapabilities).length > 0 ? { capabilities: nextCapabilities } : {}),
  };
}
