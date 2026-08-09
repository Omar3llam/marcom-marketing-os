// ============================================================
// memoryTimelineViewModel — what we said before, and how it turned out
// ============================================================
// PRESENTATION MAPPING ONLY. No sorting (the service ordered these), no
// counting (the service counted them), no inference of any kind.
//
// ── THE ONE THING THIS MUST NEVER DO ────────────────────────────────────────
// Call a decision "successful" because it was executed. Execution means an
// operator said they acted on it — nothing at all about whether it worked. The
// engine's own per-decision outcome is `resolution`, written when a later
// verdict superseded this one, and it says IMPROVED / UNCHANGED / WORSENED /
// UNKNOWN. That is a statement about how the entity MOVED, which is as far as
// the data goes. "Success" is a different claim the accuracy engine makes over
// a population with an outcome snapshot behind it, and it is not available per
// row — so it is not made here.
//
// null resolution → "Outcome not recorded". UNKNOWN → "Outcome unclear": the
// schema calls UNKNOWN "a real answer, not a gap-filler" (a decision with no
// metrics on either end honestly resolves to it), and collapsing the two would
// turn "we looked and could not tell" into "we never looked".
// ============================================================

/** The engine's resolution enum → what a marketer can read. */
const RESOLUTION_LABELS = Object.freeze({
  IMPROVED:  'Improved after',
  UNCHANGED: 'No material change',
  WORSENED:  'Worsened after',
  UNKNOWN:   'Outcome unclear',
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * PURE: an ISO timestamp → "8 Aug". Formatted HERE so the renderer stays
 * vocabulary-free, and hand-rolled rather than toLocaleDateString so the output
 * does not change with the machine's locale — a date that reads differently in
 * CI than on screen is a test that lies.
 * null for anything unparseable: no date beats a wrong one.
 */
function shortDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** What a human did about it. Timestamps, not status — see the schema note. */
function actionLabel(item) {
  if (item?.executedAt) return 'Executed';
  if (item?.dismissedAt) return 'Dismissed';
  if (item?.status === 'SUPERSEDED') return 'Replaced by a later call';
  return 'No answer recorded';
}

/**
 * PURE: the service's history bucket → the timeline view model, or null.
 *
 * @param {{count:number, items:Array}|null|undefined} memory
 * @returns {{count:number, items:Array}|null} null when there is no history to
 *   show — which the renderer turns into nothing at all, not into "Seen 0
 *   times". A campaign we have never judged has no memory, and saying "0" about
 *   it implies we looked and found none.
 */
export function buildMemoryTimelineViewModel(memory) {
  if (!memory || typeof memory !== 'object') return null;

  const items = Array.isArray(memory.items) ? memory.items : [];
  // A count with no rows behind it is not a number worth printing.
  if (items.length === 0) return null;

  return {
    // The service's TRUE total, which can exceed items.length — the list is
    // bounded, the count is not. Falling back to items.length would under-report
    // exactly the campaigns with the longest history.
    count: Number.isFinite(memory.count) ? memory.count : items.length,
    items: items.map((it, i) => ({
      key:     it?.id ?? `memory-${i}`,
      verdict: it?.verdict ?? 'Unknown',
      action:  actionLabel(it),
      at:      shortDate(it?.createdAt),
      // Absent, not invented. `null` and 'UNKNOWN' are different answers.
      outcome: it?.resolution ? (RESOLUTION_LABELS[it.resolution] ?? it.resolution) : null,
    })),
  };
}
