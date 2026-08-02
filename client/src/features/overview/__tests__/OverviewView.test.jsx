// ============================================================
// OverviewView — the agentic shell is decoupled from the legacy feed
// ------------------------------------------------------------
// The bug: the Overview gated <AgenticShellView /> (the two-band agenda that
// carries live connector VERDICTs) behind `hasData`, which reads ONLY the legacy
// CampaignState feed (useIntelligence → /api/lumi/feed). A workspace that had
// synced Meta via connectors — real Campaign entities + MetricSnapshot + PROPOSED
// verdicts — still showed "No campaign data yet" and the agenda was never mounted.
//
// These tests pin the fix: the shell renders on EITHER substrate, the empty state
// shows only when BOTH are empty, and (post-H1) the KPI stat block is
// CONNECTOR-FIRST — it renders real connector figures on a connector-only
// account, null→"—" for any absent metric (never fabricated).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => ({ currentUser: { displayName: 'Omar A' } }) }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { name: 'Acme', currency: 'USD' } }) }));
vi.mock('@/context/IntelligenceContext.jsx', () => ({ useIntelligence: vi.fn() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useCollabRole: vi.fn() };
});

// Child components mocked to markers/null so we test OverviewView's gating only.
vi.mock('../AgenticShellView.jsx', () => ({ default: () => <div data-testid="agentic-shell">shell</div> }));
vi.mock('../components/FirstRunBanner.jsx', () => ({ default: () => <div data-testid="first-run">first-run</div> }));
vi.mock('../components/RevenueOnboardingBanner.jsx', () => ({ default: () => <div data-testid="revenue-onboarding">revenue-onboarding</div> }));
// Renders its variant so the layout tests can tell the rail's compact strip from
// the full-width one; the real component's states are covered in its own file.
vi.mock('../components/ConnectionHealthStrip.jsx', () => ({
  default: ({ compact }) => (compact ? <div>Channels</div> : null),
}));
vi.mock('../components/PacingWidget.jsx', () => ({ default: () => <div data-testid="pacing" /> }));
vi.mock('../components/CopilotPanel.jsx', () => ({ default: () => null }));
// `sub` is rendered too — the health card's caption is one of the three claims
// the readiness-gate tests below assert on.
vi.mock('@/components/ui/StatCard.jsx', () => ({
  default: ({ label, sub }) => <div data-testid="stat-card"><span>{label}</span><span>{sub}</span></div>,
}));
// AccountStateHero + CalibrationSection are NOT mocked: the information
// architecture is what these tests are about, so both render for real.

import OverviewView from '../OverviewView.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';

const CONNECTOR_ROW = { entityId: 'c1', name: 'Eid Sale', channel: 'META', spendMinor: 50000, ctr: 0.0185 };
const LEGACY_ROW = { campaign_id: 'x', alerts: [] };

const renderView = () => render(<MemoryRouter><OverviewView /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear(); // firstActivation flag must not bleed across tests
  useCollabRole.mockReturnValue({ role: WORKSPACE_ROLE.STRATEGIST });
  // defaults; each test overrides the substrate under test
  useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
  useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
  // Default: no channel has ever synced → the revenue-onboarding banner stays hidden
  // and every pre-existing test is unaffected. Revenue-banner tests override this.
  useConnections.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  // Default: nothing scored → the decision feed renders its honest empty line.
  useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, refetch: vi.fn() });
  useConnectorVerdicts.mockReturnValue({ verdicts: [], gatedOut: [], loading: false, error: null, refetch: vi.fn() });
  // Default: no proof surface → the calibration block renders nothing, so every
  // pre-existing test is unaffected. The IA tests override this.
  useAccuracy.mockReturnValue({ surface: null });
});

describe('OverviewView — agentic shell is decoupled from the legacy CampaignState feed', () => {
  it('renders the agenda AND connector-first KPI cards when only connector data exists', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false }); // legacy feed empty
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    // H1: the KPI block is now connector-first — it renders on a connector-only
    // account (real connector figures / "—"), no longer gated on the legacy feed.
    expect(screen.getAllByTestId('stat-card').length).toBe(4);
  });

  it('shows the empty state (and no agenda) only when BOTH substrates are empty', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText(/No campaign data yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('agentic-shell')).not.toBeInTheDocument();
  });

  it('renders the agenda AND the legacy stat block when the legacy feed has data (unchanged behavior)', () => {
    useIntelligence.mockReturnValue({ campaigns: [LEGACY_ROW], summary: { spend: 0, health: 0 }, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
    expect(screen.getAllByTestId('stat-card').length).toBe(4);
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
  });

  it('shows neither the empty state nor the agenda while data is still loading', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: true });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: true, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('agentic-shell')).not.toBeInTheDocument();
  });
});

// The page led with a greeting and buried the decisions in a 3-column panel row.
// It now leads with the decisions themselves: AlertsPanel and QuickActionsPanel
// are gone (the first duplicated the agenda's job, the second was navigation),
// and the two revenue-data stories survive as their own notices.
describe('OverviewView — the decision feed replaces the panel row', () => {
  const withConnector = () => useConnectorCampaigns.mockReturnValue({
    campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn(),
  });

  // REWRITTEN for PR#299. Was: the h1 read the static "Today's Decisions" and a
  // time-of-day greeting sat under it. That header said the same thing on a
  // bleeding account and a healthy one, so it is now the state machine's
  // headline, with the workspace name demoted to the subtitle.
  it('leads with the account state, not a static title', () => {
    withConnector();
    mixedHealth();
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 decision needs your attention.');
    expect(screen.getByText('Needs your call')).toBeInTheDocument();
    // workspace demoted to the provenance line, now carrying the figures' currency
    expect(screen.getByText('Acme · USD')).toBeInTheDocument();
    expect(screen.queryByText("Today's Decisions")).not.toBeInTheDocument();
  });

  it('the headline quotes the TRUE total, not the number of cards on screen', () => {
    withConnector();
    // 5 actionable, capped at SECTION_CAP=3 → the hero must still say 5.
    useAccountHealth.mockReturnValue({
      health: {
        campaigns: Array.from({ length: 5 }, (_, i) => ({
          entityId: `k${i}`, name: `Kill ${i}`, verdict: 'KILL', impactScore: 9 - i,
        })),
      },
      loading: false, error: null, refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('5 decisions need your attention.');
  });

  it('a healthy-only account leads with "running smoothly"', () => {
    withConnector();
    useAccountHealth.mockReturnValue({
      health: { campaigns: [{ entityId: 'h1', name: 'Good', verdict: 'HOLD', impactScore: 2 }] },
      loading: false, error: null, refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Everything is running smoothly today.');
  });

  it('renders no hero headline while the data is still loading', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: true, error: null, refetch: vi.fn() });
    renderView();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('no longer renders the Quick Actions shortcuts', () => {
    withConnector();
    renderView();
    expect(screen.queryByText('Quick Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Content')).not.toBeInTheDocument();
  });

  it('keeps the agenda — the feed sits alongside it, never replaces it', () => {
    withConnector();
    renderView();
    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
  });

  // The three bands, from one mixed set of verdicts: KILL/REALLOCATE demand a
  // call, WATCH/REFRESH are monitored quietly, HOLD/SCALE are just counted.
  const mixedHealth = () => useAccountHealth.mockReturnValue({ health: { campaigns: [
    { entityId: 'c1', name: 'Eid Sale', verdict: 'KILL', impactScore: 6 },
    { entityId: 'c2', name: 'Retarget', verdict: 'WATCH', impactScore: 9 },
    { entityId: 'c3', name: 'Steady', verdict: 'HOLD', impactScore: 9 },
  ] }, loading: false, error: null, refetch: vi.fn() });

  it('puts each verdict in its own band', () => {
    withConnector();
    mixedHealth();
    renderView();

    expect(screen.getByText('1 decision')).toBeInTheDocument();
    expect(screen.getByText('Eid Sale')).toBeInTheDocument();          // act now — open
    expect(screen.getByText('1 campaign')).toBeInTheDocument();        // keep watching — counted
    expect(screen.queryByText('Retarget')).not.toBeInTheDocument();    // …but collapsed
    expect(screen.getByText('1 campaign performing well')).toBeInTheDocument();
    expect(screen.queryByText('Steady')).not.toBeInTheDocument();      // healthy = a count, no card
  });

  it('claims an order only where cards are ordered', () => {
    withConnector();
    mixedHealth();
    renderView();
    expect(screen.getByText('Highest impact first')).toBeInTheDocument();
  });

  it('drops the ordering claim when nothing needs a call', () => {
    withConnector();
    renderView();
    expect(screen.queryByText('Highest impact first')).not.toBeInTheDocument();
  });

  // Re-anchored for PR#299 on DOM position rather than string position. The old
  // indexOf(container.textContent) form would silently pass for the wrong reason
  // the moment the hero's own copy contained one of these three labels.
  it('renders the bands in descending urgency', () => {
    withConnector();
    mixedHealth();
    const { container } = renderView();
    const pos = (text) => {
      const el = [...container.querySelectorAll('section, h2, p')].find((n) => n.textContent.trim().startsWith(text));
      expect(el, `"${text}" not found`).toBeTruthy();
      return [...container.querySelectorAll('*')].indexOf(el);
    };
    const order = [pos('Act now'), pos('Keep watching'), pos('Doing well')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // The line now names WHY it is empty. A connector-synced account that scored
  // nothing is still accumulating signal — which is a different fact from "this
  // seat can't see the scores" and from "no channel is connected".
  it('says why the feed is empty rather than hiding it', () => {
    withConnector();
    renderView();
    expect(screen.getByText(/Verdicts appear once enough signal has accumulated/)).toBeInTheDocument();
    expect(screen.queryByText('Act now')).not.toBeInTheDocument();
  });

  // These two are NOT decisions — the campaign is not performing badly, its
  // revenue is unmeasurable — so they must not be folded into the feed.
  it('surfaces the two revenue stories separately from the decisions', () => {
    withConnector();
    useAccountHealth.mockReturnValue({ health: { campaigns: [
      { entityId: 'g1', name: 'Never Uploaded', verdict: 'HOLD', impactScore: 3, needsRevenue: true },
      { entityId: 's1', name: 'Went Stale', verdict: 'HOLD', impactScore: 3, revenueStale: true },
    ] }, loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText('Revenue data needed')).toBeInTheDocument();
    expect(screen.getByText('Revenue data outdated')).toBeInTheDocument();
    // Both are HOLD, so they are scored and doing well — not "no scored campaigns".
    expect(screen.getByText('2 campaigns performing well')).toBeInTheDocument();
    expect(screen.queryByText('No scored campaigns right now.')).not.toBeInTheDocument();
  });

  it('renders neither notice when every campaign has fresh revenue', () => {
    withConnector();
    renderView();
    expect(screen.queryByText('Revenue data needed')).not.toBeInTheDocument();
    expect(screen.queryByText('Revenue data outdated')).not.toBeInTheDocument();
  });
});

// ── PR#299: the information architecture ────────────────────────
// The decisions used to sit behind seven other blocks, so the page asked "what
// needs a call?" at the top and answered it off-screen. These pin the order.
describe('OverviewView — information architecture', () => {
  const withConnector = () => useConnectorCampaigns.mockReturnValue({
    campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn(),
  });
  const mixedHealth = () => useAccountHealth.mockReturnValue({ health: { campaigns: [
    { entityId: 'c1', name: 'Eid Sale', verdict: 'KILL', impactScore: 6 },
    { entityId: 'c2', name: 'Retarget', verdict: 'WATCH', impactScore: 9 },
    { entityId: 'c3', name: 'Steady', verdict: 'HOLD', impactScore: 9 },
  ] }, loading: false, error: null, refetch: vi.fn() });

  // Position of the first element whose trimmed text STARTS WITH `text`, in
  // document order. Anchored on elements, not on a flat string, so a label
  // appearing inside the hero cannot masquerade as the section itself.
  const orderOf = (container, texts) => texts.map((t) => {
    const all = [...container.querySelectorAll('*')];
    const i = all.findIndex((n) => n.children.length === 0 && n.textContent.trim().startsWith(t));
    expect(i, `"${t}" not found`).toBeGreaterThan(-1);
    return i;
  });
  const isAscending = (xs) => xs.every((v, i) => i === 0 || v > xs[i - 1]);

  it('the hero comes before every decision band', () => {
    withConnector();
    mixedHealth();
    const { container } = renderView();
    expect(isAscending(orderOf(container, ['Needs your call', 'Act now', 'Keep watching', 'Doing well']))).toBe(true);
  });

  it('calibration sits BELOW the decisions, not above them', () => {
    withConnector();
    mixedHealth();
    useAccuracy.mockReturnValue({ surface: { gated: true, headline: 'x', scored: 0, needed: 30 } });
    const { container } = renderView();
    expect(isAscending(orderOf(container, ['Act now', 'Doing well', 'Decision Calibration']))).toBe(true);
  });

  it('the KPI strip and the agentic shell sit below the decisions', () => {
    withConnector();
    mixedHealth();
    const { container } = renderView();
    const decisions = orderOf(container, ['Act now'])[0];
    const shell = [...container.querySelectorAll('*')].indexOf(screen.getByTestId('agentic-shell'));
    const stat = [...container.querySelectorAll('*')].indexOf(screen.getAllByTestId('stat-card')[0]);
    expect(shell).toBeGreaterThan(decisions);
    expect(stat).toBeGreaterThan(decisions);
  });

  it('nothing was deleted in the re-order — every below-fold block still renders', () => {
    withConnector();
    mixedHealth();
    renderView();
    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
    expect(screen.getByTestId('pacing')).toBeInTheDocument();
    expect(screen.getAllByTestId('stat-card')).toHaveLength(4);
    expect(screen.getByText('Ask Lumi anything')).toBeInTheDocument();
  });

  it('the copilot survives an empty account (it is not gated on data)', () => {
    renderView();
    expect(screen.getByText('Ask Lumi anything')).toBeInTheDocument();
  });

  // Calibration and #298's workspace track record count DIFFERENT things on
  // DIFFERENT substrates. Naming both "learning" would read as a contradiction.
  it('the calibration block is named distinctly from the workspace track record', () => {
    withConnector();
    useAccuracy.mockReturnValue({ surface: { gated: true, headline: 'x', scored: 0, needed: 30 } });
    renderView();
    expect(screen.getByText('Decision Calibration')).toBeInTheDocument();
    // The rail variant (#302) shortens the line for 280px; the claim is identical.
    expect(screen.getByText('Collecting outcomes — 0 of 30')).toBeInTheDocument();
  });

  it('renders no calibration block at all when the surface is absent', () => {
    withConnector();
    renderView(); // default useAccuracy → surface: null
    expect(screen.queryByText('Decision Calibration')).not.toBeInTheDocument();
  });
});

// ── PR#303 (F1): the readiness gate covers the health substrate ──────────
// The page fetched useAccountHealth but DROPPED its `loading` flag, while
// health.campaigns is the sole source of the three verdict bands. On a synced
// account whose connector resolved first, the page therefore asserted three
// absences it had not established — and retracted all three when health landed:
//
//   hero  "Building confidence… No campaigns have enough data to score yet."
//         → "3 decisions need your attention."
//   feed  "No scored campaigns right now."   → three KILL cards
//   card  "No score yet"                     → 71/100
//
// These pin the whole class, not just the hero: the fix is one gate, so a fourth
// health-derived claim cannot regress without failing here.
describe('OverviewView — health readiness gate (no claim before its substrate lands)', () => {
  // The exact race: connector RESOLVED with campaigns, health STILL IN FLIGHT.
  const healthInFlight = () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    useAccountHealth.mockReturnValue({ health: null, loading: true, error: null, refetch: vi.fn() });
  };
  const healthLanded = () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    useAccountHealth.mockReturnValue({
      health: {
        score: 71,
        wastedSpend: { minor: 420000 },
        campaigns: [
          { entityId: 'c1', name: 'Eid Sale', verdict: 'KILL', impactScore: 8 },
          { entityId: 'c2', name: 'Ramadan', verdict: 'KILL', impactScore: 6 },
          { entityId: 'c3', name: 'Retarget', verdict: 'REALLOCATE', impactScore: 4 },
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    });
  };

  it('renders NO hero state while useAccountHealth is still in flight', () => {
    healthInFlight();
    renderView();

    // Not the false LEARNING flash…
    expect(screen.queryByText('Building confidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/No campaigns have enough data to score yet/)).not.toBeInTheDocument();
    // …and not a premature confident state either. Silence is the honest render.
    expect(screen.queryByText('Needs your call')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('does not claim the feed is clear while the bands have no substrate yet', () => {
    healthInFlight();
    renderView();
    expect(screen.queryByText(/Verdicts appear once enough signal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No connected channel/)).not.toBeInTheDocument();
  });

  it('does not claim "No score yet" before the score could have arrived', () => {
    healthInFlight();
    renderView();
    const cards = screen.getAllByTestId('stat-card').map((n) => n.textContent);
    expect(cards.some((t) => t.includes('No score yet'))).toBe(false);
    expect(cards.some((t) => t.includes('Scoring'))).toBe(true);
  });

  // The sequence, end to end: nothing is asserted, then the real state appears.
  // No claim on the first render is contradicted by the second.
  it('states the real account condition once health lands — with nothing retracted', () => {
    healthInFlight();
    const { rerender } = renderView();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();

    healthLanded();
    rerender(<MemoryRouter><OverviewView /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('3 decisions need your attention.');
    expect(screen.getByText('Needs your call')).toBeInTheDocument();
    expect(screen.queryByText('No scored campaigns right now.')).not.toBeInTheDocument();
  });

  // "No score yet" and "No scored campaigns" are still the RIGHT words once the
  // fetch has resolved and genuinely scored nothing — the gate must not swallow
  // a real empty answer.
  it('still says so when health has RESOLVED and scored nothing', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    useAccountHealth.mockReturnValue({ health: { campaigns: [] }, loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText(/Verdicts appear once enough signal has accumulated/)).toBeInTheDocument();
    expect(screen.getAllByTestId('stat-card').some((n) => n.textContent.includes('No score yet'))).toBe(true);
    expect(screen.getByText('Building confidence')).toBeInTheDocument();
  });

  // The gate must not become a reason to hide an un-synced account's own answer.
  it('an un-synced account still reaches its LEARNING hero once health resolves', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText('Building confidence')).toBeInTheDocument();
    expect(screen.getByText(/Connect a channel to get your first verdict/)).toBeInTheDocument();
  });
});

// ── The CLIENT dead zone ─────────────────────────────────────
// GET /entities/health is gated BUYER|STRATEGIST; GET /entities/campaigns is
// not. So a CLIENT on a fully-synced, fully-scored account sees campaigns,
// receives health: null, lands on zero bands — and the page told it
// "Building confidence… No campaigns have enough data to score yet" about an
// account that was scored. An absence caused by AUTHORIZATION, reported as one
// caused by DATA.
describe('OverviewView — a CLIENT is told what it actually cannot see', () => {
  const asClient = () => {
    useCollabRole.mockReturnValue({ role: WORKSPACE_ROLE.CLIENT });
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    // exactly what the 403 branch of useAccountHealth produces
    useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, refetch: vi.fn() });
  };

  it('does not claim the account has nothing worth scoring', () => {
    asClient();
    renderView();
    expect(screen.queryByText('Building confidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/enough data to score yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Verdicts appear once enough signal/)).not.toBeInTheDocument();
  });

  it('says the limit is the access level', () => {
    asClient();
    renderView();
    expect(screen.getByText('Portfolio view')).toBeInTheDocument();
    expect(screen.getByText(/verdicts aren’t shown for your access level/i)).toBeInTheDocument();
  });

  // It must not overcorrect into a reassurance it cannot back either.
  it('does not claim everything is fine', () => {
    asClient();
    renderView();
    expect(screen.queryByText(/running smoothly/i)).not.toBeInTheDocument();
  });

  // A STRATEGIST on the same empty-band data is a DIFFERENT fact: the engine
  // really did score nothing.
  it('a STRATEGIST on the same data still gets the signal-accumulating line', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    renderView(); // default role is STRATEGIST
    expect(screen.getByText(/Verdicts appear once enough signal has accumulated/)).toBeInTheDocument();
    expect(screen.queryByText(/access level/i)).not.toBeInTheDocument();
  });
});

describe('OverviewView — first-run activation banner (wires the onboarding flag)', () => {
  it('firstActivation flag + no data → banner shows, and REPLACES the generic empty state', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('first-run')).toBeInTheDocument();
    // one call-to-action, not two: the generic empty-state hero is suppressed
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
  });

  it('no flag (returning user) + no data → generic empty state, never the banner', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
    expect(screen.getByText(/No campaign data yet/i)).toBeInTheDocument();
  });

  it('flag set but data exists → banner hidden AND the flag is retired (never resurfaces)', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('marcom:firstActivation')).toBeNull();
  });

  it('flag set but still loading → banner not shown yet (waits for the data verdict)', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: true });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: true, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
  });

  // PR#299: the no-data story now sits inside the hero's LEARNING state. The
  // gate is a tautology for this banner (it already requires !hasAnyData), so
  // this pins that grouping without changing when it appears.
  it('is grouped under the LEARNING hero, never beside a scored account', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    const { container } = renderView();

    expect(screen.getByText('Building confidence')).toBeInTheDocument();
    const all = [...container.querySelectorAll('*')];
    const hero = all.findIndex((n) => n.children.length === 0 && n.textContent.trim() === 'Building confidence');
    expect(all.indexOf(screen.getByTestId('first-run'))).toBeGreaterThan(hero);
  });
});

describe('OverviewView — post-first-sync revenue onboarding banner', () => {
  const SYNCED = {
    data: { connections: [{ platform: 'META', lastSyncedAt: '2026-07-16T00:00:00Z' }] },
    loading: false, error: null, refetch: vi.fn(),
  };
  const NEVER_SYNCED = {
    data: { connections: [{ platform: 'META', lastSyncedAt: null }] },
    loading: false, error: null, refetch: vi.fn(),
  };
  const withCampaigns = (rows) => ({ campaigns: rows, loading: false, error: null, refetch: vi.fn() });

  it('synced + campaigns scored + no revenue + STRATEGIST → banner shows', () => {
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.getByTestId('revenue-onboarding')).toBeInTheDocument();
  });

  it('no channel has ever synced → banner hidden (nothing to capture revenue against)', () => {
    useConnections.mockReturnValue(NEVER_SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('revenue data already present → banner auto-hidden', () => {
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([{ ...CONNECTOR_ROW, revenueMinor: 250000 }]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('dismissed this session (sessionStorage) → banner hidden', () => {
    sessionStorage.setItem('lumi:revenue-prompt-dismissed', '1');
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('CLIENT role → banner hidden (only a strategist can upload revenue)', () => {
    useCollabRole.mockReturnValue({ role: WORKSPACE_ROLE.CLIENT });
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('pre-sync first-run state (no campaigns yet) → revenue banner defers', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([])); // no campaigns → FirstRunBanner territory
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  // PR#299 premise correction. This banner requires hasConnectorData, and an
  // account with scored connector campaigns is ACTION_REQUIRED / WATCH_CLOSELY /
  // PERFORMING_WELL — never LEARNING. Gating it on the LEARNING state (as the
  // other two onboarding blocks are) would hide it in exactly the case it was
  // built for: synced, scored, no revenue yet.
  it('still shows on a SCORED account — it is not gated on the LEARNING state', () => {
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    useAccountHealth.mockReturnValue({ health: { campaigns: [
      { entityId: 'c1', name: 'Eid Sale', verdict: 'KILL', impactScore: 8 },
    ] }, loading: false, error: null, refetch: vi.fn() });
    renderView();

    // The hero is decidedly NOT learning…
    expect(screen.getByText('Needs your call')).toBeInTheDocument();
    expect(screen.queryByText('Building confidence')).not.toBeInTheDocument();
    // …and the revenue ask survives it.
    expect(screen.getByTestId('revenue-onboarding')).toBeInTheDocument();
  });
});

// ── PR#302: mission-control layout ──────────────────────────
// Two columns from lg up. The rail is NOT `hidden lg:block`: channel health and
// calibration explain WHY the decisions read the way they do, so on a narrow
// window they stack under the main column rather than disappearing.
describe('OverviewView — two-column layout', () => {
  const withConnector = () => useConnectorCampaigns.mockReturnValue({
    campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn(),
  });
  const mixedHealth = () => useAccountHealth.mockReturnValue({ health: { campaigns: [
    { entityId: 'c1', name: 'Eid Sale', verdict: 'KILL', impactScore: 6 },
    { entityId: 'c2', name: 'Retarget', verdict: 'WATCH', impactScore: 9 },
  ] }, loading: false, error: null, refetch: vi.fn() });

  it('renders a single aside for the rail', () => {
    withConnector();
    const { container } = renderView();
    expect(container.querySelectorAll('aside')).toHaveLength(1);
  });

  it('the grid goes two-column only at lg', () => {
    withConnector();
    const { container } = renderView();
    const grid = container.querySelector(String.raw`[class*="lg:grid-cols-[1fr_280px]"]`);
    expect(grid).toBeTruthy();
    expect(grid.className).toContain("lg:grid");
    // no unprefixed grid-cols → mobile stays one column
    expect(grid.className).not.toMatch(/(^|\s)grid-cols-/);
  });

  it('the rail is never hidden — it stacks on narrow screens', () => {
    withConnector();
    const { container } = renderView();
    expect(container.querySelector('aside').className).not.toContain('hidden');
  });

  it('the rail carries channels and calibration, not the decisions', () => {
    withConnector();
    mixedHealth();
    useAccuracy.mockReturnValue({ surface: { gated: true, headline: 'x', scored: 0, needed: 30 } });
    const { container } = renderView();
    const aside = container.querySelector('aside');
    expect(aside.textContent).toContain('Channels');
    expect(aside.textContent).toContain('Decision Calibration');
    expect(aside.textContent).not.toContain('Act now');
  });

  it('the hero and every band stay in the main column', () => {
    withConnector();
    mixedHealth();
    const { container } = renderView();
    const aside = container.querySelector('aside');
    expect(aside.contains(screen.getByRole('heading', { level: 1 }))).toBe(false);
    expect(aside.textContent).not.toContain('Eid Sale');
  });

  // The hero's "Review decisions →" needs a live target.
  it('the Act-now section carries the anchor the hero CTA points at', () => {
    withConnector();
    mixedHealth();
    const { container } = renderView();
    expect(container.querySelector('#act-now')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review decisions/ })).toHaveAttribute('href', '#act-now');
  });
});
