// ============================================================
// B8-02 — the home page must be able to say "we could not read it"
// ------------------------------------------------------------
// THE MEASURED DEFECT (B6-01 F-5, still live at origin/master 443b29b)
//
//   getAccountState:  if (!hasAnyData) return ACCOUNT_STATE.LEARNING;
//
// A failed fetch produces `hasAnyData: false`, so a backend outage renders
// LEARNING — "Connect a channel to get your first verdict." The page tells the
// operator their account is EMPTY when what actually happened is that Lumi
// could not read it. `failure ≠ empty`, on the primary surface.
//
// `useOverviewModel.js` destructures from SEVEN hooks and takes `error` from
// none of them — the word does not appear in the file — so today the view model
// has no channel to carry this even if the state existed.
//
// This file pins the STATE half. It is deliberately pure: getAccountState takes
// facts and returns a state, and that is the layer where the falsehood is
// decided.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ACCOUNT_STATE, getAccountState } from './overviewState.js';

const base = { actNowTotal: 0, watchTotal: 0, healthyCount: 0, hasAnyData: false };

describe('B8-02 · a failed read is not an empty account', () => {
  it('returns UNREADABLE when the read failed, NOT LEARNING', () => {
    const state = getAccountState({ ...base, unreadable: true });
    expect(state).toBe(ACCOUNT_STATE.UNREADABLE);
    expect(state).not.toBe(ACCOUNT_STATE.LEARNING);
  });

  it('UNREADABLE outranks LEARNING even though both see zero data', () => {
    // The two are indistinguishable by COUNT. Only the cause separates them,
    // which is why the cause has to be carried rather than inferred.
    const failed = getAccountState({ ...base, unreadable: true });
    const empty = getAccountState({ ...base, unreadable: false });
    expect(failed).not.toBe(empty);
    expect(empty).toBe(ACCOUNT_STATE.LEARNING);
  });

  it('withholds the core state when a required read failed despite cached data', () => {
    const state = getAccountState({
      ...base, hasAnyData: true, actNowTotal: 2, unreadable: true,
    });
    expect(state).toBe(ACCOUNT_STATE.UNREADABLE);
  });

  it('never flashes UNREADABLE while still loading', () => {
    // The existing rule, extended: a page that shows a failure for 400ms before
    // revealing three KILLs has told the user something false.
    expect(getAccountState({ ...base, unreadable: true, loading: true })).toBeNull();
  });

  it('declares UNREADABLE in the vocabulary', () => {
    expect(ACCOUNT_STATE.UNREADABLE).toBe('UNREADABLE');
  });
});
