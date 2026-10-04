// ============================================================
// ConnectorCampaignsPanel — the verdict column (revenue + awareness tracks)
// ------------------------------------------------------------
// Awareness campaigns are now scored on engagement (PR #157). The panel must
// render their verdict badge AND keep ROAS as "—" (never a fabricated 0). A
// campaign with no verdict (gatedOut/dataless) shows "—" in the verdict cell,
// never a faked badge.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectorCampaignsPanel, deepLinkState, DEEP_LINK } from '../ConnectorCampaignsPanel.jsx';

// Kept for rows that once carried router Links; harmless for plain rows.
const renderPanel = (ui) => render(ui, { wrapper: MemoryRouter });

// Drill-down loads on toggle, not on mount — stub it so the table renders cleanly.
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }),
}));
// The detail panel reads pre-generated reasoning on mount — stub the client so
// expanding never touches the network (null row → the "after next sweep" state).
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(() => Promise.resolve({ data: { reasoning: null, stale: false } })) } }));
// Expanding the reasoning records a lifecycle signal. Mocked so the table never
// reaches the network, and so the wiring can be asserted directly.
const { recordExplain } = vi.hoisted(() => ({ recordExplain: vi.fn() }));
vi.mock('../decisionSignals.js', () => ({ recordExplain, recordIntent: vi.fn() }));

const campaign = (over = {}) => ({
  entityId: 'c1', channel: 'META', name: 'Awareness Reach', adSetCount: 0,
  spendMinor: 50000, roas: null, ctr: 0.012, frequency: 2.4, currency: 'USD', ...over,
});

describe('P7-04B relative standing styling', () => {
  it.each(['TOP', 'BOTTOM'])('%s standing does not borrow verdict colour', (rank) => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} relativeRanks={{ c1: rank }} />);
    const indicator = screen.getByTitle(new RegExp(rank === 'TOP' ? 'Strongest engagement' : 'Weakest engagement'));
    expect(indicator).not.toHaveClass('text-signal-scale');
    expect(indicator).not.toHaveClass('text-signal-kill');
  });
});

// ── PARITY-03 · five states, five different claims (C-07) ──────────────────
describe('deepLinkState', () => {
  const rows = [{ entityId: 'c1' }];

  it('no address asked, nothing to answer', () => {
    expect(deepLinkState({ id: null, campaigns: rows, loading: false, error: null })).toBe(DEEP_LINK.NONE);
  });

  it('found', () => {
    expect(deepLinkState({ id: 'c1', campaigns: rows, loading: false, error: null })).toBe(DEEP_LINK.RESOLVED);
  });

  it('the read landed and the id is not among the rows', () => {
    expect(deepLinkState({ id: 'zz', campaigns: rows, loading: false, error: null })).toBe(DEEP_LINK.NOT_IN_LIST);
  });

  it('still in flight — NOT the same claim as absent', () => {
    expect(deepLinkState({ id: 'zz', campaigns: [], loading: true, error: null })).toBe(DEEP_LINK.PENDING);
  });

  it('the read FAILED — we cannot say whether it is here', () => {
    expect(deepLinkState({ id: 'zz', campaigns: [], loading: false, error: new Error('x') })).toBe(DEEP_LINK.UNREADABLE);
  });

  it('a failure outranks a retry in flight, and neither is absence', () => {
    // Self-refutation: if UNREADABLE collapsed into NOT_IN_LIST, an outage would
    // tell the operator their campaign does not exist.
    expect(deepLinkState({ id: 'zz', campaigns: [], loading: true, error: new Error('x') })).toBe(DEEP_LINK.UNREADABLE);
    expect(deepLinkState({ id: 'zz', campaigns: [], loading: false, error: null })).not.toBe(DEEP_LINK.UNREADABLE);
  });
});

describe('ConnectorCampaignsPanel — verdict column', () => {
  it('renders an awareness verdict badge while ROAS stays "—" (engagement scored, revenue not fabricated)', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REFRESH' }} />);
    expect(screen.getByLabelText('Verdict: REFRESH')).toBeInTheDocument();
    // No revenue and frequency below the fatigue ceiling → CTR is the key signal.
    expect(screen.getByText('CTR')).toBeInTheDocument();
    expect(screen.getByText('1.20%')).toBeInTheDocument(); // ctr 0.012 → 1.20%
    // …and no ROAS figure is invented for an awareness campaign.
    expect(screen.queryByText(/x$/)).not.toBeInTheDocument();
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

  it('a non-action verdict (HOLD) gets no "Why?" block', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'HOLD' }} />);
    expand();
    expect(screen.queryByText(/^Why /)).not.toBeInTheDocument();
    expect(screen.queryByText('Pause and reallocate budget')).not.toBeInTheDocument();
  });

  // REFRESH moved out of that list: it asks for a creative change, so it earns
  // the same "Why?" block every other intervention verdict gets.
  it('a REFRESH gets its own "Why?" block and its own next step', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REFRESH' }} />);
    expand();
    expect(screen.getByText(/^Why refresh/i)).toBeInTheDocument();
    expect(screen.getByText('Refresh the creative')).toBeInTheDocument();
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
    // The row now leads with this evidence too, so scope to the detail panel.
    const detail = screen.getByText('Signals').closest('td');
    expect(within(detail).getByText(/ROAS 0\.42 below break-even/)).toBeInTheDocument();
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

  // PARITY-03 — REPLACES "…and hands back (URL cleanup)". The hand-back deleted
  // ?entity= the moment the row was found, so the address was erased at the
  // instant it succeeded: the URL could not be copied and a refresh returned to
  // the top of an unexpanded list. The ONE case where the param survived was the
  // case where nothing was found — exactly backwards.
  it('a matching deep-link expands the detail and scrolls, and does NOT erase the address', async () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ entityId: 'c1', name: 'Awareness Reach' })]}
        verdicts={{ c1: 'REFRESH' }}
        deepLinkEntityId="c1"
      />,
    );
    expect(await screen.findByText('Signals')).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // PARITY-03 — arriving IS opening the reasoning. If the product reads an open
  // as "the operator asked why", the door used may not change the institutional
  // record. Measurement integrity, not polish.
  it('a deep-link arrival records explain, exactly like a click on the row', async () => {
    recordExplain.mockClear();
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ entityId: 'c1' })]}
        verdicts={{ c1: 'REFRESH' }}
        deepLinkEntityId="c1"
      />,
    );
    expect(await screen.findByText('Signals')).toBeInTheDocument();
    expect(recordExplain).toHaveBeenCalledWith('c1');
  });

  // ⚠️ REWRITTEN. The first version rerendered with a fresh array and asserted
  // one call — and passed with the once-guard REMOVED, because the effect keys
  // on the resolved STATE, not the array, so a plain refetch never re-runs it.
  // The test proved nothing. The case that genuinely re-runs the effect is a
  // read that flaps: RESOLVED → UNREADABLE → RESOLVED. Recovering from an
  // outage is not a second arrival, and must not be recorded as one.
  it('…and records it ONCE across a read that fails and recovers', async () => {
    recordExplain.mockClear();
    const rows = [campaign({ entityId: 'c1' })];
    const props = { verdicts: { c1: 'REFRESH' }, deepLinkEntityId: 'c1' };
    const { rerender } = render(<ConnectorCampaignsPanel campaigns={rows} {...props} />);
    expect(await screen.findByText('Signals')).toBeInTheDocument();
    expect(recordExplain).toHaveBeenCalledTimes(1);

    rerender(<ConnectorCampaignsPanel campaigns={[]} error={new Error('flap')} {...props} />);
    rerender(<ConnectorCampaignsPanel campaigns={rows} {...props} />);
    expect(recordExplain).toHaveBeenCalledTimes(1);
  });

  // PARITY-03 — REPLACES "a graceful no-op". Silence WAS the defect: the link
  // resolved to a page that ignored it, with nothing said.
  it('an id the read did not return says so, instead of failing silently', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ entityId: 'c1' })]}
        verdicts={{ c1: 'REFRESH' }}
        deepLinkEntityId="not-a-real-campaign"
      />,
    );
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
    expect(screen.getByText(/not among this account/i)).toBeInTheDocument();
  });

  // hasData ≠ read succeeded — PARITY-01's rule, applied to the deep link.
  it('a FAILED read never claims the campaign is not here', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[]}
        verdicts={{}}
        loading={false}
        error={new Error('boom')}
        deepLinkEntityId="c1"
      />,
    );
    expect(screen.queryByText(/not among this account/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t check/i)).toBeInTheDocument();
  });

  it('and while the read is still in flight it claims nothing at all', () => {
    render(
      <ConnectorCampaignsPanel campaigns={[]} verdicts={{}} loading deepLinkEntityId="c1" />,
    );
    expect(screen.queryByText(/not among this account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn.t check/i)).not.toBeInTheDocument();
  });

  it('an account with NO campaigns still answers a deep link', () => {
    // The panel renders nothing when there is nothing to show. A deep link asked
    // a question, so silence is not an available answer.
    render(<ConnectorCampaignsPanel campaigns={[]} verdicts={{}} deepLinkEntityId="c1" />);
    expect(screen.getByText(/not among this account/i)).toBeInTheDocument();
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

// ── Decision-queue banding ───────────────────────────────────
// Rows are ordered by what needs acting on, not by sync order. The bands are
// header rows INSIDE the one table, so the column grid and row anchors survive.
describe('ConnectorCampaignsPanel — decision queue grouping', () => {
  const four = [
    campaign({ entityId: 'k', name: 'Kill Me' }),
    campaign({ entityId: 'w', name: 'Watch Me' }),
    campaign({ entityId: 'h', name: 'Healthy One' }),
    campaign({ entityId: 'u', name: 'Unscored One' }),
  ];
  const verdicts = { k: 'KILL', w: 'WATCH', h: 'SCALE' }; // 'u' absent → gated out

  it('orders the bands Needs Action → Watching → Healthy → Needs Data', () => {
    const { container } = renderPanel(<ConnectorCampaignsPanel campaigns={four} verdicts={verdicts} />);
    const labels = [...container.querySelectorAll('td[colspan="5"] span')]
      .map((el) => el.textContent)
      .filter((t) => ['Needs Action', 'Watching', 'Healthy', 'Needs Data'].includes(t));
    expect(labels).toEqual(['Needs Action', 'Watching', 'Healthy', 'Needs Data']);
  });

  it('places each campaign under its band, in band order', () => {
    const { container } = renderPanel(<ConnectorCampaignsPanel campaigns={four} verdicts={verdicts} />);
    const names = [...container.querySelectorAll('tr[id^="campaign-row-"]')]
      // Column 2 — the verdict pill in column 1 is also .font-display.
      .map((tr) => tr.querySelector('td:nth-child(2) .font-display')?.textContent);
    expect(names).toEqual(['Kill Me', 'Watch Me', 'Healthy One', 'Unscored One']);
  });

  it('renders ONE table, not one per band', () => {
    const { container } = renderPanel(<ConnectorCampaignsPanel campaigns={four} verdicts={verdicts} />);
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('thead')).toHaveLength(1);
  });

  it('renders no header for an empty band', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign({ entityId: 'k' })]} verdicts={{ k: 'KILL' }} />);
    expect(screen.getByText('Needs Action')).toBeInTheDocument();
    expect(screen.queryByText('Watching')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs Data')).not.toBeInTheDocument();
  });

  it('shows the count of campaigns in each band', () => {
    const campaigns = [
      campaign({ entityId: 'k1', name: 'K1' }),
      campaign({ entityId: 'k2', name: 'K2' }),
      campaign({ entityId: 'h1', name: 'H1' }),
    ];
    const { container } = renderPanel(
      <ConnectorCampaignsPanel campaigns={campaigns} verdicts={{ k1: 'KILL', k2: 'KILL', h1: 'HOLD' }} />,
    );
    const bandRow = (label) => [...container.querySelectorAll('td[colspan="5"]')]
      .find((td) => td.textContent.includes(label));
    expect(bandRow('Needs Action').textContent).toContain('2');
    expect(bandRow('Healthy').textContent).toContain('1');
  });

  it('sorts by impact within a band (highest priority to act first)', () => {
    const campaigns = [
      campaign({ entityId: 'low', name: 'Low Impact' }),
      campaign({ entityId: 'high', name: 'High Impact' }),
    ];
    const { container } = renderPanel(
      <ConnectorCampaignsPanel
        campaigns={campaigns}
        verdicts={{ low: 'KILL', high: 'KILL' }}
        impacts={{ low: 2, high: 9 }}
      />,
    );
    const names = [...container.querySelectorAll('tr[id^="campaign-row-"]')]
      // Column 2 — the verdict pill in column 1 is also .font-display.
      .map((tr) => tr.querySelector('td:nth-child(2) .font-display')?.textContent);
    expect(names).toEqual(['High Impact', 'Low Impact']);
  });

  it('keeps a gated-out campaign under Needs Data — never under Healthy', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign({ entityId: 'u' })]} verdicts={{}} />);
    expect(screen.getByText('Needs Data')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  it('keeps the deep-link row anchor findable after grouping', () => {
    const { container } = renderPanel(
      <ConnectorCampaignsPanel campaigns={four} verdicts={verdicts} deepLinkEntityId="h" />,
    );
    expect(container.querySelector('#campaign-row-h')).toBeInTheDocument();
  });

  it('expands the deep-linked row even when it sits in a later band', () => {
    renderPanel(
      <ConnectorCampaignsPanel campaigns={four} verdicts={verdicts} deepLinkEntityId="h" />,
    );
    expect(screen.getByLabelText('Toggle details for Healthy One')).toHaveAttribute('aria-expanded', 'true');
  });
});

// ── Decision-first row hierarchy ─────────────────────────────
// The row leads with the DECISION (verdict → campaign + why + impact → the one
// metric that carries it → spend → actions), instead of a four-metric grid that
// showed four numbers to justify one call. The full metric set still lives one
// click away in the detail panel.
describe('ConnectorCampaignsPanel — decision-first row hierarchy', () => {
  const withRevenue = (over = {}) => campaign({ roas: 2.4, revenueMinor: 120000, ...over });

  it('leads the row with the verdict at the larger size', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    const pill = screen.getByLabelText('Verdict: KILL');
    expect(pill).toHaveClass('text-xs');   // size="md", not the old "sm" (text-[10px])
    // …and it sits in the FIRST column.
    expect(pill.closest('td')).toBe(pill.closest('tr').querySelector('td'));
  });

  it('surfaces the evidence on the row for a revenue-track verdict too (was tooltip-only)', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[withRevenue()]}
        verdicts={{ c1: 'KILL' }}
        verdictInfo={{ c1: { rationale: 'ROAS 0.42 below break-even with frequency 5.2 past the 3.5 ceiling.', confidence: 0.9 } }}
      />,
    );
    expect(screen.getByText('ROAS 0.42 below break-even with frequency 5.2 past the 3.5 ceiling')).toBeInTheDocument();
  });

  it('keeps impact with the campaign it ranks — no standalone Impact column', () => {
    const { container } = render(
      <ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} impacts={{ c1: 9 }} />,
    );
    const campaignCell = container.querySelector('tr[id^="campaign-row-"] td:nth-child(2)');
    expect(campaignCell.textContent).toContain('Impact');
    expect(campaignCell.querySelector('[title="Impact 9/10 — priority to act"]')).toBeInTheDocument();
    // The old dedicated column is gone.
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    expect(headers).not.toContain('Impact');
  });

  it('renders the five decision columns, not the nine-column metric grid', () => {
    const { container } = render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    expect(container.querySelectorAll('thead th')).toHaveLength(5);
  });

  it('the detail row spans the full five-column grid', () => {
    const { container } = render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    fireEvent.click(screen.getByLabelText('Toggle details for Awareness Reach'));
    const detailCell = [...container.querySelectorAll('td[colspan]')].find((td) => td.textContent.includes('Signals'));
    expect(detailCell).toHaveAttribute('colspan', '5');
  });
});

describe('ConnectorCampaignsPanel — key signal column', () => {
  it('shows ROAS when revenue was measured', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ roas: 2.4, revenueMinor: 120000 })]} verdicts={{ c1: 'SCALE' }} />);
    expect(screen.getByText('ROAS')).toBeInTheDocument();
    expect(screen.getByText('2.40x')).toBeInTheDocument();
  });

  it('shows Frequency when the audience is past the fatigue ceiling', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ frequency: 4.2 })]} verdicts={{ c1: 'REFRESH' }} />);
    expect(screen.getByText('Freq')).toBeInTheDocument();
    expect(screen.getByText('4.20')).toBeInTheDocument();
  });

  it('a campaign with no metric at all shows "—", never a picked-at-random figure', () => {
    render(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ roas: null, ctr: null, frequency: null, revenueMinor: null })]}
        verdicts={{ c1: 'HOLD' }}
      />,
    );
    expect(screen.queryByText('CTR')).not.toBeInTheDocument();
    expect(screen.queryByText('ROAS')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('No data').length).toBeGreaterThan(0);
  });
});

// Both toggles are real controls now, side by side, instead of two chevrons at
// opposite ends of the row that never said what they opened.
describe('ConnectorCampaignsPanel — row actions', () => {
  // The file's only other beforeEach is scoped to a different describe, so the
  // signal mock otherwise accumulates every expand in every earlier test.
  beforeEach(() => recordExplain.mockClear());

  it('names the detail toggle "Explain decision"', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    expect(screen.getByText('Explain decision')).toBeInTheDocument();
  });

  // The lifecycle signal: a human opened the reasoning. Reading is not acting,
  // so this records `explain`, never `intent`.
  it('records an explain signal when the reasoning is opened', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    fireEvent.click(screen.getByText('Explain decision'));
    expect(recordExplain).toHaveBeenCalledWith('c1');
  });

  // Collapsing is not a second engagement, and the server only stamps the first
  // open anyway — firing on both would double the requests for nothing.
  it('records nothing on collapse', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    const toggle = screen.getByText('Explain decision');
    fireEvent.click(toggle);   // open
    fireEvent.click(toggle);   // collapse
    expect(recordExplain).toHaveBeenCalledTimes(1);
  });

  it('hides "View ad sets" entirely when there are none (an unusable control is noise)', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ adSetCount: 0 })]} verdicts={{ c1: 'KILL' }} />);
    expect(screen.queryByText(/view ad sets/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/toggle ad sets/i)).not.toBeInTheDocument();
  });

  it('shows "View ad sets" with its count when the campaign has them', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ adSetCount: 3 })]} verdicts={{ c1: 'KILL' }} />);
    expect(screen.getByText('View ad sets (3)')).toBeInTheDocument();
  });

  it('rotates the detail chevron on expand — the label never becomes "Close"', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    const btn = screen.getByLabelText('Toggle details for Awareness Reach');
    expect(btn.querySelector('svg')).not.toHaveClass('rotate-90');

    fireEvent.click(btn);

    expect(btn.querySelector('svg')).toHaveClass('rotate-90');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Explain decision')).toBeInTheDocument(); // label unchanged
    expect(screen.queryByText(/^close$/i)).not.toBeInTheDocument();
  });

  it('rotates the ad-sets chevron on expand, independently of the detail panel', () => {
    render(<ConnectorCampaignsPanel campaigns={[campaign({ adSetCount: 2 })]} verdicts={{ c1: 'KILL' }} />);
    const adSets = screen.getByLabelText('Toggle ad sets for Awareness Reach');

    fireEvent.click(adSets);

    expect(adSets.querySelector('svg')).toHaveClass('rotate-90');
    // The detail panel is a separate state — it stays shut.
    expect(screen.getByLabelText('Toggle details for Awareness Reach')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
  });
});

// The band is the table's primary organising idea; at text-[10px] it was the
// smallest type on the page, losing to every metric it was meant to group.
describe('ConnectorCampaignsPanel — band header weight', () => {
  it('renders the band label at text-sm, not the old 10px', () => {
    const { container } = renderPanel(
      <ConnectorCampaignsPanel campaigns={[campaign({ entityId: 'k' })]} verdicts={{ k: 'KILL' }} />,
    );
    const label = [...container.querySelectorAll('td[colspan="5"] span')]
      .find((el) => el.textContent === 'Needs Action');
    expect(label).toHaveClass('text-sm');
    expect(label.className).not.toMatch(/text-\[10px\]/);
  });

  it('keeps the band count visible alongside the label', () => {
    const { container } = renderPanel(
      <ConnectorCampaignsPanel
        campaigns={[campaign({ entityId: 'k1' }), campaign({ entityId: 'k2' })]}
        verdicts={{ k1: 'KILL', k2: 'KILL' }}
      />,
    );
    const bandRow = [...container.querySelectorAll('td[colspan="5"]')]
      .find((td) => td.textContent.includes('Needs Action'));
    expect(bandRow.textContent).toContain('2');
  });
});
