// ============================================================
// ConnectorCampaignsPanel — the verdict column (revenue + awareness tracks)
// ------------------------------------------------------------
// Awareness campaigns are now scored on engagement (PR #157). The panel must
// render their verdict badge AND keep ROAS as "—" (never a fabricated 0). A
// campaign with no verdict (gatedOut/dataless) shows "—" in the verdict cell,
// never a faked badge.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';

// Drill-down loads on toggle, not on mount — stub it so the table renders cleanly.
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }),
}));
// The detail panel reads pre-generated reasoning on mount — stub the client so
// expanding never touches the network (null row → the "after next sweep" state).
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(() => Promise.resolve({ data: { reasoning: null, stale: false } })) } }));

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

    // Expanded → the detail panel + its pre-generated "Lumi's Read" section appear.
    expect(screen.getByText('Signals')).toBeInTheDocument();
    expect(screen.getByText(/lumi.s read/i)).toBeInTheDocument();
  });
});

describe('ConnectorCampaignsPanel — deep-link (?entity=)', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView — stub it so we can assert the scroll.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('every campaign row carries a stable scroll-target id', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ entityId: 'c1' })]} verdicts={{ c1: 'REFRESH' }} />);
    expect(document.getElementById('campaign-row-c1')).toBeInTheDocument();
  });

  it('a matching deep-link auto-expands the detail, scrolls to the row, and hands back (URL cleanup)', async () => {
    const onHandled = vi.fn();
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ entityId: 'c1', name: 'Awareness Reach' })]}
        verdicts={{ c1: 'REFRESH' }}
        deepLinkEntityId="c1"
        onDeepLinkHandled={onHandled}
      />,
    );
    // The signals + reasoning panel appears with NO click — driven by the deep-link.
    expect(await screen.findByText('Signals')).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(onHandled).toHaveBeenCalledTimes(1); // parent clears ?entity=
  });

  it('an unknown/stale entity id is a graceful no-op — no expand, no callback', () => {
    const onHandled = vi.fn();
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ entityId: 'c1' })]}
        verdicts={{ c1: 'REFRESH' }}
        deepLinkEntityId="not-a-real-campaign"
        onDeepLinkHandled={onHandled}
      />,
    );
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
    expect(onHandled).not.toHaveBeenCalled();
  });

  it('no deep-link → normal behavior, nothing auto-expands', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ entityId: 'c1' })]} verdicts={{ c1: 'REFRESH' }} />);
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
  });
});

// Two different stories that must not be confused:
//   needsRevenue  — no revenue was EVER uploaded (a gap the operator can close)
//   revenueStale  — revenue WAS uploaded but now lags the spend it would be
//                   divided by, so the engine stopped scoring it (PR #229)
describe('ConnectorCampaignsPanel — revenue data notes', () => {
  it('renders "revenue outdated" for a stale-revenue campaign', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ revenueStale: true })]} verdicts={{}} />);
    expect(screen.getByText('· revenue outdated')).toBeInTheDocument();
  });

  it('says nothing when revenue is fresh', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ revenueStale: false })]} verdicts={{}} />);
    expect(screen.queryByText('· revenue outdated')).not.toBeInTheDocument();
  });

  it('distinguishes "needs revenue" (never uploaded) from "revenue outdated" (went stale)', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ needsRevenue: true })]} verdicts={{}} />);
    expect(screen.getByText('· needs revenue')).toBeInTheDocument();
    expect(screen.queryByText('· revenue outdated')).not.toBeInTheDocument();
  });
});
