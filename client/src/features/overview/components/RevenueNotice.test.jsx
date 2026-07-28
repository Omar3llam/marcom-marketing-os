// ============================================================
// RevenueNotice — the two revenue stories must stay distinct
// ------------------------------------------------------------
// Ported from AlertsPanel.test.jsx when the decision feed replaced that panel.
// The assertions are unchanged in substance: a campaign can have had revenue
// NEVER uploaded (a tracking gap) or uploaded-but-now-STALE. Telling someone who
// already uploaded to upload is the failure these two CTAs exist to prevent.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RevenueNotice from './RevenueNotice.jsx';

const renderNotice = (type, campaigns) =>
  render(<RevenueNotice type={type} campaigns={campaigns} />, { wrapper: MemoryRouter });

const rows = (n, prefix) => Array.from({ length: n }, (_, i) => ({
  entityId: `${prefix}${i}`, name: `${prefix} ${i}`,
}));

describe('RevenueNotice — the tracking gap', () => {
  it('names the campaigns and offers the CONNECT cta', () => {
    renderNotice('needs', [{ entityId: 'g1', name: 'Never Uploaded' }]);
    expect(screen.getByText('Revenue data needed')).toBeInTheDocument();
    expect(screen.getByText('· Never Uploaded')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect sales data to unlock profit-based recommendations/i }))
      .toHaveAttribute('href', '/app/settings/revenue');
  });
});

describe('RevenueNotice — the stale story', () => {
  it('offers a RE-upload cta, not a first-upload one', () => {
    renderNotice('stale', [{ entityId: 's1', name: 'Went Stale' }]);
    expect(screen.getByText('Revenue data outdated')).toBeInTheDocument();
    expect(screen.getByText('· Went Stale')).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /Re-upload revenue to refresh ROAS/i });
    expect(cta).toHaveAttribute('href', '/app/settings/revenue');
    expect(screen.queryByText(/Connect sales data/i)).not.toBeInTheDocument();
  });
});

describe('RevenueNotice — honest counting', () => {
  it('caps the named list at 3 and counts the rest', () => {
    renderNotice('stale', rows(5, 'Stale'));
    expect(screen.getByText('· Stale 0')).toBeInTheDocument();
    expect(screen.queryByText('· Stale 3')).not.toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('does not claim a remainder when the list is complete', () => {
    renderNotice('needs', rows(3, 'Gap'));
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it.each([['needs'], ['stale']])('%s renders nothing when no campaign qualifies', (type) => {
    const { container } = renderNotice(type, []);
    expect(container).toBeEmptyDOMElement();
  });

  it('an unknown type renders nothing rather than a blank card', () => {
    const { container } = renderNotice('bogus', [{ entityId: 'x', name: 'X' }]);
    expect(container).toBeEmptyDOMElement();
  });

  it('a campaign with no name still renders, labelled honestly', () => {
    renderNotice('needs', [{ entityId: 'g1', name: null }]);
    expect(screen.getByText('· Unnamed campaign')).toBeInTheDocument();
  });
});
