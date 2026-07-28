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

const { load, byId } = vi.hoisted(() => ({ load: vi.fn(), byId: { current: {} } }));
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ load, byId: byId.current }),
}));

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
  byId.current = {};
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
    expect(screen.getByText('Next step:')).toBeInTheDocument();
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

  it('fetches the ad sets only on the first expand', () => {
    setup();
    const btn = screen.getByRole('button', { name: /Show execution context/ });
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(btn);
    expect(load).toHaveBeenCalledWith('c-1');
  });

  it('collapsing hides the panel without re-fetching', () => {
    byId.current = { 'c-1': { loading: false, error: null, adSets: [] } };
    setup();
    const btn = screen.getByRole('button', { name: /Show execution context/ });

    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: /Hide execution context/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide execution context/ }));
    expect(screen.getByRole('button', { name: /Show execution context/ })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('renders the execution context once the ad sets arrive', async () => {
    byId.current = {
      'c-1': {
        loading: false, error: null,
        adSets: [
          { entityId: 'a1', name: 'Lookalike 1%', channel: 'META', ctr: 0.0180, spendMinor: 200_00, currency: 'USD' },
          { entityId: 'a2', name: 'Broad 25-45', channel: 'META', ctr: 0.0032, spendMinor: 325_500, currency: 'USD' },
        ],
      },
    };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));

    await waitFor(() => expect(screen.getByText('Where to execute')).toBeInTheDocument());
    expect(screen.getByText('Execute here')).toBeInTheDocument();
    expect(screen.getAllByText('Broad 25-45').length).toBeGreaterThan(0);
  });

  // An empty panel and a pending fetch look identical; saying which is the
  // difference between "nothing to show" and "not loaded yet".
  it('says it is loading rather than showing an empty panel', () => {
    byId.current = { 'c-1': { loading: true, error: null, adSets: null } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(screen.getByText(/Loading ad sets/)).toBeInTheDocument();
  });

  it('surfaces a failed ad-set read instead of rendering nothing', () => {
    byId.current = { 'c-1': { loading: false, error: new Error('boom'), adSets: null } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(screen.getByText(/Couldn't load ad sets/)).toBeInTheDocument();
    expect(screen.queryByText('Where to execute')).not.toBeInTheDocument();
  });

  // The campaign CTR is the baseline ExecutionContext divides by; without it
  // there is no gap to compute, so the panel correctly renders nothing.
  it('a campaign with no CTR expands to nothing, not to a fabricated pick', () => {
    byId.current = {
      'c-1': { loading: false, error: null, adSets: [
        { entityId: 'a1', name: 'A', channel: 'META', ctr: 0.0180 },
        { entityId: 'a2', name: 'B', channel: 'META', ctr: 0.0032 },
      ] },
    };
    setup({ ctr: null });
    fireEvent.click(screen.getByRole('button', { name: /Show execution context/ }));
    expect(screen.queryByText('Where to execute')).not.toBeInTheDocument();
  });
});
