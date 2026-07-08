// ============================================================
// CampaignDetailPanel — signals breakdown + on-demand reasoning
// ------------------------------------------------------------
// Signals trace to the row (null ROAS → "—", never 0). "Lumi's Read" generates
// only on click: button → spinner → text; failure → honest error; a cached read
// shows instantly on re-mount with no second API call.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CampaignDetailPanel } from './CampaignDetailPanel.jsx';

// Mock the shared client via a hoisted handle — feature code (and its tests) must
// not import '@/lib/api' directly (arch-check). We reference the mock fn instead.
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { post } }));

const campaign = (over = {}) => ({
  entityId: 'd1', name: 'Eid Sale', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 50000, ctr: 0.0523, frequency: 2.04, roas: null, currency: 'EGP', ...over,
});
const READING = 'Healthy engagement but no revenue tracked. Verify your lead form setup.';

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: { reasoning: READING } });
});

describe('CampaignDetailPanel — signals', () => {
  it('renders real signals; null ROAS is "—", never a fabricated 0', () => {
    render(<CampaignDetailPanel campaign={campaign({ entityId: 'sig1' })} verdict="WATCH" impact={6} />);
    expect(screen.getByText('WATCH')).toBeInTheDocument();
    expect(screen.getByText('6/10')).toBeInTheDocument();
    expect(screen.getByText('5.23%')).toBeInTheDocument();  // 0.0523 fraction → 5.23%
    expect(screen.getByText('2.04')).toBeInTheDocument();   // frequency
    expect(screen.getByText('OUTCOME_SALES')).toBeInTheDocument();
    expect(screen.getAllByTitle('No data').length).toBeGreaterThan(0); // roas is null → em-dash
  });
});

describe("CampaignDetailPanel — Lumi's Read", () => {
  it('click → spinner → reasoning text, with the dialect threaded', async () => {
    let resolve;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<CampaignDetailPanel campaign={campaign({ entityId: 'gen1' })} verdict="WATCH" impact={6} dialect="egy" />);
    fireEvent.click(screen.getByRole('button', { name: /get lumi's read/i }));

    expect(screen.getByText(/analyzing/i)).toBeInTheDocument(); // spinner while pending
    await act(async () => { resolve({ data: { reasoning: READING } }); });

    await waitFor(() => expect(screen.getByText(READING)).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith('/api/lumi/entities/gen1/reasoning', { dialect: 'egy' });
  });

  it('renders an honest error state on failure', async () => {
    post.mockRejectedValue(new Error('502'));
    render(<CampaignDetailPanel campaign={campaign({ entityId: 'err1' })} verdict="KILL" impact={9} />);
    fireEvent.click(screen.getByRole('button', { name: /get lumi's read/i }));
    await waitFor(() => expect(screen.getByText(/couldn.t generate reasoning/i)).toBeInTheDocument());
  });

  it('shows a cached read instantly on re-mount — no second API call, no button', async () => {
    const c = campaign({ entityId: 'cache-x' });
    const { unmount } = render(<CampaignDetailPanel campaign={c} verdict="HOLD" impact={4} />);
    fireEvent.click(screen.getByRole('button', { name: /get lumi's read/i }));
    await waitFor(() => expect(screen.getByText(READING)).toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(1);
    unmount();

    render(<CampaignDetailPanel campaign={c} verdict="HOLD" impact={4} />);
    await waitFor(() => expect(screen.getByText(READING)).toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(1); // served from the session cache
    expect(screen.queryByRole('button', { name: /get lumi's read/i })).not.toBeInTheDocument();
  });
});
