// ============================================================
// memoryTimelineViewModel — the claims it refuses to make
// ============================================================
// Almost every test here is about something NOT said. The tempting reading of
// this data is "executed = it worked", and that is the one inference the row
// cannot support: execution means an operator said they acted, and nothing
// about whether the campaign improved. The engine's own per-decision outcome is
// `resolution`, and where it is null the honest answer is silence.
import { describe, it, expect } from 'vitest';
import { buildMemoryTimelineViewModel } from './memoryTimelineViewModel.js';

const item = (over = {}) => ({
  id: 'd1', verdict: 'KILL', status: 'SUPERSEDED', createdAt: '2026-08-01T00:00:00.000Z',
  executedAt: null, dismissedAt: null, resolution: null, confidenceDelta: null, ...over,
});
const memory = (over = {}) => ({ count: 1, items: [item()], ...over });

describe('the count comes from the service', () => {
  it('uses the true total, not the number of rows listed', () => {
    // The list is bounded at 5; the count is not. Falling back to items.length
    // would under-report exactly the campaigns with the longest history.
    const vm = buildMemoryTimelineViewModel({ count: 9, items: [item(), item({ id: 'd2' })] });
    expect(vm.count).toBe(9);
    expect(vm.items).toHaveLength(2);
  });

  it('falls back to the row count only when no total came back', () => {
    expect(buildMemoryTimelineViewModel({ items: [item(), item({ id: 'd2' })] }).count).toBe(2);
  });

  it('does no counting of its own beyond that', () => {
    expect(buildMemoryTimelineViewModel({ count: 3, items: [item()] }).count).toBe(3);
  });
});

describe('ordering belongs to the service', () => {
  it('preserves the order it was given, even when dates disagree', () => {
    const vm = buildMemoryTimelineViewModel({
      count: 3,
      items: [
        item({ id: 'a', createdAt: '2026-07-01T00:00:00.000Z' }),
        item({ id: 'c', createdAt: '2026-08-09T00:00:00.000Z' }),
        item({ id: 'b', createdAt: '2026-08-01T00:00:00.000Z' }),
      ],
    });
    expect(vm.items.map((i) => i.key)).toEqual(['a', 'c', 'b']);
  });

  it('does not slice — the service decided how many travel', () => {
    const items = Array.from({ length: 9 }, (_, i) => item({ id: `d${i}` }));
    expect(buildMemoryTimelineViewModel({ count: 9, items }).items).toHaveLength(9);
  });
});

// ── The inference it must never make ────────────────────────
describe('execution is not success', () => {
  it('an executed decision with no outcome is not called successful', () => {
    const vm = buildMemoryTimelineViewModel(memory({
      items: [item({ executedAt: '2026-08-02T00:00:00.000Z', resolution: null })],
    }));
    expect(vm.items[0].action).toBe('Executed');
    expect(vm.items[0].outcome).toBeNull();
    expect(JSON.stringify(vm)).not.toMatch(/success|worked|correct/i);
  });

  it('a dismissed decision with no outcome is not called failed', () => {
    const vm = buildMemoryTimelineViewModel(memory({
      items: [item({ dismissedAt: '2026-08-02T00:00:00.000Z' })],
    }));
    expect(vm.items[0].action).toBe('Dismissed');
    expect(vm.items[0].outcome).toBeNull();
    expect(JSON.stringify(vm)).not.toMatch(/fail|wrong|incorrect/i);
  });

  it('computes no rate, no percentage, no score', () => {
    const vm = buildMemoryTimelineViewModel({
      count: 2,
      items: [item({ resolution: 'IMPROVED' }), item({ id: 'd2', resolution: 'WORSENED' })],
    });
    expect(vm).not.toHaveProperty('accuracy');
    expect(vm).not.toHaveProperty('successRate');
    expect(JSON.stringify(vm)).not.toMatch(/%|\b50\b/);
  });
});

describe('the outcome, when the engine recorded one', () => {
  it.each([
    ['IMPROVED',  'Improved after'],
    ['WORSENED',  'Worsened after'],
    ['UNCHANGED', 'No material change'],
  ])('surfaces %s as the engine classified it', (resolution, label) => {
    const vm = buildMemoryTimelineViewModel(memory({ items: [item({ resolution })] }));
    expect(vm.items[0].outcome).toBe(label);
  });

  // The schema calls UNKNOWN "a real answer, not a gap-filler" — a decision with
  // no metrics on either end honestly resolves to it. Collapsing it into null
  // would turn "we looked and could not tell" into "we never looked".
  it('keeps UNKNOWN distinct from no outcome at all', () => {
    expect(buildMemoryTimelineViewModel(memory({ items: [item({ resolution: 'UNKNOWN' })] })).items[0].outcome)
      .toBe('Outcome unclear');
    expect(buildMemoryTimelineViewModel(memory({ items: [item({ resolution: null })] })).items[0].outcome)
      .toBeNull();
  });

  it('passes an unmapped resolution through rather than dropping it', () => {
    expect(buildMemoryTimelineViewModel(memory({ items: [item({ resolution: 'NEW_STATE' })] })).items[0].outcome)
      .toBe('NEW_STATE');
  });
});

describe('what the operator did', () => {
  it.each([
    ['Executed',                  { executedAt: '2026-08-02T00:00:00.000Z' }],
    ['Dismissed',                 { dismissedAt: '2026-08-02T00:00:00.000Z' }],
    ['Replaced by a later call',  { status: 'SUPERSEDED' }],
    ['No answer recorded',        { status: 'PROPOSED' }],
  ])('reads %s', (label, over) => {
    expect(buildMemoryTimelineViewModel(memory({ items: [item(over)] })).items[0].action).toBe(label);
  });
});

describe('the date', () => {
  it('is formatted here, so the renderer holds no vocabulary', () => {
    expect(buildMemoryTimelineViewModel(memory()).items[0].at).toBe('1 Aug');
  });

  // Hand-rolled rather than toLocaleDateString: a date that reads one way in CI
  // and another on screen is a test that lies.
  it('does not vary with the machine locale', () => {
    expect(buildMemoryTimelineViewModel(memory({
      items: [item({ createdAt: '2026-12-25T23:00:00.000Z' })],
    })).items[0].at).toBe('25 Dec');
  });

  it.each([[null], ['not-a-date'], [undefined]])('is null for %s rather than a wrong date', (createdAt) => {
    expect(buildMemoryTimelineViewModel(memory({ items: [item({ createdAt })] })).items[0].at).toBeNull();
  });
});

describe('nothing to remember', () => {
  // A campaign we have never judged has no memory. "Seen 0 times" claims we
  // looked and found none, which is a different and unearned statement.
  it.each([[null], [undefined], ['nope'], [{}], [{ count: 0, items: [] }], [{ count: 4, items: [] }]])(
    '%s becomes null, never a zero', (input) => {
      expect(buildMemoryTimelineViewModel(input)).toBeNull();
    },
  );

  it('survives a malformed row', () => {
    expect(() => buildMemoryTimelineViewModel({ count: 1, items: [null] })).not.toThrow();
    const vm = buildMemoryTimelineViewModel({ count: 1, items: [null] });
    expect(vm.items[0].verdict).toBe('Unknown');
    expect(vm.items[0].outcome).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = memory();
    const before = JSON.stringify(input);
    buildMemoryTimelineViewModel(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ============================================================
// C-03 — "we could not look" is not "there is nothing"
// ============================================================
// Before this, both arrived as `null` and rendered as an absent Memory section.
// The absent section is still CORRECT for one of them: a campaign we have never
// judged has no memory, and the file above already argues that saying so out
// loud would claim we looked. What was wrong is that a failed read borrowed
// that silence and read as the same honest absence.
describe('C-03 · history availability', () => {
  const UNAVAILABLE = 'HISTORY_UNAVAILABLE';

  it('OK with no history stays silent — the ruling, not an oversight', () => {
    expect(buildMemoryTimelineViewModel(null, 'OK')).toBeNull();
    expect(buildMemoryTimelineViewModel({ count: 0, items: [] }, 'OK')).toBeNull();
  });

  it('a missing status behaves exactly as OK', () => {
    // The status is additive on the wire. A payload from before it existed, or
    // one whose field did not survive a proxy, must not start claiming an outage.
    expect(buildMemoryTimelineViewModel(null)).toBeNull();
    expect(buildMemoryTimelineViewModel(null, undefined)).toBeNull();
    expect(buildMemoryTimelineViewModel(null, null)).toBeNull();
  });

  it('an unreadable history is a stated state, not silence', () => {
    const vm = buildMemoryTimelineViewModel(null, UNAVAILABLE);
    expect(vm).not.toBeNull();
    expect(vm.unavailable).toBe(true);
    expect(typeof vm.notice).toBe('string');
  });

  // The number is the claim. A count of any kind here would say we counted.
  it('states no count and no rows when it could not look', () => {
    const vm = buildMemoryTimelineViewModel(null, UNAVAILABLE);
    expect(vm.count).toBeUndefined();
    expect(vm.items).toBeUndefined();
  });

  // Structurally impossible today — the service returns an empty map on failure —
  // but if the two ever disagree, the honest answer is the one about US. A
  // timeline rendered under a status that says we could not read it would be
  // asserting a history we have no basis for.
  it('status wins over stale rows', () => {
    const vm = buildMemoryTimelineViewModel({ count: 3, items: [item()] }, UNAVAILABLE);
    expect(vm.unavailable).toBe(true);
    expect(vm.items).toBeUndefined();
  });

  it('an available history is unaffected by the new argument', () => {
    const vm = buildMemoryTimelineViewModel(memory({ count: 4 }), 'OK');
    expect(vm.unavailable).toBeUndefined();
    expect(vm.count).toBe(4);
    expect(vm.items).toHaveLength(1);
  });
});

// ── C-06 · the view model reads the TOKEN, not one vocabulary's spelling ────
describe('buildMemoryTimelineViewModel · epistemic knowledge (C-06)', () => {
  it('renders the unavailable notice from the token alone', () => {
    // No HISTORY_UNAVAILABLE anywhere: only the shared token. This is the whole
    // point of C-06 — a surface can honour "we could not look" without knowing
    // which module's dialect produced it.
    const vm = buildMemoryTimelineViewModel(null, 'SOME_OTHER_DIALECT', 'COULD_NOT_LOOK');
    expect(vm).toEqual({ unavailable: true, notice: expect.any(String) });
  });

  it('still honours the raw status when no token is present', () => {
    // A payload that predates the token must keep behaving as it did.
    const vm = buildMemoryTimelineViewModel(null, 'HISTORY_UNAVAILABLE', null);
    expect(vm).toEqual({ unavailable: true, notice: expect.any(String) });
  });

  it('stays silent for every other token — absence is not a failure', () => {
    // NOTHING_THERE and KNOWN both mean the read happened. Rendering a notice
    // for them would tell the user we failed when we did not.
    for (const token of ['KNOWN', 'NOTHING_THERE', 'NOT_ENOUGH', 'CANNOT_ASK']) {
      expect(buildMemoryTimelineViewModel(null, 'OK', token)).toBeNull();
    }
  });

  it('a token saying we could not look outranks rows that arrived anyway', () => {
    // The two cannot disagree today. If they ever do, a timeline rendered under
    // "we could not read this" would assert a history we have no basis for.
    const memory = { count: 2, items: [{ id: 'd1', verdict: 'KILL', createdAt: '2026-08-08T00:00:00Z' }] };
    const vm = buildMemoryTimelineViewModel(memory, 'OK', 'COULD_NOT_LOOK');
    expect(vm.unavailable).toBe(true);
    expect(vm.count).toBeUndefined();
  });
});
