// ============================================================
// BlendedTruthView — cross-link to Campaigns (pure view)
// ------------------------------------------------------------
// The per-channel evidence table names each channel; that name deep-links into
// the Campaigns page filtered by channel (?channel=). Asserts the link exists +
// carries the right target for a STRATEGIST viewer.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BlendedTruth, { BlendedTruthView } from './BlendedTruthView.jsx';
import { useBlendedTruth } from '@/hooks/useBlendedTruth.js';

// The pure `BlendedTruthView` tests below need no hooks; the default `BlendedTruth`
// wrapper does — mock its data + context sources so the gate can be exercised.
vi.mock('@/hooks/useBlendedTruth.js', () => ({ useBlendedTruth: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST' }),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));
const previewAllocation = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAllocation.js', () => ({ useAllocation: () => ({ preview: previewAllocation, commit: vi.fn(), plan: null }) }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'USD' } }) }));
vi.mock('../IntelligenceSubNav.jsx', () => ({ default: () => null }));

const data = {
  channels: [
    { channelId: 'meta', channel: 'META', platformRoas: 3.1, blendedRoas: 2.2, blendedRevenueEfficiency: { status: 'VALID', value: 2.2 }, gapPct: 29, coverage: 'RECONCILED', confidence: 'HIGH', currency: 'USD' },
    { channelId: 'google', channel: 'GOOGLE', platformRoas: 2.0, blendedRoas: 1.5, blendedRevenueEfficiency: { status: 'VALID', value: 1.5 }, gapPct: 25, coverage: 'PARTIAL', confidence: 'MED', currency: 'USD' },
  ],
  portfolio: { platformRoas: 2.7, blendedRoas: 1.9, blendedRevenueEfficiency: { status: 'VALID', value: 1.9 }, gapPct: 30, gapMinor: 120000, reconciledCount: 1, unverifiedCount: 1 },
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

// ── Tier gate (P1.4): the wrapper renders the UpgradePrompt on a 403 (gated),
// before loading/error/data. A GROWTH paywall is an honest LOCKED state, not a
// failure — mirrors IncrementalityPanel / useIncrementality.
describe('BlendedTruth (wrapper) — tier gate', () => {
  beforeEach(() => vi.clearAllMocks());

  const renderWrapper = () =>
    render(
      <MemoryRouter>
        <BlendedTruth />
      </MemoryRouter>,
    );

  it('renders the upgrade prompt (GROWTH) when gated — never the error state', () => {
    useBlendedTruth.mockReturnValue({ data: null, loading: false, error: null, gated: true });
    renderWrapper();
    expect(screen.getByText(/Blended Truth is a Growth feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load Blended Truth/i)).not.toBeInTheDocument();
  });

  it('renders the honest error state (not the gate) on a non-403 failure', () => {
    useBlendedTruth.mockReturnValue({ data: null, loading: false, error: new Error('boom'), gated: false });
    renderWrapper();
    expect(screen.getByText(/couldn't load Blended Truth/i)).toBeInTheDocument();
    expect(screen.queryByText(/is a Growth feature/i)).not.toBeInTheDocument();
  });

  it('forwards only proven portfolio currency to allocation preview', () => {
    useBlendedTruth.mockReturnValue({ data: {
      ...data, channels: data.channels.map((channel) => ({ ...channel, currency: 'EGP' })),
      portfolio: { ...data.portfolio, currency: 'EGP', monetaryStatus: 'MONETARY_VALID', monetaryReason: null },
    }, loading: false, error: null, gated: false });
    renderWrapper();
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /preview allocation/i }));
    expect(previewAllocation).toHaveBeenCalledWith({ totalBudgetMinor: 50000, totalBudgetCurrency: 'EGP' });
  });

  it('does not use workspace currency when portfolio money is unavailable', () => {
    useBlendedTruth.mockReturnValue({ data: {
      ...data, portfolio: { ...data.portfolio, currency: null, monetaryStatus: 'MONETARY_UNAVAILABLE_MIXED', monetaryReason: 'SPEND_CURRENCY_MIXED', blendedRoas: null, blendedRevenueEfficiency: { status: 'UNAVAILABLE', value: null }, gapMinor: null, gapPct: null, platformRoas: null },
    }, loading: false, error: null, gated: false });
    renderWrapper();
    expect(screen.getAllByText(/SPEND_CURRENCY_MIXED/).length).toBeGreaterThan(0);
    expect(screen.queryByText('USD')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview allocation/i })).toBeDisabled();
  });
});
