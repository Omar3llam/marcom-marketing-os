// ============================================================
// DecisionCard — one decision, and what it refuses to claim
// ------------------------------------------------------------
// The card takes explicit props rather than an agenda `item`, because the agenda
// item has no verdict/name/ctr at all. These tests pin the two things that
// follow from that: the drill-down appears only for verdicts that HAVE somewhere
// to drill into, and a missing field drops its line instead of rendering blank
// furniture.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ONE fetch behind the expansion. useEntityDrillDown used to run beside this to
// feed ExecutionContext's ad-set rows; now that the ranking is the server's, the
// panel reads the evidence payload alone and the card no longer narrates a
// second request whose result it never shows.
const ev = vi.hoisted(() => ({
  load: vi.fn(), byId: { current: {} }, loading: { current: {} }, errors: { current: {} },
}));
vi.mock('@/hooks/useEvidence.js', () => ({
  evidenceKey: (id, metric = 'ctr') => `${id}:${metric}`,
  useEvidence: () => ({
    load: ev.load, byId: ev.byId.current, loading: ev.loading.current, errors: ev.errors.current,
  }),
}));

const action = vi.hoisted(() => ({ execute: vi.fn(), dismiss: vi.fn(), states: { current: {} } }));
vi.mock('@/features/campaigns/useDecisionAction.js', () => ({
  useDecisionAction: () => ({
    execute: action.execute, dismiss: action.dismiss, states: action.states.current,
  }),
}));

const BOTTOM = {
  entityId: 'a2', name: 'Broad 25-45', channel: 'META',
  ctr: 0.0032, spendMinor: 325_500, currency: 'USD',
};

/** A ranking the engine actually produced — the only state that renders the panel. */
const withEvidence = (over = {}) => ({
  'c-1:ctr': {
    entity: { entityId: 'c-1', ctr: 0.0164 }, objective: 'OUTCOME_SALES',
    evidence: {
      dimension: 'ADSET', metric: 'ctr',
      ranked: [BOTTOM, { ...BOTTOM, entityId: 'a1', name: 'Lookalike 1%', ctr: 0.0180 }],
      summary: { bottom: BOTTOM, top: { ...BOTTOM, entityId: 'a1' }, outliers: [BOTTOM] },
      dataConfidence: 0.7,
    },
    insufficientData: false, reasonKey: null, ...over,
  },
});

import DecisionCard from './DecisionCard.jsx';

const props = (over = {}) => ({
  entityId: 'c-1', name: 'Ramadan Cold', verdict: 'KILL',
  rationale: 'Lowest CTR in the conversion group', impactScore: 9,
  humanAction: 'Pause and reallocate budget',
  ctr: 0.0164, spendMinor: 655_300, currency: 'USD', ...over,
});

const setup = (over) => render(<DecisionCard {...props(over)} />, { wrapper: MemoryRouter });

beforeEach(() => {
  vi.clearAllMocks();
  ev.byId.current = {};
  ev.loading.current = {};
  ev.errors.current = {};
  action.states.current = {};
});

describe('DecisionCard — the decision itself', () => {
  it('leads with the verdict', () => {
    setup();
    expect(screen.getByText('KILL')).toBeInTheDocument();
  });

  it('renders the campaign name and the engine rationale', () => {
    setup();
    expect(screen.getByText('Ramadan Cold')).toBeInTheDocument();
    expect(screen.getByText('Lowest CTR in the conversion group')).toBeInTheDocument();
  });

  it('shows the impact score with its scale, never a bare number', () => {
    setup();
    expect(screen.getByText('Impact 9/10')).toBeInTheDocument();
  });

  it('renders the next step when one exists', () => {
    setup();
    expect(screen.getByText('Do this')).toBeInTheDocument(); // was "Next step:" pre-#302
    expect(screen.getByText(/Pause and reallocate budget/)).toBeInTheDocument();
  });

  // nextActionFor returns null for HOLD/WATCH/REFRESH — the line drops rather
  // than inventing an instruction the engine never gave.
  it('drops the next-step line when there is none', () => {
    setup({ humanAction: null });
    expect(screen.queryByText('Next step:')).not.toBeInTheDocument();
  });

  it('drops the rationale line rather than rendering an empty one', () => {
    setup({ rationale: null });
    expect(screen.queryByText('Lowest CTR in the conversion group')).not.toBeInTheDocument();
  });

  it('drops the impact badge when the campaign was never scored', () => {
    setup({ impactScore: null });
    expect(screen.queryByText(/Impact/)).not.toBeInTheDocument();
  });

  it('falls back to a placeholder rather than a blank title', () => {
    setup({ name: null });
    expect(screen.getByText('Unnamed campaign')).toBeInTheDocument();
  });

  it('deep-links to that campaign row, id encoded', () => {
    setup({ entityId: 'c/1' });
    expect(screen.getByRole('link', { name: /View in Decision Queue/ }))
      .toHaveAttribute('href', '/app/campaigns?entity=c%2F1');
  });
});

describe('DecisionCard — the execution drill-down', () => {
  it.each([['KILL'], ['REALLOCATE']])('%s offers it', (verdict) => {
    setup({ verdict });
    expect(screen.getByRole('button', { name: /Show execution context/ })).toBeInTheDocument();
  });

  // There is nothing to execute on a campaign nobody is being asked to change.
  it.each([['HOLD'], ['WATCH'], ['SCALE'], ['REFRESH']])('%s does not', (verdict) => {
    setup({ verdict });
    expect(screen.queryByRole('button', { name: /execution context/ })).not.toBeInTheDocument();
  });

  it('fetches the ranking only on the first expand', () => {
    setup();
    const btn = screen.getByRole('button', { name: /Show execution context/ });
    expect(ev.load).not.toHaveBeenCalled();

    fireEvent.click(btn);
    expect(ev.load).toHaveBeenCalledWith('c-1');
  });

  it('collapsing hides the panel without re-fetching', () => {
    setup();
    const btn = screen.getByRole('button', { name: /Show execution context/ });

    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: /Hide execution context/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide execution context/ }));
    expect(screen.getByRole('button', { name: /Show execution context/ })).toBeInTheDocument();
    expect(ev.load).toHaveBeenCalledTimes(1);
  });

  it('renders the execution context once the ranking arrives', async () => {
    ev.byId.current = withEvidence();
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));

    await waitFor(() => expect(screen.getByText('Where to execute')).toBeInTheDocument());
    expect(screen.getByText('Execute here')).toBeInTheDocument();
    expect(screen.getAllByText('Broad 25-45').length).toBeGreaterThan(0);
  });

  // The card used to hold a second hook whose ad-set rows fed the panel. Nothing
  // reads them now, and a request the user waits on for output they never see is
  // a spinner charged to nobody — worse, its failure banner appeared over a panel
  // that had rendered perfectly well from the evidence call.
  it('makes exactly one request per expand', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(ev.load).toHaveBeenCalledTimes(1);
  });

  // The fourth state this card was missing. Previously the panel simply rendered
  // nothing, which looked exactly like a pending fetch and exactly like a broken
  // one.
  describe('the engine declines to rank', () => {
    const openWith = (reasonKey) => {
      ev.byId.current = { 'c-1:ctr': { entity: {}, objective: null, evidence: null, insufficientData: true, reasonKey } };
      setup();
      fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    };

    it('says which input was missing rather than showing nothing', () => {
      openWith('INSUFFICIENT_REPORTING_ADSETS');
      expect(screen.getByText(/Not enough reporting ad sets to compare/)).toBeInTheDocument();
      expect(screen.queryByText('Where to execute')).not.toBeInTheDocument();
    });

    it('a healthy spread reads as good news, not as a failure', () => {
      openWith('NO_MEANINGFUL_GAP');
      expect(screen.getByText(/No ad set is measurably behind the others/)).toBeInTheDocument();
      // Not the error sentence — the request succeeded.
      expect(screen.queryByText(/Couldn't load evidence/)).not.toBeInTheDocument();
    });

    it('falls back to a general sentence for an unknown reason key', () => {
      openWith('SOMETHING_THE_SERVER_ADDED_LATER');
      expect(screen.getByText(/Not enough data to compare ad sets/)).toBeInTheDocument();
    });

    it('never renders the panel on a refusal', () => {
      ev.byId.current = { 'c-1:ctr': { entity: {}, objective: null, evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' } };
      setup();
      fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
      // The server declined to name a worst ad set, and there is no longer a
      // second ranker on this side that could name one anyway — which is the
      // whole point of the change.
      expect(screen.queryByText('Where to execute')).not.toBeInTheDocument();
    });
  });

  it('reports an evidence request that failed as an error, not as a refusal', () => {
    ev.errors.current = { 'c-1:ctr': 'Network Error' };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(screen.getByText(/Couldn't load evidence/)).toBeInTheDocument();
  });

  // An empty panel and a pending fetch look identical; saying which is the
  // difference between "nothing to show" and "not loaded yet".
  it('says it is loading rather than showing an empty panel', () => {
    ev.loading.current = { 'c-1:ctr': true };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(screen.getByText(/Loading execution context/)).toBeInTheDocument();
  });

  // The campaign CTR is the baseline ExecutionContext divides by; without it
  // there is no gap to compute, so the panel correctly renders nothing.
  it('a campaign with no CTR expands to nothing, not to a fabricated pick', () => {
    ev.byId.current = withEvidence();
    setup({ ctr: null });
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(screen.queryByText('-Infinity%')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

// ── The answer, wired ────────────────────────────────────────
// Home is the surface most people will ever answer a verdict on. If the buttons
// are not here, Track B stays empty no matter what the backend can now record.
describe('DecisionCard — recording the operator answer', () => {
  const open = (states = {}) => {
    ev.byId.current = withEvidence();
    action.states.current = states;
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
  };

  it('offers both answers under the ranking', () => {
    open();
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
  });

  it.each([
    ['I executed this', () => action.execute],
    ['Not applicable',  () => action.dismiss],
  ])('%s records against this card entity', (label, handler) => {
    open();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(handler()).toHaveBeenCalledWith('c-1');
  });

  // The hook keys its state by entityId; the card must read its OWN row or every
  // card on the agenda would echo whichever one was clicked last.
  it('reads only its own entity state', () => {
    open({ 'c-2': 'executed' });
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.queryByText('Recorded as executed')).not.toBeInTheDocument();
  });

  it('shows the terminal state once recorded', () => {
    open({ 'c-1': 'executed' });
    expect(screen.getByText('Recorded as executed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
  });
});

// ── PR#302: money on the card face ──────────────────────────
// spendMinor was already being passed in for ExecutionContext but never shown,
// so the card asked for a decision without saying how much was riding on it.
describe('spend', () => {
  it('renders the spend on the card face', () => {
    setup({ spendMinor: 500_000, currency: 'USD' });
    expect(screen.getByText('$5,000.00 spent')).toBeInTheDocument();
  });

  // spendMinor is MINOR units; money.ts formatCurrency is the matching
  // formatter. formatCurrencyWhole (the hero's) takes MAJOR and would be 100x.
  it('treats spendMinor as MINOR units', () => {
    setup({ spendMinor: 100, currency: 'USD' });
    expect(screen.getByText('$1.00 spent')).toBeInTheDocument();
  });

  it('omits the line when spend was never reported — never a fabricated zero', () => {
    setup({ spendMinor: null });
    expect(screen.queryByText(/spent/)).not.toBeInTheDocument();
  });

  it('a measured zero IS shown — zero spend is a fact', () => {
    setup({ spendMinor: 0, currency: 'USD' });
    expect(screen.getByText('$0.00 spent')).toBeInTheDocument();
  });

  it('withholds spend without currency while preserving the decision', () => {
    setup({ spendMinor: 1_000, currency: null });
    expect(screen.queryByText(/spent/)).not.toBeInTheDocument();
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText('Lowest CTR in the conversion group')).toBeInTheDocument();
    expect(screen.getByText('Impact 9/10')).toBeInTheDocument();
  });

  it.each(['XYZ', 'usd', ''])('withholds spend with invalid currency %s', (currency) => {
    setup({ spendMinor: 1_000, currency });
    expect(screen.queryByText(/spent/)).not.toBeInTheDocument();
    expect(screen.queryByText('$10.00 spent')).not.toBeInTheDocument();
    expect(screen.getByText('Ramadan Cold')).toBeInTheDocument();
  });
});

describe('vertical order: verdict then name+spend then why then action then link', () => {
  it('reads top to bottom in decision order', () => {
    const { container } = setup({ spendMinor: 500_000, currency: 'USD' });
    const all = [...container.querySelectorAll('*')];
    // Anchored on the elements testing-library itself resolves, so a wrapper
    // with children (the VerdictPill) cannot shadow its own label.
    const at = (el) => all.indexOf(el);
    const order = [
      at(screen.getByText('KILL')),
      at(screen.getByText('Ramadan Cold')),
      at(screen.getByText('$5,000.00 spent')),
      at(screen.getByText(/^Lowest CTR/)),
      at(screen.getByText('Do this')),
      at(screen.getByRole('link', { name: /View in Decision Queue/ })),
    ];
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
