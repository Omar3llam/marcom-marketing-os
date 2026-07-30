// ============================================================
// getAccountState — the priority order IS the product decision
// ------------------------------------------------------------
// One question ("what does this account need right now?"), and the order the
// checks run in decides the answer. An account with one KILL and twelve healthy
// campaigns must read as needing a call — the majority is not the point, the
// money is.
// ============================================================
import { describe, it, expect } from 'vitest';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';
import {
  getAccountState, ACCOUNT_STATE, STATE_CONFIG, buildHeroNarrative,
} from './overviewState.js';

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

// ── buildHeroNarrative ──────────────────────────────────────
// The narrative is the most quotable text on the page, so the rule is that every
// line must be backed by a real figure or dropped.
describe('buildHeroNarrative — ACTION_REQUIRED', () => {
  const narrate = (over = {}) => buildHeroNarrative({
    state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 3, currency: 'USD', ...over,
  });

  it('leads with the decision count and follows with the money at risk', () => {
    expect(narrate({ actNowTotal: 1, wastedAmount: 84310 })).toEqual([
      '1 decision needs your attention.',
      '$84,310 at risk.',
    ]);
  });

  it('pluralises the decisions', () => {
    expect(narrate({ actNowTotal: 3, wastedAmount: null })[0])
      .toBe('3 decisions need your attention.');
  });

  // The money comes from useAccountHealth, the counts from the band inputs, so
  // the two halves do not arrive together.
  it.each([
    ['unmeasured (null)', null],
    ['undefined',        undefined],
    ['a real zero',      0],
    ['negative',         -500],
    ['NaN',              Number.NaN],
    ['not a number',     '84310'],
  ])('omits the money line entirely when wasted is %s', (_label, wastedAmount) => {
    const lines = narrate({ wastedAmount });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('3 decisions need your attention.');
  });

  // 0 is a MEASURED zero, not a missing value — but "0 at risk" alongside a KILL
  // verdict reads as a contradiction, so it is simply not surfaced.
  it('a measured zero is not dressed up as a figure', () => {
    expect(narrate({ wastedAmount: 0 }).join(' ')).not.toMatch(/at risk/);
  });

  // Pinned against the shared formatter, NOT a hardcoded locale string: EGP
  // renders through Intl with the ar-EG locale (Arabic-Indic digits), so a
  // literal "EGP 84,310" expectation would be fiction.
  it('formats through the shared formatter, in the currency it was given', () => {
    const [, money] = narrate({ wastedAmount: 84310, currency: 'EGP' });
    expect(money).toBe(`${formatCurrencyWhole(84310, 'EGP')} at risk.`);
    expect(money).not.toContain('84,310'); // proves it is NOT the en-US rendering
  });

  it('falls back to USD rather than emitting a bare number', () => {
    const [, money] = narrate({ wastedAmount: 5000, currency: null });
    expect(money).toBe('$5,000 at risk.');
  });
});

describe('buildHeroNarrative — the calmer states', () => {
  it('WATCH_CLOSELY counts campaigns and says nothing is urgent', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.WATCH_CLOSELY, watchTotal: 4 })).toEqual([
      '4 campaigns need monitoring.',
      'No urgent actions today.',
    ]);
  });

  it('WATCH_CLOSELY singular', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.WATCH_CLOSELY, watchTotal: 1 })[0])
      .toBe('1 campaign needs monitoring.');
  });

  it('PERFORMING_WELL adds the healthy count', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.PERFORMING_WELL, healthyCount: 21 })).toEqual([
      'Everything is running smoothly today.',
      '21 campaigns performing well.',
    ]);
  });

  it('PERFORMING_WELL with no count drops the second line', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.PERFORMING_WELL, healthyCount: 0 }))
      .toEqual(['Everything is running smoothly today.']);
  });

  it('PERFORMING_WELL singular', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.PERFORMING_WELL, healthyCount: 1 })[1])
      .toBe('1 campaign performing well.');
  });
});

describe('buildHeroNarrative — LEARNING covers two different situations', () => {
  it('names the workspace when it has one', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.LEARNING, workspaceName: 'Acme' })[0])
      .toBe('Building confidence in Acme.');
  });

  it.each([[null], [undefined], ['']])('falls back to "this workspace" for %s', (workspaceName) => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.LEARNING, workspaceName })[0])
      .toBe('Building confidence in this workspace.');
  });

  it('never synced → tells them to connect a channel', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.LEARNING, hasAnyData: false })[1])
      .toBe('Connect a channel to get your first verdict.');
  });

  // The load-bearing case: LEARNING also fires when campaigns EXIST but none
  // scored. Telling that user to "connect a channel" sends them to redo a step
  // they already finished.
  it('synced but nothing scorable → does NOT tell them to connect again', () => {
    const [, second] = buildHeroNarrative({ state: ACCOUNT_STATE.LEARNING, hasAnyData: true });
    expect(second).toBe('No campaigns have enough data to score yet.');
    expect(second).not.toMatch(/connect/i);
  });
});

describe('buildHeroNarrative — what it must never say', () => {
  const everyLine = () => [
    buildHeroNarrative({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 3, wastedAmount: 84310, currency: 'USD' }),
    buildHeroNarrative({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 3, wastedAmount: null }),
    buildHeroNarrative({ state: ACCOUNT_STATE.WATCH_CLOSELY, watchTotal: 4 }),
    buildHeroNarrative({ state: ACCOUNT_STATE.PERFORMING_WELL, healthyCount: 21 }),
    buildHeroNarrative({ state: ACCOUNT_STATE.LEARNING, hasAnyData: true }),
    buildHeroNarrative({ state: ACCOUNT_STATE.LEARNING, hasAnyData: false }),
  ].flat().join(' | ');

  it('never leaks null or undefined into the copy', () => {
    expect(everyLine()).not.toMatch(/null|undefined|NaN/);
  });

  // Wasted spend is a per-sync aggregate over an unknown window, so a rate or a
  // "saved" framing would invent a measurement nobody took.
  it('never claims a rate, a saving, or a percentage', () => {
    expect(everyLine()).not.toMatch(/\/wk|\/mo|per week|saved|recover|%/i);
  });

  it('an unknown state is an empty narrative, not a throw', () => {
    expect(buildHeroNarrative({ state: 'NONSENSE' })).toEqual([]);
    expect(buildHeroNarrative()).toEqual([]);
  });

  it('every returned line is a non-empty string', () => {
    for (const s of Object.values(ACCOUNT_STATE)) {
      for (const line of buildHeroNarrative({ state: s })) {
        expect(typeof line).toBe('string');
        expect(line.trim()).not.toBe('');
      }
    }
  });
});
