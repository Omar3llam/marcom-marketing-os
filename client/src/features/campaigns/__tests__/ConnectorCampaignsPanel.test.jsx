// ============================================================
// ConnectorCampaignsPanel — the verdict column (revenue + awareness tracks)
// ------------------------------------------------------------
// Awareness campaigns are now scored on engagement (PR #157). The panel must
// render their verdict badge AND keep ROAS as "—" (never a fabricated 0). A
// campaign with no verdict (gatedOut/dataless) shows "—" in the verdict cell,
// never a faked badge.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';

// Drill-down loads on toggle, not on mount — stub it so the table renders cleanly.
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }),
}));
// The detail panel's reasoning hook talks to the API — stub the client so mounting
// the expanded panel never touches the network.
vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

const campaign = (over = {}) => ({
  entityId: 'c1', channel: 'META', name: 'Awareness Reach', adSetCount: 0,
  spendMinor: 50000, roas: null, ctr: 0.012, frequency: 2.4, currency: 'USD', ...over,
});

describe('ConnectorCampaignsPanel — verdict column', () => {
  it('renders an awareness verdict badge while ROAS stays "—" (engagement scored, revenue not fabricated)', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REFRESH' }} />);
    expect(screen.getByLabelText('Verdict: REFRESH')).toBeInTheDocument();
    // CTR + Freq populate from the entity-graph snapshot…
    expect(screen.getByText('1.20%')).toBeInTheDocument(); // ctr 0.012 → 1.20%
    expect(screen.getByText('2.40')).toBeInTheDocument();  // frequency
    // …ROAS stays the honest no-data em-dash for an awareness campaign.
    expect(screen.getAllByTitle('No data').length).toBeGreaterThan(0);
  });

  it('a campaign with no verdict (gatedOut/dataless) shows no badge — only "—"', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ entityId: 'c2' })]} verdicts={{}} />);
    expect(screen.queryByLabelText(/^Verdict:/)).not.toBeInTheDocument();
    expect(screen.getAllByTitle('No data').length).toBeGreaterThan(0);
  });

  it('renders a revenue-track verdict identically — no lesser styling for awareness', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ roas: 4.2 })]} verdicts={{ c1: 'SCALE' }} />);
    expect(screen.getByLabelText('Verdict: SCALE')).toBeInTheDocument();
  });
});

describe('ConnectorCampaignsPanel — impact column', () => {
  it('renders the per-campaign impact score from the analysis engine', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} impacts={{ c1: 9 }} />);
    expect(screen.getByTitle('Impact 9/10 — priority to act')).toHaveTextContent('9');
  });

  it('a campaign with no impact (unscored/sub-floor) shows "—", never a fabricated 0', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'HOLD' }} impacts={{}} />);
    expect(screen.queryByTitle(/Impact \d+\/10/)).not.toBeInTheDocument();
    // The impact cell falls back to the shared "No data" em-dash.
    expect(screen.getAllByTitle('No data').length).toBeGreaterThan(0);
  });
});

describe('ConnectorCampaignsPanel — detail expand', () => {
  it('toggling the details chevron reveals the signals + reasoning panel', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REFRESH' }} impacts={{ c1: 7 }} />);
    // Collapsed → no detail panel yet.
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /toggle details for awareness reach/i }));

    // Expanded → the detail panel + its on-demand reasoning affordance appear.
    expect(screen.getByText('Signals')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get lumi's read/i })).toBeInTheDocument();
  });
});
