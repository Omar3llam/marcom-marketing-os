// ============================================================
// MARCOM / Lumi — overviewInterrupts (Home · at most ONE nudge)
// ------------------------------------------------------------
// PURE, ordered, first match wins. Three mutually-exclusive onboarding blocks
// used to be sequenced by hand across four inline booleans, two sessionStorage
// keys, a role gate and a `!firstRun` tiebreak spread over thirty lines of the
// page — so adding a fourth meant editing four conditions and hoping.
//
// The precedence is now readable top to bottom, and the exclusivity is
// structural: this returns ONE id or null, so two nudges cannot both render.
//
// Dismissal is NOT decided here — the caller passes the set of already-dismissed
// ids (useDismissals owns the storage). Keeping that out makes every rule below
// a pure function of the account, testable without a browser.
// ============================================================

export const INTERRUPT = Object.freeze({
  FIRST_RUN: 'firstRun',   // brand-new account, straight out of onboarding
  REVENUE:   'revenue',    // synced + scored, but no revenue tracked yet
  CONNECT:   'connect',    // returning user, still nothing connected
});

// Order IS the precedence. FIRST_RUN outranks CONNECT because they ask for the
// same thing and the stepped version is the better of the two; REVENUE sits
// between them because it only fires once a channel is already in.
const RULES = [
  {
    id: INTERRUPT.FIRST_RUN,
    when: (c) => c.firstRunFlag && !c.hasAnyData,
  },
  {
    id: INTERRUPT.REVENUE,
    // STRATEGIST-only: the revenue upload endpoint (and RevenueCsvTab) enforce
    // that role, so any other seat would dead-end on the CTA.
    // hasConnectorData is required so the banner's "scored N campaigns" line
    // stays honest.
    //
    // `!firstRunFlag` is NOT redundant with the ordering above: FIRST_RUN only
    // fires when !hasAnyData, so without this an account that is mid-first-run
    // AND already has connector data would show the revenue ask one render
    // earlier than it does today (the flag is retired by an effect, not during
    // render). Carried over verbatim to keep this refactor behaviour-neutral.
    when: (c) => c.isStrategist && c.hasEverSynced && c.hasConnectorData
              && !c.hasRevenueData && !c.firstRunFlag,
  },
  {
    id: INTERRUPT.CONNECT,
    // B8-02 — `unreadable` excluded, because this interrupt is an instruction,
    // not a description: it tells the operator to go connect a channel. On a
    // failed read we do not know whether they have one, so the instruction may
    // be both wrong and impossible to act on — and it would sit under a hero
    // that just said we could not read the account. The hero states the
    // failure; nothing beside it should give onboarding advice about an
    // account nobody has read.
    when: (c) => !c.hasAnyData && !c.unreadable,
  },
];

/**
 * PURE: which single interrupt should show, if any.
 *
 * Returns null while loading — an interrupt is a claim about the account's
 * setup, and claiming one before the substrates land is the same false-absence
 * bug the readiness gate exists to prevent.
 *
 * @param {object} ctx
 * @param {boolean} ctx.loading
 * @param {boolean} ctx.firstRunFlag     onboarding's sessionStorage marker
 * @param {boolean} ctx.hasAnyData       either substrate carries campaigns
 * @param {boolean} ctx.hasConnectorData connector graph specifically
 * @param {boolean} ctx.hasEverSynced    any channel reports a lastSyncedAt
 * @param {boolean} ctx.hasRevenueData   any connector campaign reports revenue
 * @param {boolean} ctx.isStrategist
 * @param {Set<string>} [ctx.dismissed]  ids already dismissed this session
 * @returns {string|null} an INTERRUPT id, or null
 */
export function pickInterrupt(ctx = {}) {
  if (ctx.loading) return null;
  const dismissed = ctx.dismissed ?? new Set();
  return RULES.find((r) => r.when(ctx) && !dismissed.has(r.id))?.id ?? null;
}
