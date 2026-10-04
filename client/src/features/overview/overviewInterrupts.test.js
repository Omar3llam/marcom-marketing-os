// ============================================================
// overviewInterrupts — at most ONE nudge, and the precedence is readable
// ------------------------------------------------------------
// Three mutually-exclusive onboarding blocks used to be sequenced by four inline
// booleans, two sessionStorage keys, a role gate and a `!firstRun` tiebreak
// spread across thirty lines of the page. The exclusivity is now structural —
// this returns one id or null — so these pin the ORDER and the conditions.
// ============================================================
import { describe, it, expect } from 'vitest';
import { pickInterrupt, INTERRUPT } from './overviewInterrupts.js';

const ctx = (over = {}) => ({
  loading: false,
  firstRunFlag: false,
  hasAnyData: false,
  canSuggestConnect: true,
  hasConnectorData: false,
  hasEverSynced: false,
  hasRevenueData: false,
  isStrategist: true,
  dismissed: new Set(),
  ...over,
});

const SYNCED_NO_REVENUE = {
  hasAnyData: true, hasConnectorData: true, hasEverSynced: true, hasRevenueData: false,
};

describe('at most one', () => {
  it.each([
    ['FIRST_RUN unreadable', { firstRunFlag: true, hasAnyData: false, unreadable: true, canSuggestConnect: true }],
    ['FIRST_RUN connected', { firstRunFlag: true, hasAnyData: false, hasConnectedChannel: true, canSuggestConnect: false }],
    ['FIRST_RUN workspace absent', { firstRunFlag: true, hasAnyData: false, canSuggestConnect: false }],
    ['CONNECT connected', { hasAnyData: false, hasConnectedChannel: true, canSuggestConnect: false }],
    ['CONNECT unknown cause', { hasAnyData: false, canSuggestConnect: false }],
    ['CONNECT unreadable', { hasAnyData: false, unreadable: true, canSuggestConnect: true }],
    ['missing authority', { hasAnyData: false }],
  ])('P7-05C %s cannot produce a connect instruction', (_, input) => {
    expect(pickInterrupt(input)).toBeNull();
  });
  it('P7-05C missing context is not confirmed connector absence', () => {
    expect(pickInterrupt()).toBeNull();
  });
  it.each([false, true])('P7-05C explicit connect authority retains positive control, firstRun=%s', (firstRunFlag) => {
    expect(pickInterrupt({ hasAnyData: false, firstRunFlag, canSuggestConnect: true })).toBe(firstRunFlag ? INTERRUPT.FIRST_RUN : INTERRUPT.CONNECT);
  });
  it('a brand-new account gets the stepped banner, not the generic empty state', () => {
    expect(pickInterrupt(ctx({ firstRunFlag: true }))).toBe(INTERRUPT.FIRST_RUN);
  });

  it('a returning un-synced user gets the generic empty state', () => {
    expect(pickInterrupt(ctx())).toBe(INTERRUPT.CONNECT);
  });

  it('a synced account with revenue already tracked gets nothing', () => {
    expect(pickInterrupt(ctx({ ...SYNCED_NO_REVENUE, hasRevenueData: true }))).toBeNull();
  });
});

describe('precedence', () => {
  // FIRST_RUN and CONNECT ask for the same thing; the stepped one is better.
  it('FIRST_RUN outranks CONNECT when both would fire', () => {
    expect(pickInterrupt(ctx({ firstRunFlag: true, hasAnyData: false }))).toBe(INTERRUPT.FIRST_RUN);
  });

  // Carried over verbatim from the inline `!firstRun` tiebreak: the flag is
  // retired by an effect, not during render, so without this the revenue ask
  // would appear one render earlier than it does today.
  it('the revenue ask defers while the first-run flag is still set', () => {
    expect(pickInterrupt(ctx({ ...SYNCED_NO_REVENUE, firstRunFlag: true }))).toBeNull();
  });

  it('and fires once the flag is gone', () => {
    expect(pickInterrupt(ctx(SYNCED_NO_REVENUE))).toBe(INTERRUPT.REVENUE);
  });
});

describe('the revenue ask needs every one of its conditions', () => {
  it.each([
    ['a non-strategist seat could not complete the CTA', { isStrategist: false }],
    ['no channel has ever synced',                       { hasEverSynced: false }],
    ['no connector campaigns to count honestly',         { hasConnectorData: false }],
    ['revenue is already tracked',                       { hasRevenueData: true }],
  ])('withheld when %s', (_label, over) => {
    expect(pickInterrupt(ctx({ ...SYNCED_NO_REVENUE, ...over }))).not.toBe(INTERRUPT.REVENUE);
  });
});

describe('dismissal', () => {
  it('a dismissed nudge does not come back', () => {
    const dismissed = new Set([INTERRUPT.REVENUE]);
    expect(pickInterrupt(ctx({ ...SYNCED_NO_REVENUE, dismissed }))).toBeNull();
  });

  // Dismissing the top-ranked one must not silently promote a lower one that is
  // asking for the same action.
  it('dismissing FIRST_RUN falls through to CONNECT, not to nothing', () => {
    const dismissed = new Set([INTERRUPT.FIRST_RUN]);
    expect(pickInterrupt(ctx({ firstRunFlag: true, dismissed }))).toBe(INTERRUPT.CONNECT);
  });
});

describe('readiness', () => {
  // An interrupt is a claim about the account's setup. Claiming one before the
  // substrates land is the same false-absence bug the readiness gate prevents.
  it('claims nothing while loading, even when a rule would match', () => {
    expect(pickInterrupt(ctx({ loading: true }))).toBeNull();
    expect(pickInterrupt(ctx({ loading: true, firstRunFlag: true }))).toBeNull();
    expect(pickInterrupt(ctx({ loading: true, ...SYNCED_NO_REVENUE }))).toBeNull();
  });
});

describe('robustness', () => {
  // Missing context is unknown, never confirmed setup absence.
  it('no argument at all produces no instruction and does not throw', () => {
    expect(pickInterrupt()).toBeNull();
  });

  it('a missing dismissed set is treated as nothing dismissed', () => {
    expect(pickInterrupt({ hasAnyData: false, canSuggestConnect: true })).toBe(INTERRUPT.CONNECT);
  });
});
