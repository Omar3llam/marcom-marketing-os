// ============================================================
// getAccountState — the priority order IS the product decision
// ------------------------------------------------------------
// One question ("what does this account need right now?"), and the order the
// checks run in decides the answer. An account with one KILL and twelve healthy
// campaigns must read as needing a call — the majority is not the point, the
// money is.
// ============================================================
import { describe, it, expect } from 'vitest';
import { getAccountState, ACCOUNT_STATE, STATE_CONFIG } from './overviewState.js';

const state = (over = {}) => getAccountState({
  actNowTotal: 0, watchTotal: 0, healthyCount: 0, hasAnyData: true, loading: false, ...over,
});

describe('loading', () => {
  // A hero that flashes "running smoothly" before revealing three KILLs has
  // already told the user something false.
  it('returns null while loading — never a placeholder state', () => {
    expect(state({ loading: true })).toBeNull();
  });

  it('loading outranks every count, including a pending KILL', () => {
    expect(state({ loading: true, actNowTotal: 9 })).toBeNull();
  });
});

describe('no data', () => {
  it('an un-synced workspace is LEARNING, not PERFORMING_WELL', () => {
    expect(state({ hasAnyData: false })).toBe(ACCOUNT_STATE.LEARNING);
  });

  // Zero decisions from an empty account is not the same claim as zero
  // decisions from a scored one, so hasAnyData is checked BEFORE the counts.
  it('hasAnyData is checked before the counts', () => {
    expect(state({ hasAnyData: false, healthyCount: 12 })).toBe(ACCOUNT_STATE.LEARNING);
  });
});

describe('priority order', () => {
  it('any actionable decision → ACTION_REQUIRED', () => {
    expect(state({ actNowTotal: 1 })).toBe(ACCOUNT_STATE.ACTION_REQUIRED);
  });

  it('nothing to act on but something to watch → WATCH_CLOSELY', () => {
    expect(state({ watchTotal: 4 })).toBe(ACCOUNT_STATE.WATCH_CLOSELY);
  });

  it('nothing to act on or watch, but healthy campaigns → PERFORMING_WELL', () => {
    expect(state({ healthyCount: 6 })).toBe(ACCOUNT_STATE.PERFORMING_WELL);
  });

  // The load-bearing case: one KILL buried under a healthy account.
  it('ACTION_REQUIRED beats WATCH_CLOSELY beats PERFORMING_WELL', () => {
    expect(state({ actNowTotal: 1, watchTotal: 5, healthyCount: 12 })).toBe(ACCOUNT_STATE.ACTION_REQUIRED);
    expect(state({ watchTotal: 5, healthyCount: 12 })).toBe(ACCOUNT_STATE.WATCH_CLOSELY);
    expect(state({ healthyCount: 12 })).toBe(ACCOUNT_STATE.PERFORMING_WELL);
  });
});

describe('data that scored nothing', () => {
  // NOT healthy and NOT empty — the engine had rows and scored none of them.
  it('campaigns exist but no band has one → LEARNING', () => {
    expect(state()).toBe(ACCOUNT_STATE.LEARNING);
  });
});

describe('robustness', () => {
  it('no argument at all is LEARNING, not a throw', () => {
    expect(getAccountState()).toBe(ACCOUNT_STATE.LEARNING);
  });

  it('every state has a label and a colour', () => {
    for (const value of Object.values(ACCOUNT_STATE)) {
      expect(STATE_CONFIG[value]?.label).toBeTruthy();
      expect(STATE_CONFIG[value]?.color).toBeTruthy();
    }
  });
});
