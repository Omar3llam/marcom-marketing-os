// ============================================================
// B8-02 — the second layer: a new state must not fall back to an old claim
// ------------------------------------------------------------
// C-16 established this shape and it repeats here exactly. There, publishing
// `severity: null` from the route was not enough, because `notificationRouter`
// re-invented MEDIUM one layer down. Here, returning UNREADABLE from
// `getAccountState` is not enough, because the hero does:
//
//     STATE_CONFIG[state] ?? STATE_CONFIG[ACCOUNT_STATE.LEARNING]
//
// so any state without an entry renders as LEARNING — "we're still learning
// about your account" — which is the precise falsehood B8-02 exists to remove,
// reintroduced by a presentation default.
//
// THE RULING, applied: no default tone at a presentation boundary. A fallback
// that names a SPECIFIC state is the UI originating a claim; the only honest
// fallback is one that claims nothing.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ACCOUNT_STATE, STATE_CONFIG, buildHeroNarrative } from './overviewState.js';

describe('B8-02 · every state carries its own presentation', () => {
  it('STATE_CONFIG covers EVERY ACCOUNT_STATE — exhaustively', () => {
    // The ratchet: a seventh state added later fails here rather than silently
    // borrowing LEARNING's copy.
    for (const state of Object.values(ACCOUNT_STATE)) {
      expect(STATE_CONFIG[state], `no STATE_CONFIG entry for ${state}`).toBeTruthy();
    }
  });

  it('UNREADABLE does not borrow LEARNING\'s configuration', () => {
    expect(STATE_CONFIG[ACCOUNT_STATE.UNREADABLE])
      .not.toEqual(STATE_CONFIG[ACCOUNT_STATE.LEARNING]);
  });

  it('UNREADABLE never says the account is empty or still learning', () => {
    const copy = JSON.stringify(STATE_CONFIG[ACCOUNT_STATE.UNREADABLE]).toLowerCase();
    for (const forbidden of ['connect a channel', 'first verdict', 'no campaigns', 'learning']) {
      expect(copy, `UNREADABLE copy must not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

describe('B8-02 · the narrative states the failure rather than omitting it', () => {
  it('returns a line for UNREADABLE', () => {
    const lines = buildHeroNarrative({ state: ACCOUNT_STATE.UNREADABLE });
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toBeTruthy();
  });

  it('the UNREADABLE headline is about the READ, not about the account', () => {
    const [headline] = buildHeroNarrative({ state: ACCOUNT_STATE.UNREADABLE });
    expect(headline.toLowerCase()).not.toContain('no campaigns');
    // It must name Lumi's position, not make a claim about the operator's money.
    expect(headline.toLowerCase()).toMatch(/could ?n.t|unable|not reach/);
  });
});
