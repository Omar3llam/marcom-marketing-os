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

import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';

export const ACCOUNT_STATE = Object.freeze({
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  WATCH_CLOSELY:   'WATCH_CLOSELY',
  PERFORMING_WELL: 'PERFORMING_WELL',
  LEARNING:        'LEARNING',
  // The scoring substrate exists and is scored — this SEAT just may not read it.
  // GET /entities/health is gated to BUYER|STRATEGIST while /entities/campaigns
  // is ungated, so a CLIENT sees campaigns, receives health: null, and lands on
  // zero bands. Folding that into LEARNING told a CLIENT "no campaigns have
  // enough data to score yet" about an account that was fully scored — an
  // absence produced by AUTHORIZATION, reported as one produced by DATA.
  SCORING_HIDDEN:  'SCORING_HIDDEN',
  // B8-02 — the read FAILED. Indistinguishable from LEARNING by count, because
  // both see zero of everything; only the cause separates them, which is why
  // the cause has to be carried rather than inferred. Before this existed a
  // backend outage rendered "Connect a channel to get your first verdict" —
  // the page telling an operator their account was empty when Lumi simply
  // could not read it.
  UNREADABLE:      'UNREADABLE',
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
  scoringHidden = false,
  unreadable = false,
} = {}) {
  if (loading) return null;                        // don't flash a state

  // B8-02 — checked BEFORE `hasAnyData`, because a failed read produces zero of
  // everything and would otherwise be reported as an empty account. Checked
  // AFTER `loading` for the existing reason: a page that shows a failure for
  // 400ms before revealing three KILLs has told the user something false.
  //
  // It does NOT outrank a real verdict. A partial failure must not suppress
  // what was actually measured, so the band checks come first below — the same
  // ordering SCORING_HIDDEN already follows.
  if (!hasAnyData && unreadable) return ACCOUNT_STATE.UNREADABLE;

  if (!hasAnyData) return ACCOUNT_STATE.LEARNING;  // nothing to score yet

  if (actNowTotal > 0)  return ACCOUNT_STATE.ACTION_REQUIRED;
  if (watchTotal > 0)   return ACCOUNT_STATE.WATCH_CLOSELY;
  if (healthyCount > 0) return ACCOUNT_STATE.PERFORMING_WELL;

  // Zero bands, but this seat is not permitted to read the scoring substrate at
  // all. Checked AFTER the counts deliberately: it is not a claim about the
  // account, only about what this reader can see, so any real verdict that DID
  // come through still outranks it.
  if (scoringHidden) return ACCOUNT_STATE.SCORING_HIDDEN;

  // Data exists but the engine scored none of it — below the scoring floor, or
  // missing the signals a verdict needs. "Learning" is the honest word: it is
  // NOT a healthy account, and it is NOT an empty one.
  return ACCOUNT_STATE.LEARNING;
}

// ── Narrative ────────────────────────────────────────────────
// PURE. Returns an ARRAY of lines: [0] is the headline, the rest are subordinate.
// A line that cannot be backed by data is OMITTED, never rendered as a blank or
// a zero — so the caller must tolerate a 1-line array.
//
// What this deliberately never emits: a rate ("/wk", "/mo"), a saving ("saved",
// "recovered"), a delta, or a percentage. Wasted spend is a per-sync AGGREGATE
// over an unknown window ([[snapshot_spend_no_window]]), so dividing it into a
// weekly rate or calling it "saved" would invent a measurement nobody took.
// "at risk" is the strongest honest claim: the money is exposed, not recovered.

const isRealAmount = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * @param {object}  input
 * @param {string}  input.state          an ACCOUNT_STATE value
 * @param {number}  input.wastedAmount   MAJOR units (fromMinor applied upstream)
 *                                       — null when unmeasured
 * @param {string}  input.currency       kpis.currency (connector-derived), so the
 *                                       hero agrees with the KPI card below it
 * @param {boolean} input.hasAnyData     either substrate carries campaigns
 * @param {boolean} input.hasScorableData  the CONNECTOR substrate specifically —
 *                                       the only one the scoring engine reads
 * @returns {string[]} 0-2 lines, headline first
 */
export function buildHeroNarrative({
  state,
  actNowTotal = 0,
  watchTotal = 0,
  healthyCount = 0,
  wastedAmount = null,
  currency = null,
  workspaceName = null,
  hasAnyData = false,
  hasScorableData = false,
} = {}) {
  switch (state) {
    case ACCOUNT_STATE.ACTION_REQUIRED: {
      const decision = actNowTotal === 1
        ? '1 decision needs your attention.'
        : `${actNowTotal} decisions need your attention.`;

      // The money half arrives from a DIFFERENT hook than the counts
      // (useAccountHealth vs the band inputs), so it can be absent while the
      // headline is confident. It degrades on its own rather than blocking or
      // printing a placeholder.
      const money = isRealAmount(wastedAmount) && isKnownCurrency(currency)
        ? `${formatCurrencyWhole(wastedAmount, currency)} at risk.`
        : null;

      return [decision, money].filter(Boolean);
    }

    case ACCOUNT_STATE.WATCH_CLOSELY:
      return [
        watchTotal === 1
          ? '1 campaign needs monitoring.'
          : `${watchTotal} campaigns need monitoring.`,
        'No urgent actions today.',
      ];

    case ACCOUNT_STATE.PERFORMING_WELL:
      return [
        'Everything is running smoothly today.',
        healthyCount > 0
          ? `${healthyCount} campaign${healthyCount === 1 ? '' : 's'} performing well.`
          : null,
      ].filter(Boolean);

    case ACCOUNT_STATE.LEARNING:
      return [
        `Building confidence in ${workspaceName || 'this workspace'}.`,
        // LEARNING covers TWO different situations and they need opposite advice.
        // Telling someone who has already synced Meta to "connect a channel"
        // sends them to re-do a step they finished; their real blocker is that
        // nothing has enough signal to score yet.
        //
        // The branch is on hasScorableData, NOT hasAnyData — a premise fix. The
        // scoring engine reads the CONNECTOR graph only (/entities/health runs
        // over getConnectorCampaigns), so a workspace holding legacy
        // CampaignState rows and no connector campaigns will never be scored no
        // matter how long it waits. Branching on "either substrate" told that
        // workspace to sit tight for a verdict that cannot arrive; its real
        // blocker is the same one an empty account has.
        hasScorableData
          ? 'Your campaigns are syncing. Verdicts appear once enough signal has accumulated.'
          : 'Connect a channel to get your first verdict.',
      ];

    case ACCOUNT_STATE.SCORING_HIDDEN:
      return [
        `${workspaceName || 'This workspace'} is running.`,
        // NOT "nothing to score" and NOT "nothing needs attention" — neither is
        // known from here. The only true statement is about the seat.
        'Campaign-level verdicts aren’t shown for your access level.',
      ];

    // B8-02 — the read failed. Every line here is about LUMI's position, never
    // about the operator's account: we do not know whether they have campaigns,
    // so we say nothing about them. "Couldn't" not "no data", because the
    // second is a claim we cannot support.
    case ACCOUNT_STATE.UNREADABLE:
      return [
        'Lumi couldn’t read this account just now.',
        'This is a problem on our side, not a verdict about your campaigns.',
      ];

    default:
      return [];
  }
}

// Presentation only — the label, its signal colour, and the hero's border tint.
// Kept beside the state so a new state cannot be added without deciding how it
// reads. `heroBg` keeps the SAME surface for every state and varies only the
// border: a red-filled hero would shout on a routine day, and the eyebrow plus
// the headline already carry the urgency.
export const STATE_CONFIG = Object.freeze({
  [ACCOUNT_STATE.ACTION_REQUIRED]: {
    label: 'Needs your call',
    color: 'text-signal-kill',
    heroBg: 'bg-lumi-surface border-signal-kill/20',
  },
  [ACCOUNT_STATE.WATCH_CLOSELY]: {
    label: 'Keep watching',
    color: 'text-signal-watch',
    heroBg: 'bg-lumi-surface border-signal-watch/20',
  },
  [ACCOUNT_STATE.PERFORMING_WELL]: {
    label: 'Running smoothly',
    color: 'text-signal-scale',
    heroBg: 'bg-lumi-surface border-signal-scale/20',
  },
  [ACCOUNT_STATE.LEARNING]: {
    label: 'Building confidence',
    color: 'text-lumi-muted',
    heroBg: 'bg-lumi-surface border-lumi-border',
  },
  [ACCOUNT_STATE.SCORING_HIDDEN]: {
    label: 'Portfolio view',
    color: 'text-lumi-muted',
    heroBg: 'bg-lumi-surface border-lumi-border',
  },
  // B8-02 — its OWN entry, not LEARNING's. The hero falls back to whatever this
  // map lacks, so an absent entry here would have re-rendered a failed read as
  // "still learning about your account" one layer below the fix. Same shape as
  // C-16, where publishing `severity: null` was not enough because the router
  // re-invented MEDIUM underneath it.
  //
  // Toned as a WARNING, not a danger: nothing is known to be wrong with the
  // account, only with our reading of it.
  [ACCOUNT_STATE.UNREADABLE]: {
    label: 'Not reachable',
    color: 'text-signal-hold',
    heroBg: 'bg-lumi-surface border-signal-hold/30',
  },
});

// ── Why the feed is empty lives in the HERO, not beside it ───
// All three bands are empty if and only if the state is LEARNING or
// SCORING_HIDDEN, and each of those narratives already names its own cause:
//
//   · this seat cannot read the scoring substrate  → SCORING_HIDDEN
//   · no connector channel exists to score         → LEARNING, !hasScorableData
//   · connector data exists, the engine scored none → LEARNING, hasScorableData
//
// The page used to print one sentence — "No scored campaigns right now." — for
// all three, which was true of only the last. A second notice under the hero
// would now repeat the line directly above it, so there isn't one.
