// ============================================================
// MARCOM / Lumi — overviewPlan (Home · what shows, in what order)
// ------------------------------------------------------------
// PURE. Takes the account's state and returns an ORDERED list of slot ids for
// each region. The page renders the plan; it does not decide it.
//
// Why this is a table and not a stack of `&&`s. The ordering IS the product
// decision — the same argument overviewState.js makes for the state precedence
// (a KILL outranks a WATCH outranks a healthy account). Expressed as a table it
// is reviewable in one screen and testable without a DOM; expressed as twelve
// inline conditions it was neither, and every new block had to guess where it
// belonged.
//
// ── The rule that keeps this honest ──────────────────────────
// A state may REORDER and DEFER, never DELETE. Everything not in `main` for a
// given state appears in `deferred`, which renders below the fold — so no state
// can make content unreachable. The only exceptions are slots that would be
// FALSE or empty in that state (a KPI strip of four "—" on an unscored account),
// and those are omitted because they say nothing, not to hide them.
//
// Authorisation is NOT here. The plan orders; each component keeps its own role
// gate. A plan that granted visibility would put two systems in charge of it.
// ============================================================

export const SLOT = Object.freeze({
  HERO:            'hero',
  ACT_NOW:         'actNow',
  WATCH:           'watch',
  DOING_WELL:      'doingWell',
  REVENUE_NOTICES: 'revenueNotices',
  PACING:          'pacing',
  KPIS:            'kpis',
  AGENDA:          'agenda',
  COPILOT:         'copilot',
  // rail
  CHANNELS:        'channels',
  CALIBRATION:     'calibration',
});

// The one place the per-state order lives. Read it top to bottom as "what this
// account should be looking at, most important first".
//
// ACTION_REQUIRED / WATCH_CLOSELY — money is at stake, so the numbers wait.
// PERFORMING_WELL — nothing to decide, so "how is it going" becomes the real
//   question and the KPI strip earns its place above the fold.
// LEARNING / SCORING_HIDDEN — no decisions exist to rank, so the page leads with
//   why, then falls through to the same supporting detail as everyone else.
const MAIN_BY_STATE = Object.freeze({
  ACTION_REQUIRED: [SLOT.HERO, SLOT.ACT_NOW, SLOT.WATCH, SLOT.DOING_WELL, SLOT.REVENUE_NOTICES],
  WATCH_CLOSELY:   [SLOT.HERO, SLOT.WATCH, SLOT.DOING_WELL, SLOT.REVENUE_NOTICES],
  PERFORMING_WELL: [SLOT.HERO, SLOT.DOING_WELL, SLOT.REVENUE_NOTICES, SLOT.PACING, SLOT.KPIS],
  LEARNING:        [SLOT.HERO],
  SCORING_HIDDEN:  [SLOT.HERO, SLOT.PACING, SLOT.KPIS],
  UNREADABLE:      [SLOT.HERO],
});

// There is no separate "why is the feed empty" slot. All three bands are empty
// if and only if the state is LEARNING or SCORING_HIDDEN, and BOTH of those
// heroes now name the cause in their own second line. A standalone notice would
// restate the sentence directly above it — which is the duplication this plan
// exists to remove, not a new place to put copy.

// Everything that is not in `main` for a state, in a fixed order. Deferred means
// "below the decisions", not "gone".
const DEFERRABLE = Object.freeze([
  SLOT.REVENUE_NOTICES, SLOT.PACING, SLOT.KPIS, SLOT.AGENDA, SLOT.COPILOT,
]);

// NOTE — there is deliberately no per-state omission list.
//
// The first draft dropped the KPI strip, pacing, agenda and briefing on
// LEARNING, on the reasoning that four "—" cards are furniture. That premise was
// simply WRONG: LEARNING means the verdict engine scored nothing, not that there
// is no data. A connector-only account with campaigns has real spend and real
// CPA; only wasted-spend and the health score are null. The agenda and briefing
// read a DIFFERENT substrate again (useHome) and can be full while health is
// empty. Omitting them would have hidden real numbers behind a state that says
// nothing about them.
//
// "Nothing to show" is a question about DATA, and every slot below already
// answers it by returning null. The plan's job is order, not suppression.

/**
 * PURE: the ordered slots for one render.
 *
 * @param {object} input
 * @param {string|null} input.accountState  an ACCOUNT_STATE, or null while loading
 * @param {boolean} input.hasAnyData        either substrate carries campaigns
 * @param {boolean} input.showCopilot       role-derived (CLIENT home stays minimal)
 * @param {string|null} input.interrupt     the one interrupt to show, if any
 * @returns {{interrupt: string|null, main: string[], rail: string[], deferred: string[]}}
 */
export function buildSurfacePlan({
  accountState = null,
  hasAnyData = false,
  showCopilot = true,
  interrupt = null,
} = {}) {
  // Still loading (accountState null): only the STATE-DEPENDENT claims are
  // withheld — the hero returns null for a null state and no band can be ranked
  // yet. Everything else still renders, because it is answering a different
  // question. Blanking the whole page while one fetch lands would be a worse lie
  // than the one the readiness gate was built to stop.
  const main = accountState
    ? (MAIN_BY_STATE[accountState] ?? MAIN_BY_STATE.LEARNING)
    : [SLOT.HERO];

  // Deferred = everything deferrable this state did not promote. Derived, not
  // hand-listed, so a new slot cannot be silently lost: add it to DEFERRABLE and
  // it appears below the fold until some state promotes it.
  const deferred = DEFERRABLE
    .filter((s) => !main.includes(s))
    .filter((s) => (s === SLOT.COPILOT ? showCopilot : true))
    // The agenda and briefing need a substrate to describe.
    .filter((s) => (s === SLOT.AGENDA ? hasAnyData : true));

  return { interrupt, main, rail: RAIL, deferred };
}

// The rail answers "why does the page say what it says", and it does NOT vary by
// state. Calibration counts outcomes over the workspace's whole history, so it
// is not a claim about the account's condition today — dropping it on a LEARNING
// account would hide a real number on the grounds that a DIFFERENT number is
// small. It already renders nothing when its surface is absent; that is the
// right place for "nothing to say", at the data, not at the state.
//
// Loop status is deliberately absent: it lives in exactly one place now (the
// full ring in the agenda, which carries the stage strip, the backend summary,
// the stalled nudge and the sweep trigger that the rail's read-only variant
// could never show).
const RAIL = Object.freeze([SLOT.CHANNELS, SLOT.CALIBRATION]);
