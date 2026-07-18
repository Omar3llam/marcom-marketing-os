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
import { MemoryRouter } from 'react-router-dom';
import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';

// Kept for rows that once carried router Links; harmless for plain rows.
const renderPanel = (ui) => render(ui, { wrapper: MemoryRouter });

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

// The badge surfaces the ENGINE'S OWN evidence words (from the rationale the
// verdict already carries), not the internal "relative to portfolio" label.
const KILL_RATIONALE =
  'Lowest CTR in the conversion group (0.85% vs 1.42% group average) — weakest engagement in your portfolio. Based on engagement signals only; add revenue data for ROAS-based scoring.';

describe('ConnectorCampaignsPanel — relative-ranking evidence badge', () => {
  it('badges the rationale evidence in marketer language when the verdict came from the relative post-pass', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign()]}
        verdicts={{ c1: 'KILL' }}
        relativeRanks={{ c1: 'BOTTOM' }}
        verdictInfo={{ c1: { rationale: KILL_RATIONALE, confidence: 0.6 } }}
      />,
    );
    expect(screen.getByLabelText('Verdict: KILL')).toBeInTheDocument();
    expect(screen.getByText('Lowest CTR in its group')).toBeInTheDocument();
    expect(screen.queryByText('relative to portfolio')).not.toBeInTheDocument();
  });

  it('no rationale arrived → a plain-language TOP/BOTTOM fallback, still no internal label', () => {
    render(
      <ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} relativeRanks={{ c1: 'BOTTOM' }} />,
    );
    expect(screen.getByText('weakest engagement in its group')).toBeInTheDocument();
  });

  it('shows no badge for an absolute (non-relative) verdict', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} relativeRanks={{}} />);
    expect(screen.queryByText(/in its group/)).not.toBeInTheDocument();
  });
});

describe('ConnectorCampaignsPanel — "Why?" evidence in the expanded detail', () => {
  const expand = () => fireEvent.click(screen.getByRole('button', { name: /toggle details for awareness reach/i }));

  it('a KILL shows the evidence, confidence, next step, and the no-revenue disclaimer', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign()]}
        verdicts={{ c1: 'KILL' }}
        relativeRanks={{ c1: 'BOTTOM' }}
        verdictInfo={{ c1: { rationale: KILL_RATIONALE, confidence: 0.6 } }}
      />,
    );
    expand();
    // Evidence = the rationale's own measurable clause, numbers verbatim.
    expect(screen.getByText(/Lowest CTR in the conversion group \(0\.85% vs 1\.42% group average\)/)).toBeInTheDocument();
    expect(screen.getByText(/Medium confidence/)).toBeInTheDocument();
    expect(screen.getByText('Pause and reallocate budget')).toBeInTheDocument();
    // roas is null → the honest basis disclaimer, in marketer language.
    expect(screen.getByText(/No revenue data found — recommendation based on CTR, Frequency and Spend only\./)).toBeInTheDocument();
  });

  it('a SCALE names the next step and the cost of not acting', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign()]}
        verdicts={{ c1: 'SCALE' }}
        relativeRanks={{ c1: 'TOP' }}
        verdictInfo={{ c1: { rationale: 'Highest CTR in the awareness group (2.10% vs 1.20% group average) — strongest engagement in your portfolio.', confidence: 0.6 } }}
      />,
    );
    expand();
    expect(screen.getByText('Increase budget or expand audience')).toBeInTheDocument();
    expect(screen.getByText(/Not scaling misses the strongest-engagement campaign/)).toBeInTheDocument();
  });

  it('a non-action verdict (HOLD/REFRESH) gets no "Why?" block', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REFRESH' }} />);
    expand();
    expect(screen.queryByText(/^Why /)).not.toBeInTheDocument();
    expect(screen.queryByText('Pause and reallocate budget')).not.toBeInTheDocument();
  });

  it('a revenue-track KILL shows no revenue disclaimer (revenue IS measured)', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ roas: 0.42 })]}
        verdicts={{ c1: 'KILL' }}
        verdictInfo={{ c1: { rationale: 'ROAS 0.42 below break-even with frequency 5.2 past the 3.5 ceiling.', confidence: 0.9 } }}
      />,
    );
    expand();
    expect(screen.getByText(/ROAS 0\.42 below break-even/)).toBeInTheDocument();
    expect(screen.getByText(/High confidence/)).toBeInTheDocument();
    expect(screen.queryByText(/No revenue data found/)).not.toBeInTheDocument();
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

  // A revenue-free campaign can't be impact-scored, but the relative post-pass
  // placed it in its cohort — surface that standing instead of a bare "—".
  it('an unscored TOP-ranked campaign shows the ↑ relative-rank glyph, not "—"', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'SCALE' }} relativeRanks={{ c1: 'TOP' }} impacts={{}} />);
    expect(screen.getByTitle('Strongest engagement in its group — no revenue data to score impact')).toHaveTextContent('↑');
  });

  it('an unscored BOTTOM-ranked campaign shows the ↓ relative-rank glyph', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} relativeRanks={{ c1: 'BOTTOM' }} impacts={{}} />);
    expect(screen.getByTitle('Weakest engagement in its group — no revenue data to score impact')).toHaveTextContent('↓');
  });

  // A real impact score always wins over the relative-rank fallback.
  it('a scored campaign shows its impact number even when also relatively ranked', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} relativeRanks={{ c1: 'BOTTOM' }} impacts={{ c1: 8 }} />);
    expect(screen.getByTitle('Impact 8/10 — priority to act')).toHaveTextContent('8');
    expect(screen.queryByTitle(/no revenue data to score impact/i)).not.toBeInTheDocument();
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
// Per-row it is an INDICATOR only: the re-upload CTA lives once (AlertsPanel /
// MetricsPanel) — a blue link repeated under every stale campaign was noise.
describe('ConnectorCampaignsPanel — revenue data notes', () => {
  const staleNote = /revenue outdated/;

  it('marks a stale-revenue campaign with a muted indicator — NOT a per-row link', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign({ revenueStale: true })]} verdicts={{}} />);
    expect(screen.getByText(staleNote)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: staleNote })).not.toBeInTheDocument();
  });

  it('says nothing when revenue is fresh', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign({ revenueStale: false })]} verdicts={{}} />);
    expect(screen.queryByText(staleNote)).not.toBeInTheDocument();
  });

  it('distinguishes "needs revenue" (never uploaded) from "revenue outdated" (went stale)', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign({ needsRevenue: true })]} verdicts={{}} />);
    expect(screen.getByText('· needs revenue')).toBeInTheDocument();
    expect(screen.queryByText(staleNote)).not.toBeInTheDocument();
  });
});
