// ============================================================
// connectorConfig — single source of truth for connector date-range defaults
// ============================================================
// Before this file, the Meta date window was four+ independent literals
// (last_7d ×3, last_30d ×2) drifting across call sites with no coordination:
// a cron tick pulled 7 days while a manual button pulled 30, and the
// fetchCampaignInsights leaf defaulted to a third value. The window is a
// POLICY decision, so it lives here — once — not scattered as magic strings.
//
// Tiered on purpose. A single unified value is wrong in BOTH directions:
//   - too narrow everywhere (e.g. last_90d) silently returns zero rows for an
//     account whose last delivery is older than the window — the original
//     "1 snapshot" symptom — and re-breaks the day a real campaign ages past it;
//   - "maximum" everywhere risks an unattended cron job re-pulling years of
//     history on every tick (Meta API rate limits, for no benefit — campaigns
//     dead for years don't need re-fetching every few minutes).
// So the trigger decides the window: a human/system-INITIATED sync reaches as
// far back as Meta will serve; the unattended LOOP stays bounded.
// ============================================================

// MANUAL / connector-orchestration paths (the /connections/sync button,
// MetaConnector.fetchRaw, runConnectorSync's own fallback, the
// fetchCampaignInsights leaf): request everything Meta will still return.
// "maximum" is the only value that doesn't require guessing how old "old"
// campaigns are — any fixed number (180d/365d) just relocates the same failure
// to a later date. The real ceiling is Meta's documented insights retention
// (~37 months), not a literal we assert here; we ask for the most available.
export const DEFAULT_MANUAL_SYNC_DATE_PRESET = 'maximum';

// CRON / BullMQ scheduled path (syncWorker.js): stays bounded. An unattended
// job should catch NEW delivery, not repeatedly re-pull years of history.
export const DEFAULT_CRON_SYNC_DATE_PRESET = 'last_90d';

// LEGACY CHAT path (feed.js /api/campaigns/fetch-meta): kept deliberately
// SEPARATE — it has its own MAX_CAMPAIGNS cap that 400s above that count, so
// widening its window without revisiting the cap would break it for any account
// with real volume. Do not unify with the above until the cap is revisited.
export const DEFAULT_CHAT_ANALYSIS_DATE_PRESET = 'last_30d';
