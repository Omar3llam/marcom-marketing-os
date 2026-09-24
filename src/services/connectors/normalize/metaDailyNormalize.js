// ============================================================
// metaDailyNormalize — raw Meta daily insights → NormalizedSnapshot[] (PURE)
// ============================================================
// Phase E / R8. The first normalizer in the system whose output rows each
// measure ONE ACTUAL DAY of delivery.
//
// WHY THIS IS ITS OWN FILE AND NOT A FOURTH MODE OF metaNormalize
// ---------------------------------------------------------------
// metaNormalize ends by summing its CAMPAIGN rows into one ACCOUNT rollup. That
// is correct when every row covers the same period — one request, one window —
// and it is a fabrication the moment the rows cover different days: seven days
// of campaigns would roll up into a single account row carrying seven days of
// spend under one day's period. The rollup is not a detail that could be
// switched off; it is the shape of that function. So the daily population gets
// a normalizer that does not have one.
//
// It also partitions three levels by their id keys. Daily is CAMPAIGN ONLY
// (see dailyInsightsParams for the pagination argument), so that machinery has
// nothing to do here either.
//
// WHAT THIS REFUSES, AND WHY REFUSAL IS THE POINT
// -----------------------------------------------
// A row is only a daily observation if THE PLATFORM ITSELF says so. The
// request asks for `time_increment=1`; this module checks what actually came
// back, and drops anything that does not corroborate it:
//
//   • no date_start/date_stop        → we do not know what it measures
//   • a period spanning >1 day       → the request was ignored, or a preset
//                                      leaked in; a 90-day row must NEVER be
//                                      relabelled DAILY
//   • no `spend` field at all        → spendMinor is a NOT NULL column and we
//                                      would have to invent a 0 to store it
//
// A dropped row is an ABSENT DAY, which is the honest state and the one this
// codebase already uses everywhere else (roster-only entities land no snapshot;
// accountRollup returns null rather than a phantom zero row).
//
// WHAT IT DELIBERATELY DOES NOT CARRY
// -----------------------------------
// `reach` and `frequency` are set to null, and that is a decision rather than an
// omission. Both are CUMULATIVE metrics (metricWindow.NON_AGGREGABLE_REASON):
// they count unique people, so they do not sum across days and a daily value is
// a different quantity from the window value the fatigue ceiling judges. The
// canonical 30-day fetch exists to serve them and does. Landing a daily reach
// beside additive daily metrics would put the two families in one row and invite
// exactly the arithmetic that is wrong.
// ============================================================
import { currencyWithProvenance } from '../../../lib/currencyProvenance.js';
import { toMinor } from '../../../lib/money.js';
import { num } from './fieldUtils.js';
import { CHANNEL, DATA_SOURCE, MEASUREMENT_WINDOW } from '../connectorTypes.js';
import { extractActionMetrics } from './metaNormalize.js';
import { logger } from '../../../utils/logger.js';
import { sourceLocalDayWindow } from '../../../lib/sourceLocalDayWindow.js';

const DAY_MS = 86_400_000;

/**
 * Why a raw row was refused. Named values rather than booleans so a log line —
 * and a future health surface — can say which of four different problems it hit.
 * Mirrors verdict-engine/metricWindow.js REJECTION, which does the same job for
 * the canonical population.
 */
export const DAILY_REJECTION = Object.freeze({
  NO_IDENTITY:      'NO_IDENTITY',      // no campaign_id and no campaign_name
  MISSING_PERIOD:   'MISSING_PERIOD',   // the platform did not say what it measured
  MALFORMED_PERIOD: 'MALFORMED_PERIOD', // unparseable, or start after end
  NOT_ONE_DAY:      'NOT_ONE_DAY',      // a range — time_increment was not honoured
  MISSING_MEASURE:  'MISSING_MEASURE',  // no spend field; "unknown" is not storable
});

/** PURE: a Meta `YYYY-MM-DD` → the UTC midnight Date, or null. Never Invalid. */
function toUtcDay(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * PURE: may this raw row be persisted as a daily observation?
 *
 * Both halves must hold, exactly as canonicalEligibility requires of a canonical
 * row: we ASKED for one day, and the row's own dates must corroborate it. A
 * request parameter is a statement about what we wanted; only date_start and
 * date_stop are a statement about what Meta measured.
 *
 * @param {object} row — a raw Meta insight object
 * @returns {{ok:true, windowStart:Date, windowEnd:Date} | {ok:false, reason:string}}
 */
export function dailyEligibility(row) {
  if (!row || (row.campaign_id == null && row.campaign_name == null)) {
    // Same rule as metaNormalize: a row with no stable identity would collide
    // onto one fabricated entity id rather than describing a real campaign.
    return { ok: false, reason: DAILY_REJECTION.NO_IDENTITY };
  }
  if (row.date_start == null || row.date_stop == null) {
    return { ok: false, reason: DAILY_REJECTION.MISSING_PERIOD };
  }
  const start = toUtcDay(row.date_start);
  const end = toUtcDay(row.date_stop);
  if (start == null || end == null || start.getTime() > end.getTime()) {
    return { ok: false, reason: DAILY_REJECTION.MALFORMED_PERIOD };
  }
  // Inclusive both ends, the convention canonicalWindowBounds sets: one day is
  // [day, day]. Anything wider is a trailing aggregate wearing a daily request's
  // clothes, and relabelling it DAILY is the single worst thing this phase could
  // do — every future consumer of this population would sum it.
  if (Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1 !== 1) {
    return { ok: false, reason: DAILY_REJECTION.NOT_ONE_DAY };
  }
  // `spend` is the primitive that makes the row an observation of delivery, and
  // spendMinor is NOT NULL in the schema — so an absent field cannot be stored
  // as "unknown" and must not be stored as 0. Presence, not truthiness: a real
  // "0" or "0.00" from Meta is a measured zero and lands.
  if (row.spend == null || row.spend === '') {
    return { ok: false, reason: DAILY_REJECTION.MISSING_MEASURE };
  }
  return { ok: true, windowStart: start, windowEnd: end };
}

/**
 * Raw daily Meta insights → NormalizedSnapshot[] (one per campaign per day).
 *
 * @param {object} input
 * @param {string} input.accountExternalId — the parent for the entity graph
 * @param {string} [input.currency]
 * @param {Date}   input.date — the OBSERVATION instant (the sync). NOT the day
 *   being measured: that is windowStart/windowEnd, and conflating the two is the
 *   defect this whole population exists to avoid.
 * @param {Array}  input.rows — raw Meta insight objects, campaign level, daily
 * @returns {{ snapshots: Array, rejected: Array<{externalId, reason}> }}
 */
export function metaDailyNormalize({ accountExternalId, currency, currencyProvenance, accountTimeZone, date, rows = [] } = {}) {
  const denomination = currencyWithProvenance(currency, currencyProvenance);
  currency = denomination.currency;
  const d = date instanceof Date ? date : new Date(date);
  const snapshots = [];
  const rejected = [];

  for (const raw of rows) {
    const r = raw?._data || raw;
    const verdict = dailyEligibility(r);
    if (!verdict.ok) {
      rejected.push({ externalId: r?.campaign_id ?? r?.campaign_name ?? null, reason: verdict.reason });
      continue;
    }

    // One pass over the action arrays, reusing the normalizer's own collapse —
    // which takes the MAX across overlapping aliases rather than summing them,
    // because `omni_purchase` already contains the pixel purchases. Deriving the
    // count and the money from the same call is what keeps this population's
    // conversions identical in meaning to every other Meta row's.
    const funnel = extractActionMetrics(r.actions, r.action_values);
    const conversions = funnel?.purchase ?? 0;
    const revenueMajor = funnel?.purchaseValue ?? 0;
    const spendMinor = toMinor(num(r.spend), currency);
    const spendWindow = sourceLocalDayWindow(r.date_start, r.date_stop, accountTimeZone);

    snapshots.push({
      externalId: String(r.campaign_id ?? r.campaign_name),
      entityLevel: 'CAMPAIGN',
      parentExternalId: accountExternalId,
      name: r.campaign_name || 'Unnamed Campaign',
      channel: CHANNEL.META,
      source: DATA_SOURCE.META,
      // The observation instant. Every row from one sync shares it, which is
      // exactly right: they were all read at the same moment. What separates them
      // is the period below.
      date: d,
      measurementWindow: MEASUREMENT_WINDOW.DAILY,
      // The platform's own statement of the day it measured — never our request
      // range, never derived from `date`.
      windowStart: verdict.windowStart,
      windowEnd: verdict.windowEnd,
      spendWindowStartUtc: spendWindow.windowStart,
      spendWindowEndUtc: spendWindow.windowEnd,
      ...denomination,
      spendMinor,
      revenueMinor: toMinor(revenueMajor, currency),
      impressions: Math.round(num(r.impressions)),
      clicks: Math.round(num(r.clicks)),
      conversions: Math.round(conversions),
      // CUMULATIVE metrics, deliberately absent from this population — see the
      // header. null is the honest value: not "zero people were reached", but
      // "this row does not answer that question".
      reach: null,
      frequency: null,
      // The funnel bag rides along as it does everywhere else: null when Meta
      // reported no recognised action, never {}.
      actionMetrics: funnel,
      dailyBudgetMinor: null,
    });
  }

  if (rejected.length) {
    // Counted by reason rather than dumped: a systematic NOT_ONE_DAY means the
    // request stopped being honoured, which is a different emergency from a few
    // rows arriving without a period.
    const byReason = {};
    for (const x of rejected) byReason[x.reason] = (byReason[x.reason] ?? 0) + 1;
    logger.warn(
      { accountExternalId, dropped: rejected.length, byReason },
      '[metaDailyNormalize] refused rows that did not corroborate a one-day period',
    );
  }
  return { snapshots, rejected };
}
