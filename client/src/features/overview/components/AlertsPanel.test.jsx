// ============================================================
// AlertsPanel — the three revenue-data stories must stay distinct
// ------------------------------------------------------------
// A campaign can be a performance alert (KILL/WATCH), a tracking GAP (revenue
// never uploaded), or STALE (revenue uploaded but now lagging the spend it would
// be divided by). Conflating the last two tells an operator to do the wrong
// thing — "upload revenue" to someone who already did.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AlertsPanel from './AlertsPanel.jsx';

const renderPanel = (campaigns) =>
  render(<AlertsPanel campaigns={campaigns} />, { wrapper: MemoryRouter });

describe('AlertsPanel — high-severity alerts', () => {
  it('renders a KILL campaign by its real name', () => {
    renderPanel([{ entityId: 'a', name: 'Ramadan Cold', verdict: 'KILL', impactScore: 9 }]);
    expect(screen.getByText('Ramadan Cold')).toBeInTheDocument();
    expect(screen.getByText('Impact 9/10')).toBeInTheDocument();
  });

  it('is honest when nothing is critical', () => {
    renderPanel([{ entityId: 'a', name: 'Fine', verdict: 'HOLD', impactScore: 3 }]);
    expect(screen.getByText('No critical campaigns right now.')).toBeInTheDocument();
  });
});

describe('AlertsPanel — revenue data sections', () => {
  const stale = { entityId: 's1', name: 'Went Stale', verdict: 'HOLD', impactScore: 3, revenueStale: true };
  const gap   = { entityId: 'g1', name: 'Never Uploaded', verdict: 'HOLD', impactScore: 3, needsRevenue: true };

  it('a stale-revenue campaign gets its own section and a RE-upload CTA', () => {
    renderPanel([stale]);
    expect(screen.getByText('Revenue data outdated')).toBeInTheDocument();
    expect(screen.getByText('· Went Stale')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Re-upload revenue to refresh ROAS/i });
    expect(cta).toHaveAttribute('href', '/app/settings/revenue');
  });

  it('keeps "needs revenue" and "revenue outdated" as separate stories', () => {
    renderPanel([stale, gap]);
    // Both sections render, each naming only its own campaign.
    expect(screen.getByText('Revenue data needed')).toBeInTheDocument();
    expect(screen.getByText('Revenue data outdated')).toBeInTheDocument();
    expect(screen.getByText('· Never Uploaded')).toBeInTheDocument();
    expect(screen.getByText('· Went Stale')).toBeInTheDocument();
    // …and the two CTAs say different things — an operator who already uploaded
    // must not be told to upload.
    expect(screen.getByRole('link', { name: /Upload revenue data to unlock ROAS/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Re-upload revenue to refresh ROAS/i })).toBeInTheDocument();
  });

  it('renders no stale section when no revenue is outdated', () => {
    renderPanel([gap]);
    expect(screen.queryByText('Revenue data outdated')).not.toBeInTheDocument();
  });

  it('caps the stale list at 3 and counts the rest honestly', () => {
    renderPanel(Array.from({ length: 5 }, (_, i) => ({
      entityId: `s${i}`, name: `Stale ${i}`, verdict: 'HOLD', impactScore: 3, revenueStale: true,
    })));
    expect(screen.getByText('· Stale 0')).toBeInTheDocument();
    expect(screen.queryByText('· Stale 3')).not.toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });
});
