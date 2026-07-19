// ============================================================
// BlendedTruthView — cross-link to Campaigns (pure view)
// ------------------------------------------------------------
// The per-channel evidence table names each channel; that name deep-links into
// the Campaigns page filtered by channel (?channel=). Asserts the link exists +
// carries the right target for a STRATEGIST viewer.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BlendedTruthView } from './BlendedTruthView.jsx';

const data = {
  channels: [
    { channelId: 'meta', channel: 'META', platformRoas: 3.1, blendedRoas: 2.2, gapPct: 29, coverage: 'RECONCILED', confidence: 'HIGH', currency: 'USD' },
    { channelId: 'google', channel: 'GOOGLE', platformRoas: 2.0, blendedRoas: 1.5, gapPct: 25, coverage: 'PARTIAL', confidence: 'MED', currency: 'USD' },
  ],
  portfolio: { platformRoas: 2.7, blendedRoas: 1.9, gapPct: 30, gapMinor: 120000, reconciledCount: 1, unverifiedCount: 1 },
};

describe('BlendedTruthView — channel cross-link', () => {
  it('links each channel name to the Campaigns page filtered by that channel', () => {
    render(
      <MemoryRouter>
        <BlendedTruthView data={data} role="STRATEGIST" currency="USD" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'META' });
    expect(link).toHaveAttribute('href', expect.stringContaining('channel=META'));
  });
});

// ── Identity fallback (P1.2): name → channel enum → channelId (UUID last resort).
// The href always filters by channel (platform), regardless of the visible label.
describe('BlendedTruthView — channel identity fallback', () => {
  const row = (over) => ({
    channelId: '4e7f8d9b-uuid', channel: 'META', platformRoas: 3.1, blendedRoas: 2.2,
    gapPct: 29, coverage: 'RECONCILED', confidence: 'HIGH', currency: 'USD', ...over,
  });
  const renderRow = (over) =>
    render(
      <MemoryRouter>
        <BlendedTruthView data={{ channels: [row(over)], portfolio: null }} role="STRATEGIST" currency="USD" />
      </MemoryRouter>,
    );

  it('renders the campaign name when present, still linking by channel', () => {
    renderRow({ name: 'Summer Promo' });
    const link = screen.getByRole('link', { name: 'Summer Promo' });
    expect(link).toHaveAttribute('href', expect.stringContaining('channel=META'));
    expect(screen.queryByText('4e7f8d9b-uuid')).not.toBeInTheDocument();
  });

  it('falls back to the channel enum when name is null', () => {
    renderRow({ name: null });
    expect(screen.getByRole('link', { name: 'META' })).toBeInTheDocument();
    expect(screen.queryByText('4e7f8d9b-uuid')).not.toBeInTheDocument();
  });

  it('falls back to the channelId (UUID) only when both name and channel are null', () => {
    renderRow({ name: null, channel: null });
    expect(screen.getByRole('link', { name: '4e7f8d9b-uuid' })).toBeInTheDocument();
  });
});
