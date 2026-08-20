// ============================================================
// dailyObservationReader — reading the DAILY population safely
// ============================================================
// R9. Phase E (R8) made Lumi able to STORE a true daily observation. This is the
// read side, and the whole of it: given an entity and an execution boundary, it
// answers
//
//     what daily observations exist before and after it,
//     and may those observations legally be compared?
//
// and refuses, by name, when it cannot answer honestly.
//
// IT IS NOT AN OUTCOME ENGINE. Nothing here scores, judges, attributes or
// concludes. `interventionAt` is used as a temporal boundary and nothing more —
// the instant the caller says the campaign was changed, from whichever
// provenance it holds, and this module adds no causal meaning to it. The word
// "outcome" does not appear in the result shape on purpose.
//
// THE PARAMETER USED TO BE CALLED `executedAt`, which named a Decision column
// this module never reads and which, since the provenance split, cannot say
// whose execution it recorded. Nothing here needs to know: the value is a
// divider between before and after. `interventionAt` is what the caller should
// pass — decisionProvenance.interventionAt over the decision, the earlier of
// humanExecutedAt and platformExecutedAt.

//
// THE POPULATION IS NAMED, NEVER INFERRED
// ---------------------------------------
// Every query says `measurementWindow: DAILY`. It never reads ROLLING_WINDOW,
// CUMULATIVE_30D or LEGACY_UNKNOWN, and it never infers dailiness from
// `granularity` — which every writer in this codebase hardcodes to DAILY on rows
// that are 90-day and lifetime aggregates, and which the schema itself warns is
// not a claim about what a row measures.
//
// THE DAY COMES FROM THE PLATFORM, NOT FROM US
// --------------------------------------------
// A row is placed in time by `windowStart`/`windowEnd` — the period Meta
// declared — and never by `date`, which is when our sync happened to look. The
// two can be weeks apart, and classifying by `date` would put a Tuesday
// observation on the wrong side of a Wednesday boundary purely because a
// backfill ran late. Every temporal decision in this file reads the declared
// period; `date` is used for exactly one thing, which is deciding which of two
// observations OF THE SAME DAY is the more recent reading.
//
// DUPLICATES ARE EXPECTED, NOT EXCEPTIONAL
// ----------------------------------------
// Phase E documented that the database does not enforce one row per entity-day:
// the shared unique key carries `date`, so it cannot, and the sink's read-then-
// write is not a constraint. Two concurrent syncs can therefore each land a row
// for the same day. This reader reduces them deterministically — latest
// observation wins — and refuses the one case where "latest" does not decide.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';
import { areComparable, dailyPeriod } from './observationComparability.js';

const DAY_MS = 86_400_000;

/**
 * What the read could establish. Four states, deliberately not collapsed into a
 * boolean or a null: "we refuse to compare these" and "nobody has observed that
 * day" are different facts with different fixes, and a caller that cannot tell
 * them apart will report the wrong thing to a human.
 */
export const OBSERVATION_STATUS = Object.freeze({
  MEASURABLE:     'MEASURABLE',     // a comparable before/after pair exists
  NOT_OBSERVED:   'NOT_OBSERVED',   // the read succeeded; one side has no observation
  AMBIGUOUS:      'AMBIGUOUS',      // a day did not reduce to a single reading
  NOT_MEASURABLE: 'NOT_MEASURABLE', // structurally refused — see `reason`
});

/** Why a single row was excluded from the population before reduction. */
export const ROW_REJECTION = Object.freeze({
  WRONG_POPULATION:  'WRONG_POPULATION',  // not a DAILY row
  MISSING_PERIOD:    'MISSING_PERIOD',    // no windowStart / windowEnd
  MALFORMED_PERIOD:  'MALFORMED_PERIOD',  // inverted, unparseable, or not one day
  CROSSES_BOUNDARY:  'CROSSES_BOUNDARY',  // the day contains interventionAt itself
  MISSING_OBSERVED:  'MISSING_OBSERVED',  // no `date` — cannot rank same-day rows
});

/**
 * The projection this read owns. Named, never a SELECT *: a new MetricSnapshot
 * column would otherwise widen it silently and throw during migration lag (#209).
 *
 * `id` is here for a reason beyond housekeeping — I20's twelfth condition is that
 * the exact rows consumed can be identified, so a result that could not name its
 * rows would be refused by its own contract.
 */
export const DAILY_OBSERVATION_SELECT = Object.freeze({
  id: true,
  workspaceId: true,
  entityId: true,
  entityLevel: true,
  source: true,
  measurementWindow: true,
  date: true,          // the OBSERVATION instant — when the sync looked
  windowStart: true,   // the MEASURED day — what it looked at
  windowEnd: true,
  spendMinor: true,
  revenueMinor: true,
  impressions: true,
  clicks: true,
  conversions: true,
  ctr: true,
  roas: true,
  reach: true,
  frequency: true,
  currency: true,
});

/** How many days either side of the boundary a caller gets if it does not say. */
export const DEFAULT_SPAN_DAYS = 7;

/**
 * PURE: the UTC day a declared period belongs to, as `YYYY-MM-DD`.
 * Derived from windowStart — the platform's own statement — never from `date`.
 */
export function logicalDay(observation) {
  const p = dailyPeriod(observation);
  return p == null ? null : new Date(p.start).toISOString().slice(0, 10);
}

/**
 * PURE: split raw DAILY rows into the observations a comparison may use.
 *
 * Three things happen here, in this order, and the order is load-bearing:
 *
 *   1. REFUSE what is not a day. A row with no declared period, an inverted one,
 *      or one spanning more than a day is excluded by name. It is not repaired,
 *      not clamped, and not counted as evidence.
 *   2. REFUSE what straddles the boundary. A day containing `interventionAt` is
 *      neither a clean before nor a clean after — the intervention happened
 *      partway through the period it would be evidence for. There is no
 *      tolerance and no rounding to midnight: the boundary is where the operator
 *      put it.
 *   3. REDUCE each remaining day to ONE reading, latest observation first.
 *
 * @param {Array} rows — raw rows, DAILY population only
 * @param {Date}  interventionAt — the boundary; rows are classified around it
 * @returns {{ before: Array, after: Array, excluded: Array }}
 */
export function classifyAndReduce(rows = [], interventionAt) {
  const boundary = interventionAt instanceof Date ? interventionAt.getTime() : new Date(interventionAt).getTime();
  const excluded = [];
  const beforeByDay = new Map();
  const afterByDay = new Map();

  for (const row of rows) {
    // The query already names the population, so this is the second lock on the
    // same door — and it is the one that holds if a caller ever hands these rows
    // in directly, or if a future query loses its filter. A rolling aggregate
    // must never be EXPOSED as a daily observation, not merely refused later by
    // the comparability contract: by then it has already been read as a day.
    if (row?.measurementWindow !== MEASUREMENT_WINDOW.DAILY) {
      excluded.push({ id: row?.id ?? null, reason: ROW_REJECTION.WRONG_POPULATION });
      continue;
    }
    if (row?.windowStart == null || row?.windowEnd == null) {
      excluded.push({ id: row?.id ?? null, reason: ROW_REJECTION.MISSING_PERIOD });
      continue;
    }
    const period = dailyPeriod(row);
    if (period == null) {
      excluded.push({ id: row?.id ?? null, reason: ROW_REJECTION.MALFORMED_PERIOD });
      continue;
    }
    if (row.date == null) {
      // Without an observation instant there is no way to rank two readings of
      // the same day, so the row cannot take part in the reduction below.
      excluded.push({ id: row?.id ?? null, reason: ROW_REJECTION.MISSING_OBSERVED });
      continue;
    }

    // The classification, from the declared period alone.
    //   BEFORE : the whole day finished at or before the boundary
    //   AFTER  : the whole day began at or after it
    //   neither: the boundary falls inside the day
    const target = period.end <= boundary ? beforeByDay
      : period.start >= boundary ? afterByDay
        : null;
    if (target == null) {
      excluded.push({ id: row.id ?? null, reason: ROW_REJECTION.CROSSES_BOUNDARY });
      continue;
    }
    const day = new Date(period.start).toISOString().slice(0, 10);
    if (!target.has(day)) target.set(day, []);
    target.get(day).push(row);
  }

  return {
    before: [...beforeByDay.entries()].map(([day, rs]) => reduceDay(day, rs)).sort(byDay),
    after: [...afterByDay.entries()].map(([day, rs]) => reduceDay(day, rs)).sort(byDay),
    excluded,
  };
}

/**
 * PURE: several physical rows for one logical day → ONE observation.
 *
 * THE RULE: the latest OBSERVATION TIMESTAMP wins — `MetricSnapshot.date`, the
 * moment the sync read it. Not insertion order, not array order, not whatever
 * the database returned first, and not `createdAt` (which this table does not
 * carry). A restatement is later than what it restates, so the newest reading is
 * the current belief about that day.
 *
 * THE ONE CASE THE RULE DOES NOT DECIDE: two rows read at the SAME instant that
 * disagree. Nothing in the data ranks them, so the day is marked AMBIGUOUS and
 * the comparability contract refuses it. Picking one would make the answer
 * depend on which row a query happened to return first — the "wrong number
 * arriving silently" defect this architecture keeps closing.
 *
 * Rows read at the same instant that AGREE are not ambiguous: they are the same
 * measurement written twice. The row with the lowest id is chosen so a re-run
 * reproduces the same provenance, and every tied id is reported.
 */
export function reduceDay(day, rows) {
  const ranked = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const newestMs = new Date(ranked[0].date).getTime();
  const tied = ranked.filter((r) => new Date(r.date).getTime() === newestMs);

  if (tied.length > 1) {
    const disagree = tied.some((r) => !sameMeasurement(r, tied[0]));
    if (disagree) {
      return {
        ...observationOf(day, tied[0]),
        ambiguous: true,
        tiedIds: tied.map((r) => r.id).sort(),
      };
    }
    const chosen = [...tied].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    return { ...observationOf(day, chosen), tiedIds: tied.map((r) => r.id).sort() };
  }
  return observationOf(day, ranked[0]);
}

/**
 * Read the DAILY observations around an execution boundary.
 *
 * SCOPE IS FOUR REQUIRED FACTS, and all four narrow: workspace, entity, level
 * and source. `entityId` is a scalar rather than a list, so no caller can widen
 * the read to entities it did not ask about — the narrowing is structural rather
 * than a rule someone must remember. The entity identity belongs to the decision
 * being measured; it is never taken from whichever rows happen to exist.
 *
 * SOURCE IS REQUIRED for the same reason it is in the comparability contract:
 * Meta's day and GA4's day are two measurements, and a reader that could return
 * both would eventually be asked to subtract them.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @param {object} args
 * @param {string} args.entityId
 * @param {string} args.entityLevel
 * @param {string} args.source
 * @param {Date}   args.interventionAt — the boundary. Used as a temporal divider and
 *   nothing else; this module attaches no causal meaning to it.
 * @param {number} [args.beforeDays] — days of history to read before the boundary
 * @param {number} [args.afterDays]  — days to read after it
 * @returns {Promise<object>} the result contract — see OBSERVATION_STATUS
 */
export async function readDailyObservations(workspaceId, {
  entityId, entityLevel, source, interventionAt,
  beforeDays = DEFAULT_SPAN_DAYS, afterDays = DEFAULT_SPAN_DAYS,
} = {}) {
  // Programming errors, not runtime states: every one of these would silently
  // widen the read rather than fail it, and a scoped read that quietly loses its
  // scope is the failure mode I2 exists to prevent.
  if (!workspaceId) throw new Error('readDailyObservations: workspaceId required');
  if (!entityId) throw new Error('readDailyObservations: entityId required');
  if (!entityLevel) throw new Error('readDailyObservations: entityLevel required — a level is part of an entity\'s identity');
  if (!source) throw new Error('readDailyObservations: source required — two sources measuring one day are two measurements');
  const boundary = interventionAt instanceof Date ? interventionAt : new Date(interventionAt);
  if (!Number.isFinite(boundary.getTime())) throw new Error('readDailyObservations: interventionAt must be a valid date');
  for (const [name, n] of [['beforeDays', beforeDays], ['afterDays', afterDays]]) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`readDailyObservations: ${name} must be a positive integer`);
  }

  // The span is counted in WHOLE UTC DAYS either side of the day the boundary
  // falls in, because a day is the unit this population measures in. Anchoring
  // the range to the boundary INSTANT instead would make `beforeDays: 2` reach
  // back two days and a fraction, and the half-day at the far end would be
  // unreachable — a caller asking for two days would silently get one.
  //
  // Bounded on windowStart — the MEASURED day — never on `date`. A row synced
  // today about a day three weeks ago belongs to that day, and a range over sync
  // timestamps would both miss it and admit rows about days outside the span.
  const boundaryDay = dayStart(boundary);
  const rangeStart = new Date(boundaryDay - beforeDays * DAY_MS);
  const rangeEnd = new Date(boundaryDay + afterDays * DAY_MS);

  const rows = await prisma.metricSnapshot.findMany({
    where: {
      workspaceId,
      entityId,
      entityLevel,
      source,
      // NAMED, never inferred from `granularity`, which is hardcoded DAILY by
      // every writer in this codebase on rows that are 90-day aggregates.
      measurementWindow: MEASUREMENT_WINDOW.DAILY,
      windowStart: { gte: rangeStart, lte: rangeEnd },
    },
    select: DAILY_OBSERVATION_SELECT,
    // By measured day, then by observation instant. The second key is what makes
    // the reduction's input deterministic before the reduction even runs.
    orderBy: [{ windowStart: 'asc' }, { date: 'asc' }],
  });

  const { before, after, excluded } = classifyAndReduce(rows, boundary);

  // The pair adjacent to the boundary: the last day fully before it and the
  // first day fully after it. Any other pairing is the caller's to make, and
  // `areComparable` is exported so it can check its own.
  const latestBefore = before.length ? before[before.length - 1] : null;
  const earliestAfter = after.length ? after[0] : null;
  const comparable = areComparable(latestBefore, earliestAfter);

  const status = statusOf(latestBefore, earliestAfter, comparable);

  const result = {
    status,
    // null when MEASURABLE; otherwise the contract's own refusal code, so a
    // caller reports the reason the code gave rather than one it invented.
    reason: status === OBSERVATION_STATUS.MEASURABLE ? null : (comparable.ok ? null : comparable.reason),
    boundary: boundary.toISOString(),
    entity: { workspaceId, entityId, entityLevel, source, measurementWindow: MEASUREMENT_WINDOW.DAILY },
    before,
    after,
    pair: { before: latestBefore, after: earliestAfter, comparable: comparable.ok, reason: comparable.ok ? null : comparable.reason },
    // The days inside the requested range that NOBODY observed. Named rather
    // than zero-filled: an absent row is not a measurement of nothing, and the
    // single most important thing this reader must never do is turn a gap into
    // a number. (§8 / I20's honesty rule.)
    notObserved: {
      before: missingDays(rangeStart, new Date(boundaryDay), before, boundary, 'before'),
      after: missingDays(new Date(boundaryDay), rangeEnd, after, boundary, 'after'),
    },
    excluded,
    // TWO COUNTS, R5's distinction kept: what the read CONSUMED versus what
    // survived reduction and contributed.
    rowCount: rows.length,
    // Row-level identity — the Tier 2 references R5 defined and left empty. A
    // measurement result must be able to name the exact observations it used,
    // and these are shaped to feed toEvidenceReference({ refs }) unchanged if a
    // writer ever needs to persist what was read. R9 persists nothing.
    refs: [...before, ...after].map((o) => ({
      id: o.id, entityId: o.entityId, source: o.source,
      observedAt: o.observedAt, windowStart: o.windowStart, windowEnd: o.windowEnd,
    })),
  };

  logger.debug(
    {
      workspaceId, entityId, entityLevel, source, status,
      rowCount: rows.length, before: before.length, after: after.length, excluded: excluded.length,
    },
    '[dailyObservations] read',
  );
  return result;
}

// ── pure helpers ──────────────────────────────────────────────────

/** The metric payload two same-instant rows must agree on to be one reading. */
const MEASURED_FIELDS = Object.freeze([
  'spendMinor', 'revenueMinor', 'impressions', 'clicks', 'conversions', 'ctr', 'roas', 'reach', 'frequency',
]);

/** PURE: do two rows report the same measurement? */
function sameMeasurement(a, b) {
  return MEASURED_FIELDS.every((k) => a[k] === b[k]);
}

/**
 * PURE: a raw row → the observation shape callers read.
 *
 * `date` is renamed to `observedAt` here and NOWHERE ELSE in the pipeline. The
 * column keeps its name in the database and in the query; the reader's output
 * says what it means, because "date" is the single most misread field in this
 * schema and a consumer of a daily observation must not have to remember which
 * of three timestamps it is.
 *
 * Metric values are passed through untouched — including nulls. A null ctr is
 * "this row measured no ratio", and coercing it to 0 would manufacture a
 * measurement the platform never made.
 */
function observationOf(day, row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    entityId: row.entityId,
    entityLevel: row.entityLevel,
    source: row.source,
    measurementWindow: row.measurementWindow,
    day,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    observedAt: row.date,
    spendMinor: row.spendMinor,
    revenueMinor: row.revenueMinor,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    ctr: row.ctr,
    roas: row.roas,
    // Exposed because they genuinely exist on the row, and excluded from every
    // difference by the comparability contract. Phase E lands them null; a value
    // here would be a real daily reach, which is still not comparable across days.
    reach: row.reach,
    frequency: row.frequency,
    currency: row.currency,
  };
}

/** PURE: ascending by logical day. */
const byDay = (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

/** PURE: the UTC midnight that opens the day containing `d`. */
function dayStart(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * PURE: which days in a span the platform did not report.
 *
 * Only days that fall ENTIRELY on the given side of the boundary are counted.
 * The day CONTAINING the boundary belongs to neither side, so listing it as
 * missing would send someone looking for a row that could never legitimately be
 * there — while a midnight boundary makes its own day cleanly `after`, and it is
 * listed if nothing reported it.
 *
 * A named absence, never a zero. The single most important thing this reader
 * must not do is turn a gap into a number.
 */
function missingDays(from, to, observations, boundary, side) {
  const have = new Set(observations.map((o) => o.day));
  const out = [];
  const last = side === 'before' ? to.getTime() : to.getTime() + DAY_MS;
  for (let t = from.getTime(); t + DAY_MS <= last; t += DAY_MS) {
    const wholeDayIsBefore = t + DAY_MS <= boundary.getTime();
    const wholeDayIsAfter = t >= boundary.getTime();
    if (side === 'before' ? !wholeDayIsBefore : !wholeDayIsAfter) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    if (!have.has(day)) out.push(day);
  }
  return out;
}

/** PURE: the four-state verdict, from what was found rather than from an error. */
function statusOf(before, after, comparable) {
  if (comparable.ok) return OBSERVATION_STATUS.MEASURABLE;
  if (before?.ambiguous || after?.ambiguous) return OBSERVATION_STATUS.AMBIGUOUS;
  if (!before || !after) return OBSERVATION_STATUS.NOT_OBSERVED;
  return OBSERVATION_STATUS.NOT_MEASURABLE;
}
