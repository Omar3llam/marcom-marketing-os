// ============================================================
// MARCOM / Lumi — verdictRank (pure leaf)
// ------------------------------------------------------------
// THE one urgency ordering for the six engine verdicts
// (verdict-engine/verdictTypes.js). Worst/most-actionable first, good news
// last, so "sort by Decision" means "what should I deal with now".
//
// ── Why this is its own module ──────────────────────────────────────────────
// It lived twice: `CampaignsView.jsx` (the on-screen table) and `pdfExport.js`
// (the exported report) each declared their own copy, and the copies had
// DRIFTED — REFRESH and REALLOCATE were swapped, so sorting the table by
// urgency and then exporting it produced a different order for the same rows.
// pdfExport's copy carried the comment "Urgency rank mirrors
// CampaignsView.VERDICT_RANK", which was false at the time it was read.
//
// The obvious repair — have pdfExport import from CampaignsView — closes an
// import CYCLE: CampaignsView already imports generateCampaignReport FROM
// pdfExport. A cycle over a top-level `const` is a TDZ ReferenceError at module
// load, which tests pass straight through and the page dies on. Same failure
// decisionIdentity.js was extracted to avoid on the server.
//
// It lives in lib/ rather than beside campaignGrouping.js because NO module in
// lib/ imports from features/ — that direction does not exist in this codebase,
// and pdfExport is in lib/. A leaf both layers already point at has no such edge.
//
// EXHAUSTIVE over the verdict enum. An unknown verdict is deliberately absent
// rather than mapped to a middle rank: callers coalesce it (`?? 99`) so it sinks
// like a null metric, which is the honest position for "we could not score this".
// ============================================================

export const VERDICT_RANK = Object.freeze({
  KILL:       0,
  REFRESH:    1,
  REALLOCATE: 2,
  WATCH:      3,
  HOLD:       4,
  SCALE:      5,
});

/**
 * The verdicts in canonical urgency order, DERIVED from the ranking rather than
 * re-listed. A test that types the order out by hand proves only that two
 * literals agree today; one built from this proves there is a single source.
 */
export const VERDICT_URGENCY_ORDER = Object.freeze(
  Object.keys(VERDICT_RANK).sort((a, b) => VERDICT_RANK[a] - VERDICT_RANK[b]),
);
