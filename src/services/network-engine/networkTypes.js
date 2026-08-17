// ============================================================
// Network Engine — stable vocabulary
// ============================================================
// The cross-account layer is gated by construction. These are the only
// states it can report. No dynamic labels.
// ============================================================

export const NETWORK_STATUS = Object.freeze({
  OK:                'OK',                // enough consenting workspaces → a banded insight
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA', // below k-anonymity / support → suppressed (honest)
  NOT_CONSENTED:     'NOT_CONSENTED',     // this workspace hasn't opted in
  // R10 (F4) — WE COULD NOT ESTABLISH THE ANSWER. Distinct from NOT_CONSENTED,
  // which is a governance FACT about the workspace, and from INSUFFICIENT_DATA,
  // which is a real finding about the cohort. The briefing route used to report
  // a failed read as NOT_CONSENTED, telling a workspace that HAD opted in that
  // it had not — a fabricated consent state, produced by a database blip.
  //
  // The three must stay separate because only one of them is the user's to act
  // on: NOT_CONSENTED has a button, INSUFFICIENT_DATA needs more peers, and this
  // one needs us to fix something.
  UNAVAILABLE:       'UNAVAILABLE',
});

// k-anonymity: never surface a cohort insight unless at least this many
// DISTINCT consenting workspaces contribute to it.
export const DEFAULT_K = Number(process.env.NETWORK_MIN_WORKSPACES || 5);

// Minimum total recency-weighted support behind a cohort insight.
export const DEFAULT_MIN_SUPPORT = Number(process.env.NETWORK_MIN_SUPPORT || 5);
