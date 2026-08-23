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

// ── DAILY ADDITIVE INGESTION (Phase E / R8) ─────────────────────────────────
//
// How many trailing days of TRUE DAILY observations a sync asks Meta for.
//
// THIS IS A REQUEST BOUND, NOT A MEASUREMENT BOUND — the distinction R2 exists
// to keep. It decides how far back one sync re-reads; it says nothing about what
// a row measures. Each returned row measures exactly one day, and says so in its
// own windowStart/windowEnd.
//
// WHY IT IS SMALL AND BOUNDED. `time_increment=1` multiplies the response by the
// number of days: 50 campaigns over 7 days is 350 rows where the rolling fetch
// returns 50. Asking for `maximum` daily would return thousands of rows per
// account, blow past MAX_PAGES, and re-read history that has not changed. The
// default overlaps the daily cron generously (a missed run is caught by the next
// one) and covers the span in which Meta most actively RESTATES conversions and
// revenue, so a re-read is worth making.
//
// Clamped, not trusted: an env var cannot widen this into an unbounded pull, and
// cannot narrow it to zero days (which would silently ingest nothing while
// reporting success).
export const DAILY_INGESTION_MAX_DAYS = 28;
export const DAILY_INGESTION_DEFAULT_DAYS = 7;

/** PURE: the trailing day-count one daily fetch requests, clamped to [1, 28]. */
export function dailyIngestionDays(env = process.env) {
  const raw = Number(env.DAILY_INGESTION_DAYS || DAILY_INGESTION_DEFAULT_DAYS);
  if (!Number.isFinite(raw)) return DAILY_INGESTION_DEFAULT_DAYS;
  return Math.min(DAILY_INGESTION_MAX_DAYS, Math.max(1, Math.trunc(raw)));
}

/**
 * PURE: is daily additive ingestion switched on for this deployment?
 *
 * OPT-IN, and it stays opt-in. It is a THIRD Meta request on every sync, and no
 * production reader consumes the rows it produces — every existing selector
 * filters the DAILY population out by construction, and B4-D did not add one.
 *
 * The CODE DEFAULT stays off, which is what this function is: an unconfigured
 * deployment, a local checkout and every test spend nothing. What B4-D changed
 * is the DEPLOYMENT (render.yaml, both services), because a measurement layer
 * cannot be built against a population that has never been written. Evidence
 * first, then the reader — not the other way round.
 *
 * Exactly the string 'true' — an unset, empty, or typo'd variable stays off, so
 * the expensive state is never reached by accident.
 */
export function isDailyIngestionEnabled(env = process.env) {
  return env.DAILY_INGESTION_ENABLED === 'true';
}

// ── B4-D — WHAT THE DAILY PATH DID, AS A NAMED STATE ────────────────────────
//
// Activating this pipeline is only half a slice. The other half is being able to
// answer "so why is the population empty?" without guessing, and R8 could not:
// it reported one nullable count, and null meant the deployment has daily off,
// OR this connector has no daily path, OR the fetch threw, OR the run landed
// nothing. Four different problems with four different fixes, arriving as the
// same value.
//
// These five are deliberately NOT collapsible into a boolean or a count. The
// distinctions that must survive:
//
//   DISABLED vs NO_DATA        — nobody asked, versus we asked and there was
//                                nothing. Reading DISABLED as an empty account
//                                is how a switched-off pipeline gets mistaken
//                                for a quiet one.
//   UNIMPLEMENTED vs NO_DATA   — the provider cannot answer the question at all,
//                                versus it answered "no delivery". The first is
//                                fixed by writing a connector, the second is not
//                                a defect.
//   FAILED vs NO_DATA          — we could not look, versus we looked. Folding a
//                                rate limit into "no data" turns an outage into
//                                a measurement.
//   SUCCESS vs NO_DATA         — rows exist, versus none do. NO_DATA is honest
//                                and expected; it is never upgraded to success
//                                by writing a placeholder row.
export const DAILY_STATE = Object.freeze({
  // Daily ingestion is off for this deployment. Nothing was requested.
  DISABLED:      'DISABLED',
  // The connector takes part in sync but implements no daily capability.
  UNIMPLEMENTED: 'UNIMPLEMENTED',
  // The real fetch ran and no observations were persisted. A true outcome.
  NO_DATA:       'NO_DATA',
  // Real rows were fetched, normalized and persisted.
  SUCCESS:       'SUCCESS',
  // The path was attempted and threw before a persistence result.
  FAILED:        'FAILED',
});
