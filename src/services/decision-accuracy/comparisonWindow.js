// ============================================================
// comparisonWindow — WHICH periods an outcome review compares
// ============================================================
// B5-01X measured that this definition did not exist. Three constants were
// being mistaken for it and none of them was one:
//
//   DEFAULT_SPAN_DAYS = 7   a READ SPAN — how many days to fetch. Its only
//                           caller already overrides it asymmetrically
//                           (e7-production-proof: beforeDays 7, afterDays 1),
//                           which is the proof it was never a policy.
//   maturationDays = 7      a MATURITY AGE — when a decision becomes eligible
//                           for review. A different question entirely.
//   the reader's `pair`     latestBefore / earliestAfter — ONE day vs ONE day.
//                           Measured on 7 clean days against 7 killed days it
//                           returned -50000, not the -350000 the operator
//                           would read as "the week after the kill".
//
// THIS MODULE IS THE POLICY, AND IT OWNS ITS OWN CONSTANT.
// `COMPARISON_WINDOW_DAYS` is deliberately NOT `maturationDays`, and must not
// be collapsed into it merely because both currently read 7. They answer
// different questions and will move independently the first time either is
// tuned; a shared constant would make one change silently rewrite the other.
//
// PURE. No DB, no clock, no workspace context. Given one instant it returns the
// two day-sets a comparison may use, and nothing else.
//
// THE INTERVENTION DAY BELONGS TO NEITHER WINDOW
// ----------------------------------------------
// It is partly pre-change and partly post-change, so counting it would put the
// same delivery on both sides of the comparison. Excluding it also makes the
// policy a function of the intervention DATE alone rather than its time of day
// — otherwise acting at 23:59 and acting at 00:01 the next morning would
// produce comparisons a whole day apart, which is a property of the clock
// rather than of the campaign.
//
// THE CALENDAR IS UTC, AND THAT IS INHERITED, NOT INVENTED
// --------------------------------------------------------
// metaDailyNormalize.toUtcDay maps Meta's declared `date_start` label onto a
// UTC midnight Date, and every temporal decision in dailyObservationReader
// (`dayStart`, `logicalDay`) reads that same grid. So a "day" here is the
// platform's own declared day as the repository already stores it. Nothing in
// this module converts a timezone, because nothing in this module is allowed to
// decide one.
// ============================================================

const DAY_MS = 86_400_000;

/**
 * How many whole days each side of the intervention a comparison covers.
 *
 * NOT `DEFAULT_CONFIG.maturationDays`. See the header — the numbers agree today
 * and the concepts do not.
 */
export const COMPARISON_WINDOW_DAYS = 7;

/** PURE: the UTC midnight that opens the day containing `instant`, in ms. */
export function utcDayStart(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** PURE: a UTC-midnight ms value → the `YYYY-MM-DD` key the reader keys days by. */
export function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * PURE: `n` consecutive day keys starting at `startMs`, ascending.
 * Listed rather than expressed as a range because coverage is answered by
 * asking which of these EXACT days was observed — a range cannot say which one
 * is missing, and a missing day is the thing an operator most needs named.
 */
function daysFrom(startMs, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(dayKey(startMs + i * DAY_MS));
  return out;
}

/**
 * THE POLICY. One intervention instant → the two windows a review compares.
 *
 *   intervention 2026-08-10 (at any time of day)
 *     baseline     2026-08-03 … 2026-08-09     the 7 whole days ENDING the day
 *                                              before the intervention day
 *     observation  2026-08-11 … 2026-08-17     the 7 whole days STARTING the
 *                                              day after it
 *     2026-08-10 itself belongs to neither.
 *
 * `readerSpan` is what `readDailyObservations` must be asked for so that both
 * windows fall inside the rows it returns — derived here rather than at the call
 * site, because a span that is one day short would not fail: it would silently
 * return a window whose last day is permanently missing.
 *
 * @param {Date|string|number} interventionAt
 * @returns {{interventionDay:string, baseline:object, observation:object, readerSpan:object}|null}
 *   null when the instant is unusable — the caller decides what that means, since
 *   "we cannot place this decision in time" is not a fact about the account.
 */
export function comparisonWindows(interventionAt) {
  const dayMs = utcDayStart(interventionAt);
  if (dayMs == null) return null;

  const baselineStart = dayMs - COMPARISON_WINDOW_DAYS * DAY_MS;
  const observationStart = dayMs + DAY_MS;

  const baselineDays = daysFrom(baselineStart, COMPARISON_WINDOW_DAYS);
  const observationDays = daysFrom(observationStart, COMPARISON_WINDOW_DAYS);

  return {
    interventionDay: dayKey(dayMs),
    baseline: {
      days: baselineDays,
      windowStart: new Date(baselineStart).toISOString(),
      // The last day's own midnight, matching how the repository states periods:
      // inclusive at both ends, windowStart === windowEnd on a one-day row.
      windowEnd: new Date(dayMs - DAY_MS).toISOString(),
    },
    observation: {
      days: observationDays,
      windowStart: new Date(observationStart).toISOString(),
      windowEnd: new Date(dayMs + COMPARISON_WINDOW_DAYS * DAY_MS).toISOString(),
    },
    // beforeDays reaches back to the first baseline day; afterDays reaches
    // forward to the last observation day. The reader bounds `windowStart`
    // inclusively at both ends, so these are exact rather than generous.
    readerSpan: { beforeDays: COMPARISON_WINDOW_DAYS, afterDays: COMPARISON_WINDOW_DAYS },
  };
}
