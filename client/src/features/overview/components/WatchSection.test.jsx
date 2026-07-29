// ============================================================
// WatchSection — the band that hides attention, not information
// ------------------------------------------------------------
// A WATCH verdict is the engine saying "not yet", so the band starts closed and
// the home stays a list of things that need a call. What it must never do is
// understate: the header carries the true total even while collapsed, and
// opening it renders the same evidence-bearing cards as the urgent band.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { load, byId } = vi.hoisted(() => ({ load: vi.fn(), byId: { current: {} } }));
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ load, byId: byId.current }),
}));

import WatchSection from './WatchSection.jsx';

const item = (over = {}) => ({
  entityId: 'c-1', name: 'Ramadan Retarget', verdict: 'WATCH',
  rationale: 'Frequency climbing', impactScore: 6,
  ctr: 0.021, spendMinor: 120_000, currency: 'USD', ...over,
});

const setup = (props) => render(<WatchSection {...props} />, { wrapper: MemoryRouter });

beforeEach(() => {
  vi.clearAllMocks();
  byId.current = {};
});

describe('WatchSection', () => {
  it('starts collapsed', () => {
    setup({ items: [item()], total: 1 });
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Ramadan Retarget')).not.toBeInTheDocument();
  });

  it('says why it is closed rather than looking empty', () => {
    setup({ items: [item()], total: 1 });
    expect(screen.getByText('Nothing requires action yet.')).toBeInTheDocument();
  });

  it('reports the true count while collapsed', () => {
    setup({ items: [item(), item({ entityId: 'c-2' }), item({ entityId: 'c-3' })], total: 11 });
    expect(screen.getByText('11 campaigns')).toBeInTheDocument();
  });

  it('singularises a lone campaign', () => {
    setup({ items: [item()], total: 1 });
    expect(screen.getByText('1 campaign')).toBeInTheDocument();
  });

  it('expanding renders the decision cards', () => {
    setup({ items: [item(), item({ entityId: 'c-2', name: 'Eid Prospecting' })], total: 2 });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Ramadan Retarget')).toBeInTheDocument();
    expect(screen.getByText('Eid Prospecting')).toBeInTheDocument();
    expect(screen.queryByText('Nothing requires action yet.')).not.toBeInTheDocument();
  });

  // The cap hides cards; it must never hide the count.
  it('links out to the rest when more exist than are shown', () => {
    setup({ items: [item(), item({ entityId: 'c-2' }), item({ entityId: 'c-3' })], total: 11 });
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('View all 11 →')).toBeInTheDocument();
  });

  it('no link when every campaign is already on screen', () => {
    setup({ items: [item(), item({ entityId: 'c-2' })], total: 2 });
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.queryByText(/View all/)).not.toBeInTheDocument();
  });

  it('collapses again on a second click', () => {
    setup({ items: [item()], total: 1 });
    const toggle = screen.getAllByRole('button')[0];
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Ramadan Retarget')).not.toBeInTheDocument();
  });

  it('no props at all renders an empty band, not a throw', () => {
    setup({});
    expect(screen.getByText('0 campaigns')).toBeInTheDocument();
  });
});
