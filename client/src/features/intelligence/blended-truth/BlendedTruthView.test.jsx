// ============================================================
// BlendedTruthView — cross-link to Campaigns (pure view)
// ------------------------------------------------------------
// The per-channel evidence table names each channel; that name deep-links into
// the Campaigns page filtered by channel (?channel=). Asserts the link exists +
// carries the right target for a STRATEGIST viewer.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

const exactWindow = { windowStatus: 'EXACT', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z' };
const comparison = (over = {}) => ({ status: 'AVAILABLE', reason: null, windowCompatibility: 'COMPATIBLE', window: exactWindow,
  currency: 'USD', platformRevenueMinor: 480000, actualRevenueMinor: 360000, gapMinor: 120000, gapPct: .25,
  gapPctReason: null, gapDenominator: 'PLATFORM_REVENUE', ...over });
const counts = { reconciledCount: 2, unverifiedCount: 0, unavailableCount: 0, totalChannelCount: 2 };
const refusal = (status = 'UNAVAILABLE', reason = 'MEASUREMENT_WINDOW_MISMATCH') => comparison({ status, reason,
  windowCompatibility: 'INCOMPATIBLE', window: { windowStatus: 'UNKNOWN', windowStart: null, windowEnd: null },
  currency: null, platformRevenueMinor: null, actualRevenueMinor: null, gapMinor: null, gapPct: null });
const data = {
  channels: ['META', 'GOOGLE'].map(channel => ({ channelId: channel, channel, platformRoas: 3.1,
    blendedRevenueEfficiency: { status: 'VALID', value: 2.2 }, reconciliation: comparison() })),
  portfolio: { monetaryStatus: 'MONETARY_VALID', currency: 'USD', platformRoas: 2.7,
    blendedRevenueEfficiency: { status: 'VALID', value: 1.9 }, reconciliation: { ...comparison(), ...counts }, ...counts },
};
const show = (reconciliation = comparison(), role = 'STRATEGIST', channels = data.channels) => render(<MemoryRouter>
  <BlendedTruthView data={{ channels, portfolio: { ...data.portfolio, reconciliation: { ...reconciliation, ...counts } } }} role={role} />
</MemoryRouter>);

describe('BlendedTruthView — explicit reconciliation authority', () => {
  it.each([[.25, 120000, 'above'], [-.25, -120000, 'below']])('renders signed ratio %s with explicit money', (gapPct, gapMinor, direction) => {
    show(comparison({ gapPct, gapMinor }), 'BUYER');
    const sentence = screen.getByText(new RegExp('Revenue gap: 25% ' + direction));
    expect(sentence).toHaveTextContent('$1,200'); expect(sentence).toHaveTextContent('of platform-reported revenue');
    expect(sentence).not.toHaveClass('text-signal-kill', 'text-signal-scale');
  });
  it('preserves genuine measured equality without conflating absence', () => {
    show(comparison({ gapPct: 0, gapMinor: 0 }), 'BUYER');
    expect(screen.getByText(/Revenue gap: Match/)).toHaveTextContent('$0');
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });
  it('keeps signed absolute difference for a zero platform denominator', () => {
    show(comparison({ platformRevenueMinor: 0, gapMinor: -120000, gapPct: null, gapPctReason: 'ZERO_PLATFORM_DENOMINATOR' }), 'BUYER');
    expect(screen.getByText(/Revenue gap: below/)).toHaveTextContent('$1,200');
    expect(screen.getByText(/Percentage unavailable because/)).toBeInTheDocument();
    expect(screen.queryByText(/0%|100%|Match/)).not.toBeInTheDocument();
  });
  it.each([['UNVERIFIED', 'ACTUAL_REVENUE_UNAVAILABLE', /No actual revenue/],
    ['UNAVAILABLE', 'MEASUREMENT_WINDOW_MISMATCH', /different periods/]])('refuses %s despite stale numeric aliases and coverage', (status, reason, text) => {
    const rec = refusal(status, reason); const channels = [{ ...data.channels[0], coverage: 'RECONCILED', confidence: 'HIGH', gapPct: 0, reconciliation: rec }];
    show(rec, 'STRATEGIST', channels);
    const table = screen.getByRole('table', { name: 'Channel revenue evidence comparison' });
    expect(within(table).getByText(text)).toBeInTheDocument();
    expect(within(table).getByText(status === 'UNVERIFIED' ? 'Unverified' : 'Unavailable')).toBeInTheDocument();
    expect(within(table).queryByText(/0%|Match|HIGH/)).not.toBeInTheDocument();
  });
  it('discloses the partial population and period', () => {
    render(<MemoryRouter><BlendedTruthView data={{ ...data, portfolio: { ...data.portfolio,
      reconciliation: { ...comparison(), ...counts, totalChannelCount: 3, unverifiedCount: 1 } } }} role="BUYER" /></MemoryRouter>);
    expect(screen.getByText(/Across 2 of 3/)).toHaveTextContent('partial population');
    expect(screen.getByText(/Evidence period:/)).toHaveTextContent('2026-08-01 → 2026-08-30');
  });
  it.each(['PORTFOLIO_WINDOW_MISMATCH', 'PORTFOLIO_CURRENCY_MISMATCH'])('does not publish an incompatible portfolio gap: %s', reason => {
    show(refusal('UNAVAILABLE', reason), 'BUYER');
    expect(screen.getByText(/Portfolio revenue gap unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Revenue gap: 25%/)).not.toBeInTheDocument();
  });
  it('keeps independent efficiency visible when reconciliation is unavailable', () => {
    show(refusal(), 'BUYER');
    expect(screen.getByText(/Blended revenue efficiency: 1.9×/)).toBeInTheDocument();
  });
  it.each([[.004, 400, '0.4% above'], [-.004, -400, '0.4% below'], [.006, 600, '0.6% above'],
    [-.006, -600, '0.6% below'], [.0004, 40, '<0.1% above'], [-.0004, -40, '<0.1% below']])('preserves tiny nonzero reconciliation %s', (gapPct, gapMinor, text) => {
    show(comparison({ platformRevenueMinor: 100000, actualRevenueMinor: 100000 - gapMinor, gapPct, gapMinor }), 'BUYER');
    expect(screen.getByText(value => value.startsWith('Revenue gap: ' + text))).toBeInTheDocument();
    expect(screen.queryByText(/Revenue gap: (0%|Match)/)).not.toBeInTheDocument();
  });
  it('uses one channel model for labelled records and an accessible desktop table', () => {
    show(); const table = screen.getByRole('table', { name: 'Channel revenue evidence comparison' });
    expect(table).toHaveClass('hidden', 'sm:table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    for (const h of within(table).getAllByRole('columnheader')) expect(h).toHaveAttribute('scope', 'col');
    for (const row of within(table).getAllByRole('rowheader')) expect(row).toHaveAttribute('scope', 'row');
    const records = screen.getByRole('region', { name: 'Channel revenue evidence records' }); expect(records).toHaveClass('sm:hidden');
    for (const name of ['META', 'GOOGLE']) {
      const record = within(records).getByRole('article', { name: name + ' revenue evidence' });
      expect(within(record).getByText('Platform ROAS')).toBeInTheDocument(); expect(record).toHaveTextContent('25% above');
      expect(record).toHaveTextContent('Reconciled'); expect(record).toHaveTextContent('Evidence period:');
      expect(within(record).getByRole('link')).toHaveAttribute('href', expect.stringContaining('channel=' + name));
    }
  });
  it('preserves stale warning without changing reconciliation', () => {
    show(comparison(), 'STRATEGIST', data.channels.map(c => ({ ...c, stale: true })));
    expect(screen.getByText(/data is stale/)).toBeInTheDocument(); expect(screen.getByText(/Revenue gap: 25% above/)).toBeInTheDocument();
  });
  it.each(['BUYER', 'STRATEGIST'])('preserves %s detail visibility', role => {
    show(comparison(), role); expect(Boolean(screen.queryByRole('table'))).toBe(role === 'STRATEGIST');
    expect(Boolean(screen.queryByRole('region', { name: 'Channel revenue evidence records' }))).toBe(role === 'STRATEGIST');
  });
  it('does not manufacture a single-channel portfolio hero', () => {
    show(comparison(), 'BUYER', [data.channels[0]]); expect(screen.getByText(/reconciles across ≥2 channels/)).toBeInTheDocument();
    expect(screen.queryByText(/Revenue gap:/)).not.toBeInTheDocument();
  });
  it.each([{ name: 'Summer Promo', channel: 'META', label: 'Summer Promo' }, { name: null, channel: 'META', label: 'META' },
    { name: null, channel: null, label: 'uuid' }])('preserves identity fallback: $label', over => {
    show(comparison(), 'STRATEGIST', [{ ...data.channels[0], channelId: 'uuid', ...over }]);
    for (const link of screen.getAllByRole('link', { name: over.label })) expect(link).toHaveAttribute('href', expect.stringContaining('channel=' + (over.channel ?? 'uuid')));
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

  it.each([
    [0.25, 120000], [-0.25, -120000], [0, 0], [null, null],
  ])('keeps allocation eligibility independent of unavailable reconciliation: %s', (gapPct, gapMinor) => {
    useBlendedTruth.mockReturnValue({ data: {
      ...data, portfolio: { ...data.portfolio, currency: 'USD', monetaryStatus: 'MONETARY_VALID', gapPct, gapMinor, reconciliation: { ...refusal(), ...counts } },
    }, loading: false, error: null, gated: false });
    renderWrapper();
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /preview allocation/i }));
    expect(previewAllocation).toHaveBeenCalledWith({ totalBudgetMinor: 50000, totalBudgetCurrency: 'USD' });
  });

  it('keeps allocation disabled without authoritative efficiency even when gap is valid', () => {
    useBlendedTruth.mockReturnValue({ data: {
      ...data, portfolio: { ...data.portfolio, currency: 'USD', monetaryStatus: 'MONETARY_VALID',
        gapPct: 0.25, gapMinor: 120000, blendedRevenueEfficiency: { status: 'UNAVAILABLE', value: null } },
    }, loading: false, error: null, gated: false });
    renderWrapper();
    expect(screen.getByRole('button', { name: /preview allocation/i })).toBeDisabled();
  });
});
