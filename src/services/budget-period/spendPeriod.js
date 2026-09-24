// ============================================================
// spendPeriod — may this spend be compared with this budget?
// ============================================================
// Dogfood readiness (d973349) returned NO-GO on one blocker, in Omar's words:
// "the number is real data with the wrong temporal meaning". Operational spend
// covers whatever the last sync fetched — `last_90d` from the cron, `maximum`
// from the Sync button — and two consumers compared it with a MONTHLY budget:
// pacing treated it as month-to-date, allocation as current monthly spend.
//
// THE INVARIANT this module is the only implementation of:
//
//   A spend-to-budget comparison may only use spend whose measurement window is
//   known to match the budget period. If the window cannot be established, the
//   result is NOT_MEASURABLE.
//
// ── WHERE THE WINDOW COMES FROM ─────────────────────────────────────────────
// From the row, and only from the row: `windowStart`/`windowEnd` are Meta's own
// `date_start`/`date_stop`, persisted by metaNormalize since Phase C, and
// `measurementWindow` says whether that provenance was established at all.
// The sync timestamp (`date`) is NEVER consulted to place spend in time. It is
// used for exactly one thing — choosing the newest reading of a stream — which
// is the rule latestPerStream already owns.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
// It does not manufacture a period. It does not pro-rate a 90-day aggregate
// into a month, sum a subset of days and call it complete, fall back to last
// month, or read a row's spend as a hint about its window. A window that is not
// the budget period is a mismatch however plausible its value looks.
// ============================================================
import { declareStatusVocabulary, KNOWLEDGE } from '@marcom/runtime-contracts';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';
import { PLATFORM_SOURCES, latestPerStream } from '../blended-truth/BlendedTruthService.js';
import { TEMPORAL } from '../../config/temporal.js';
import { authoritativeMoney, MONETARY_STATUS, MONETARY_REASON, monetaryUnavailable } from '../../lib/operationalMonetary.js';
import { combineRevenueWindows, spendWindowOfSnapshot, unknownRevenueWindow } from '../../lib/revenueMeasurementWindow.js';

const DAY_MS = 86_400_000;

/** Whether a spend-to-budget comparison may be made at all. */
export const SPEND_PERIOD_STATUS = Object.freeze({
  MEASURABLE:     'MEASURABLE',
  NOT_MEASURABLE: 'NOT_MEASURABLE',
});

// C-06 — NOT_MEASURABLE carries the token OBSERVATION_STATUS already gives the
// same word: the question structurally cannot be asked of these rows.
export const SPEND_PERIOD_KNOWLEDGE = declareStatusVocabulary('SPEND_PERIOD_STATUS', SPEND_PERIOD_STATUS, {
  [SPEND_PERIOD_STATUS.MEASURABLE]:     KNOWLEDGE.KNOWN,
  [SPEND_PERIOD_STATUS.NOT_MEASURABLE]: KNOWLEDGE.CANNOT_ASK,
});

/** Why a comparison was refused. Never a bare false. */
export const SPEND_PERIOD_REASON = Object.freeze({
  // No platform spend row exists to measure. Not a measurement of zero.
  NO_SPEND_ROWS:   'NO_SPEND_ROWS',
  // A row's window was never established (LEGACY_UNKNOWN, or no declared dates).
  WINDOW_UNKNOWN:  'WINDOW_UNKNOWN',
  // The declared window is real, and it is not the budget period.
  WINDOW_MISMATCH: 'WINDOW_MISMATCH',
  // Streams declare different windows, so their spends are not one period.
  MIXED_WINDOWS:   'MIXED_WINDOWS',
  SPEND_CURRENCY_MIXED: MONETARY_REASON.SPEND_CURRENCY_MIXED,
  SPEND_CURRENCY_UNTRUSTED: MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED,
});

/** How much of the budget period the spend must cover. */
export const PERIOD_COVERAGE = Object.freeze({
  // From the first day of the period through a day inside it — pacing's question.
  TO_DATE:  'TO_DATE',
  // Exactly the whole period — the only spend a whole-period budget can be sized against.
  COMPLETE: 'COMPLETE',
});

/** Populations whose rows carry an established window. LEGACY_UNKNOWN does not. */
const ESTABLISHED = new Set([
  MEASUREMENT_WINDOW.ROLLING_WINDOW,
  MEASUREMENT_WINDOW.CUMULATIVE_30D,
  MEASUREMENT_WINDOW.DAILY,
]);

const PLATFORM = new Set(PLATFORM_SOURCES);

/** PURE: the UTC calendar day of a Date or ISO string, as `YYYY-MM-DD`. */
export function isoDay(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** PURE: the calendar month (UTC) containing `now`, as inclusive days. */
export function calendarMonthOf(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: isoDay(new Date(Date.UTC(y, m, 1))),
    end:   isoDay(new Date(Date.UTC(y, m + 1, 0))),
  };
}

/** PURE: a period from two dates or ISO strings, as inclusive days. */
export function periodBetween(start, end) {
  return { start: isoDay(start), end: isoDay(end) };
}

/** PURE: inclusive day count of `{ start, end }`. */
export function daysIn({ start, end }) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * PURE: the window a row's producer DECLARED, or null when none was established.
 * `date` is deliberately not an input.
 */
export function declaredWindowOf(row) {
  if (!ESTABLISHED.has(row?.measurementWindow)) return null;
  const start = isoDay(row.windowStart);
  const end = isoDay(row.windowEnd);
  if (!start || !end || end < start) return null;
  return { start, end };
}

function refusal(period, reason, window = null, money = monetaryUnavailable(reason), spendWindow = unknownRevenueWindow()) {
  return {
    status: SPEND_PERIOD_STATUS.NOT_MEASURABLE, reason, period,
    window, daysCovered: null, spendMinor: null,
    spendWindow,
    currency: null, monetaryStatus: money.monetaryStatus, monetaryReason: money.monetaryReason,
  };
}

/**
 * PURE: resolve the spend a set of operational rows holds for a budget period.
 *
 * @param {Array<object>} rows — operational MetricSnapshot rows (any sources)
 * @param {{start: string, end: string}} period — the budget period, inclusive days
 * @param {object} opts
 * @param {string} opts.coverage — PERIOD_COVERAGE
 * @param {Date}   [opts.now] — bounds a TO_DATE window: it cannot end in the future
 * @returns {{ portfolio: object, byEntity: Map<string, number> }}
 *   `portfolio` is the published resolution; `byEntity` is per-entity spend,
 *   populated ONLY when the portfolio is MEASURABLE.
 */
export function resolvePeriodSpend(rows = [], period, { coverage, now = new Date() } = {}) {
  if (!period?.start || !period?.end) throw new Error('resolvePeriodSpend: period { start, end } required');
  if (!Object.values(PERIOD_COVERAGE).includes(coverage)) throw new Error('resolvePeriodSpend: coverage required');

  // Spend lives on platform rows. Revenue-only actuals (GA4 / SHOPIFY / MANUAL)
  // carry no spend and often no window — they are not evidence about this.
  const streams = latestPerStream(rows.filter((r) => PLATFORM.has(r.source)));
  const byEntity = new Map();
  if (streams.length === 0) {
    return { portfolio: refusal(period, SPEND_PERIOD_REASON.NO_SPEND_ROWS), byEntity };
  }
  const spendWindow = combineRevenueWindows(streams.map(spendWindowOfSnapshot));

  const windows = streams.map(declaredWindowOf);
  if (windows.some((w) => w === null)) {
    return { portfolio: refusal(period, SPEND_PERIOD_REASON.WINDOW_UNKNOWN, null, undefined, spendWindow), byEntity };
  }
  if (new Set(windows.map((w) => `${w.start}|${w.end}`)).size > 1) {
    return { portfolio: refusal(period, SPEND_PERIOD_REASON.MIXED_WINDOWS, null, undefined, spendWindow), byEntity };
  }

  const window = windows[0];
  const today = isoDay(now);
  const matches = coverage === PERIOD_COVERAGE.COMPLETE
    ? window.start === period.start && window.end === period.end
    : window.start === period.start && window.end <= period.end && window.end <= today;
  if (!matches) {
    // The declared window is published: "Lumi has spend for Jun 15 – Sep 12"
    // explains a refusal; a bare refusal only reports one.
    return { portfolio: refusal(period, SPEND_PERIOD_REASON.WINDOW_MISMATCH, window, undefined, spendWindow), byEntity };
  }

  const money = authoritativeMoney(streams, 'spendMinor');
  if (money.monetaryStatus !== MONETARY_STATUS.VALID) {
    return { portfolio: refusal(period, money.monetaryReason, window, money, spendWindow), byEntity };
  }

  let spendMinor = 0;
  for (const s of streams) {
    const spend = s.spendMinor ?? 0;
    spendMinor += spend;
    byEntity.set(s.entityId, (byEntity.get(s.entityId) ?? 0) + spend);
  }
  return {
    portfolio: {
      status: SPEND_PERIOD_STATUS.MEASURABLE, reason: null, period,
      window, daysCovered: daysIn(window), spendMinor,
      spendWindow,
      currency: money.currency, monetaryStatus: money.monetaryStatus, monetaryReason: null,
    },
    byEntity,
  };
}

/** Exactly what the resolver reads. `date` is here only to pick the newest reading. */
export const SPEND_PERIOD_SELECT = Object.freeze({
  entityId: true,
  source: true,
  date: true,
  spendMinor: true,
  currency: true,
  currencyProvenance: true,
  measurementWindow: true,
  windowStart: true,
  windowEnd: true,
  spendWindowStartUtc: true,
  spendWindowEndUtc: true,
});

/**
 * Read the operational population and resolve it for a budget period.
 * Same population, same recency bound, as the blended-truth read it replaces
 * as the source of budget comparisons — so the two cannot be reading different rows.
 */
export async function readPeriodSpend(workspaceId, { period, coverage, now = new Date() } = {}) {
  if (!workspaceId) throw new Error('readPeriodSpend: workspaceId required');
  const since = new Date(now.getTime() - TEMPORAL.blendedTruthSyncRecencyDays * DAY_MS);
  const rows = await selectOperationalSnapshots(workspaceId, {
    since,
    select: SPEND_PERIOD_SELECT,
    orderBy: null,
  });
  return resolvePeriodSpend(rows, period, { coverage, now });
}
