// ============================================================
// Spend-Window Integrity — shared fixtures
// ------------------------------------------------------------
// Dogfood readiness (d973349) returned NO-GO on one blocker: spend measured
// over the last sync's window (`last_90d` from the cron, `maximum` from the
// Sync button) was consumed as MONTH-TO-DATE by pacing and as CURRENT MONTHLY
// SPEND by allocation. The row was real; its temporal meaning was not.
//
// THE INVARIANT (Omar):
//   A spend-to-budget comparison may only use spend whose measurement window is
//   known to match the budget period. If the window cannot be established, the
//   result is NOT_MEASURABLE.
//
// Every fixture here names the window META DECLARED for the row — the
// `windowStart`/`windowEnd` metaNormalize persists from `date_start`/
// `date_stop`. Nothing is placed in time by `date`, which is when our sync
// looked, not what it measured.
// ============================================================

/** A Sunday in a 30-day month: 12 complete days before it. */
export const NOW = new Date(Date.UTC(2026, 8, 13, 12));

/** The account really spends this much every day. */
export const PER_DAY = 1_000;

/** A monthly budget equal to what the account really spends in September. */
export const MONTHLY_BUDGET = PER_DAY * 30;

/** UTC midnight of an ISO day — how metaNormalize stores Meta's date strings. */
export const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

/** Inclusive day count of a declared window. */
export function daysIn({ start, end }) {
  return Math.round((day(end).getTime() - day(start).getTime()) / 86_400_000) + 1;
}

/**
 * The windows a real account's rows can declare, relative to NOW.
 * Meta's presets end YESTERDAY — the last complete day — so they stop 09-12.
 */
export const WINDOWS = Object.freeze({
  LAST_90D:          Object.freeze({ start: '2026-06-15', end: '2026-09-12' }),
  MAXIMUM:           Object.freeze({ start: '2023-08-01', end: '2026-09-12' }),
  CANONICAL_30D:     Object.freeze({ start: '2026-08-14', end: '2026-09-12' }),
  MONTH_TO_DATE:     Object.freeze({ start: '2026-09-01', end: '2026-09-12' }),
  // Stale: a genuine month-to-date window — of LAST month.
  PRIOR_MONTH_TO_DATE: Object.freeze({ start: '2026-08-01', end: '2026-08-12' }),
  AUGUST:            Object.freeze({ start: '2026-08-01', end: '2026-08-31' }),
  JULY:              Object.freeze({ start: '2026-07-01', end: '2026-07-31' }),
});

/** When the sync that wrote these rows ran. Inside September on purpose. */
export const SYNCED_AT = new Date(Date.UTC(2026, 8, 13, 9));

/**
 * One operational MetricSnapshot row as the Evidence seam returns it.
 * `window: null` means Meta reported no period (and the writer stored none).
 */
export function snapshot({
  entityId = 'camp-1',
  source = 'META',
  measurementWindow = 'ROLLING_WINDOW',
  window = WINDOWS.LAST_90D,
  spendMinor,
  revenueMinor = 0,
  date = SYNCED_AT,
  currency = 'USD',
  currencyProvenance = 'PLATFORM_REPORTED',
} = {}) {
  return {
    entityId,
    entityLevel: 'CAMPAIGN',
    source,
    measurementWindow,
    windowStart: window ? day(window.start) : null,
    windowEnd: window ? day(window.end) : null,
    // This fixture models a source account whose timezone is UTC; these are
    // exact UTC interval bounds, distinct from the inclusive date labels above.
    spendWindowStartUtc: window ? day(window.start) : null,
    spendWindowEndUtc: window ? new Date(day(window.end).getTime() + 86_400_000) : null,
    date,
    spendMinor,
    revenueMinor,
    currency,
    currencyProvenance,
  };
}

/** Spend a window really holds for an account spending PER_DAY. */
export const spendOver = (window, perDay = PER_DAY) => daysIn(window) * perDay;
