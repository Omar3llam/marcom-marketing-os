// ============================================================
// MARCOM / Lumi — Account state (Home · what does this account need RIGHT NOW?)
// ------------------------------------------------------------
// One question, one answer. The Home page used to make the user derive it by
// scanning twelve stacked blocks; this collapses the same inputs into a single
// state the hero can lead with.
//
// PURE — no React, no hooks, no fetching. Every input is already computed by
// partitionDecisions (actNowTotal / watchTotal / healthyCount) or by the
// two-substrate data check (hasAnyData). Nothing here reads the network, so the
// state can never disagree with the sections rendered under it.
//
// The order of the checks IS the product decision: a KILL outranks a WATCH
// outranks a healthy account. An account with both a KILL and twelve healthy
// campaigns is an account that needs a call — leading with "running smoothly"
// would be true about the majority and wrong about the money.
// ============================================================

export const ACCOUNT_STATE = Object.freeze({
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  WATCH_CLOSELY:   'WATCH_CLOSELY',
  PERFORMING_WELL: 'PERFORMING_WELL',
  LEARNING:        'LEARNING',
});

/**
 * PURE: what does the user need to do right now?
 *
 * Returns `null` while loading — deliberately, and NOT a LEARNING placeholder.
 * A page that flashes "Building confidence in this workspace" for 400ms before
 * revealing three KILLs has told the user something false, and the correction
 * arrives after they have already started reading.
 *
 * `hasAnyData` is checked BEFORE the counts: an un-synced workspace has zero of
 * everything, and "0 decisions" from an empty account is not the same claim as
 * "0 decisions" from a scored one.
 *
 * @param {object}  input
 * @param {number}  input.actNowTotal   TRUE count of KILL/REALLOCATE (pre-cap)
 * @param {number}  input.watchTotal    TRUE count of WATCH/REFRESH (pre-cap)
 * @param {number}  input.healthyCount  count of HOLD/SCALE
 * @param {boolean} input.hasAnyData    either substrate carries campaigns
 * @param {boolean} [input.loading]     still fetching → null
 * @returns {string|null} an ACCOUNT_STATE value, or null while loading
 */
export function getAccountState({
  actNowTotal = 0,
  watchTotal = 0,
  healthyCount = 0,
  hasAnyData = false,
  loading = false,
} = {}) {
  if (loading) return null;                        // don't flash a state
  if (!hasAnyData) return ACCOUNT_STATE.LEARNING;  // nothing to score yet

  if (actNowTotal > 0)  return ACCOUNT_STATE.ACTION_REQUIRED;
  if (watchTotal > 0)   return ACCOUNT_STATE.WATCH_CLOSELY;
  if (healthyCount > 0) return ACCOUNT_STATE.PERFORMING_WELL;

  // Data exists but the engine scored none of it — below the scoring floor, or
  // missing the signals a verdict needs. "Learning" is the honest word: it is
  // NOT a healthy account, and it is NOT an empty one.
  return ACCOUNT_STATE.LEARNING;
}

// Presentation only — the label and its signal colour. Kept beside the state so
// a new state cannot be added without deciding how it reads.
export const STATE_CONFIG = Object.freeze({
  [ACCOUNT_STATE.ACTION_REQUIRED]: { label: 'Needs your call',     color: 'text-signal-kill'  },
  [ACCOUNT_STATE.WATCH_CLOSELY]:   { label: 'Keep watching',       color: 'text-signal-watch' },
  [ACCOUNT_STATE.PERFORMING_WELL]: { label: 'Running smoothly',    color: 'text-signal-scale' },
  [ACCOUNT_STATE.LEARNING]:        { label: 'Building confidence', color: 'text-lumi-muted'   },
});
