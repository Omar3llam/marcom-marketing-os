// ============================================================
// MARCOM / Lumi — row integrity  (Tier 2b)
// ------------------------------------------------------------
// RULING (Omar): **an unreadable row is never equivalent to an absent row.**
//
//     VALID                 → render normally
//     INVALID / UNREADABLE  → preserve its existence, surface the state
//     NEVER                 → silently remove it from the collection
//
// Four hooks used to do the removal, each with a comment calling it resilience:
// "keep only contract-valid rows", "a row that fails the contract is dropped
// rather than rendered as junk". The cost is not junk on screen — it is a list
// that is SHORTER than the truth while claiming to be complete, and, when every
// row fails, an empty state asserting there is nothing there.
//
// That reading is now legacy. The direction that stands is the one
// `campaignGrouping.js` already states for verdicts: *"so a new verdict can
// never silently disappear."*
//
// ── WHY TWO OUTPUTS AND NOT ONE ─────────────────────────────────────────────
// `entries` is POSITIONAL and holds every row, so a surface can draw the gap
// where a row could not be read — the ruled shape, A / UNREADABLE / C.
//
// `readable` is the collection as it was, unchanged in element type, for
// everything that counts, sorts, filters or computes. Feeding a marker into
// those would trade a false ABSENCE for a false PRESENCE, and a marker counted
// as an experiment or a goal is the worse of the two.
// ============================================================

/** What we were able to establish about one row of a collection. */
export const ROW = Object.freeze({
  /** Parsed against the contract. `value` is the parsed row. */
  READABLE: 'READABLE',
  /** It arrived and we could not read it. It EXISTS; `value` is null. */
  UNREADABLE: 'UNREADABLE',
});

/**
 * Read a wire collection row by row.
 *
 * @param {{safeParse: Function}} schema  the row contract
 * @param {unknown} rows                  what arrived on the wire
 * @returns {{ok: boolean, entries: Array, readable: Array, unreadableCount: number}}
 *   `ok` is false when the collection itself was not an array — a missing or
 *   renamed collection is not an empty one, and the caller raises the error
 *   because only the caller knows what the collection was called.
 */
export function readRows(schema, rows) {
  if (!Array.isArray(rows)) {
    return { ok: false, entries: [], readable: [], unreadableCount: 0 };
  }

  const entries = rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    // No partial row. A row that failed the contract has no trustworthy field
    // in it — carrying one through would let a surface render half a belief.
    return parsed.success
      ? { state: ROW.READABLE, index, value: parsed.data }
      : { state: ROW.UNREADABLE, index, value: null };
  });

  const readable = entries.filter((e) => e.state === ROW.READABLE).map((e) => e.value);
  return { ok: true, entries, readable, unreadableCount: entries.length - readable.length };
}
