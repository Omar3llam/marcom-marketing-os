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
});

// k-anonymity: never surface a cohort insight unless at least this many
// DISTINCT consenting workspaces contribute to it.
export const DEFAULT_K = Number(process.env.NETWORK_MIN_WORKSPACES || 5);

// Minimum total recency-weighted support behind a cohort insight.
export const DEFAULT_MIN_SUPPORT = Number(process.env.NETWORK_MIN_SUPPORT || 5);
