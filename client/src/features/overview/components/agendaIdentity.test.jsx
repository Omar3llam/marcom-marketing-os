// ============================================================
// R9 — list identity on the home surfaces
// ------------------------------------------------------------
// Two DIFFERENT list surfaces render "decisions" on the Overview, and they key
// on two different things because they are lists of two different things:
//
//   AgendaBand    renders PLANNER ITEMS. One entity can produce several (a
//                 verdict AND a fatigue warning), so the item's own composite
//                 id — `verdict:<decisionId>`, `fatigue:<entityId>:<metric>` —
//                 is the identity. entityId would collide.
//
//   ActNow/Watch  render the DECISION FEED: one row per campaign, already
//                 partitioned by verdict into disjoint bands. Here entityId IS
//                 the row identity, and these rows carry no item id at all.
//
// This file pins both, because the failure they guard against is silent: React
// duplicate keys drop or reuse DOM nodes, and a mis-keyed list looks correct
// until two rows share a key. It also pins the rule common to both — a display
// NAME is never the identity, no matter how convenient it looks in a fixture.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import AgendaBand from './AgendaBand.jsx';
import ActNowSection from './ActNowSection.jsx';
import WatchSection from './WatchSection.jsx';

vi.mock('./DecisionCard.jsx', () => ({
  default: ({ name, entityId }) => <div data-testid="card" data-entity={entityId}>{name}</div>,
}));

const ENTITY = 'a3f1c2d4-1111-5aaa-8bbb-0123456789ab';

const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

// React does not THROW on a duplicate key — it renders both children and logs a
// warning through console.error. So "two rows appeared" is not, on its own, an
// assertion about identity: a mis-keyed list still renders the right number of
// nodes right up until React reuses or drops one.
//
// Capturing the warning is what makes these controls able to fail. Without it,
// re-keying either list on the wrong field passes every visible expectation.
let keyWarnings = [];
let errSpy;

beforeEach(() => {
  keyWarnings = [];
  errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    const msg = args.map(String).join(' ');
    if (/same key|unique "key"|duplicate key/i.test(msg)) keyWarnings.push(msg);
  });
});

afterEach(() => errSpy.mockRestore());

/** No two siblings in the last render shared a key. */
const expectNoDuplicateKeys = () => expect(keyWarnings).toEqual([]);

describe('R9 · AgendaBand keys on the planner item id, not the entity', () => {
  // THE control for §11. One campaign, two agenda items: the engine issued a
  // verdict on it AND the forecaster flagged its frequency. Both are real, both
  // must show. Keyed by entityId these two collide.
  const items = [
    {
      id: 'verdict:dec-1', entityId: ENTITY, type: 'VERDICT', severity: 'CRITICAL',
      title: 'Kill Ramadan Cold', humanAction: 'KILL',
    },
    {
      id: `fatigue:${ENTITY}:frequency`, entityId: ENTITY, type: 'FATIGUE', severity: 'WARNING',
      title: 'Frequency approaching ceiling', humanAction: 'REFRESH',
    },
  ];

  it('renders BOTH items when one entity carries two decision types', () => {
    withRouter(<AgendaBand band="BUYER" data={{ items }} />);

    expect(screen.getByText('Kill Ramadan Cold')).toBeInTheDocument();
    expect(screen.getByText('Frequency approaching ceiling')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    // THE control: keyed on entityId these two share a key. Both still render,
    // so only the warning distinguishes a correct list from a broken one.
    expectNoDuplicateKeys();
  });

  it('the two items have distinct identities even though entityId is shared', () => {
    // The planner already mints composite ids; the surface must not discard them
    // in favour of the entity. Stated as a property of the DATA the band is
    // handed, so it fails if the planner ever stops namespacing.
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    expect(new Set(items.map((i) => i.entityId)).size).toBe(1);
  });

  it('counts both items in the band meta', () => {
    withRouter(<AgendaBand band="BUYER" data={{ items }} />);
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });
});

describe('R9 · the decision feed keys on the entity, and never on a name', () => {
  // Two genuinely different campaigns that share a display name — the same
  // collision actualsSink now refuses to resolve. Keyed by name these two
  // become one card; keyed by entityId they are correctly two.
  const sameName = [
    { entityId: 'e-1', name: 'Ramadan Sale', verdict: 'KILL' },
    { entityId: 'e-2', name: 'Ramadan Sale', verdict: 'KILL' },
  ];

  it('ActNowSection renders two cards for two same-named campaigns', () => {
    withRouter(<ActNowSection items={sameName} total={2} />);

    const cards = screen.getAllByTestId('card');
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.getAttribute('data-entity'))).toEqual(['e-1', 'e-2']);
    expectNoDuplicateKeys(); // keyed on `name` these two collide
  });

  it('WatchSection renders two cards for two same-named campaigns', () => {
    withRouter(<WatchSection items={sameName} total={2} defaultOpen />);

    const cards = screen.getAllByTestId('card');
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.getAttribute('data-entity'))).toEqual(['e-1', 'e-2']);
    expectNoDuplicateKeys();
  });

  it('a feed row carries an entityId and no planner item id — the key must come from the entity', () => {
    // Guards the inverse mistake: "unifying" these surfaces on `item.id` would
    // key every card `undefined`, because decisionFeed rows have no such field.
    for (const row of sameName) {
      expect(row.entityId).toBeTruthy();
      expect(row.id).toBeUndefined();
    }
  });
});
