// ============================================================
// Phase 9 — Agentic OS Shell: the two-band home
// ------------------------------------------------------------
//   • agendaItemRoute() routes each item type to the surface that owns its full
//     context (and never executes from home).
//   • AgendaItem shows the backend's exact human verb + a "backed by {type}"
//     chip only when a real row backs it.
//   • AgendaBand shows an honest per-band empty state (never hides a band).
//   • LoopStatusRing reflects health, gates the single sweep button to operators,
//     and nudges on STALLED.
//   • AgenticShellView is role-aware: BUYER (ring + buyer band), STRATEGIST
//     (ring + both bands), CLIENT (strategist band only, no ring), plus honest
//     loading/error states.
//   • The contract seam safeParses a representative home envelope.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/hooks/useHome.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useHome.js')>();
  return { ...actual, useHome: vi.fn() };
});
vi.mock('@/hooks/useCollabRole.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useCollabRole.js')>();
  return { ...actual, useCollabRole: vi.fn() };
});
vi.mock('@/hooks/useRunSweep.js', () => ({
  useRunSweep: () => ({ runSweep: vi.fn().mockResolvedValue({}), sweeping: false, error: null }),
}));

import AgendaItem, { agendaItemRoute } from '../components/AgendaItem.jsx';
import AgendaBand from '../components/AgendaBand.jsx';
import LoopStatusRing from '../components/LoopStatusRing.jsx';
import AgenticShellView from '../AgenticShellView.jsx';
import { useHome } from '@/hooks/useHome.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { AgentHomeSchema } from '@/contracts/schemas';
import { appRoutes } from '@/app/routeManifest.js';

const item = (over = {}) => ({
  id: 'verdict:d1', band: 'BUYER', type: 'VERDICT', title: 'KILL Cold #1',
  rationale: 'Frequency over ceiling', severity: 'HIGH', evidenceRef: 'd1',
  humanAction: 'confirm', entityId: 'as1', impactScore: 9, ...over,
});
// The backend NAMES its own bands and the contract carries the string
// (AgendaBandViewSchema.title). The fixture used a placeholder because the view
// discarded it; it now uses the server's label, so the fixture carries the real
// one — AgentHomeService.buildStrategistBand.
const STRATEGIST_TITLE = 'How the portfolio is tracking to goal';
const bandView = (items: unknown[] = [], title = STRATEGIST_TITLE) =>
  ({ title, items, count: items.length, empty: items.length === 0 });

const loop = {
  stageStatus: [
    { stage: 'PLAN', state: 'ACTIVE', lastAt: new Date().toISOString(), count: 1 },
    { stage: 'EXECUTE', state: 'STALE', lastAt: null, count: 0 },
  ],
  closed: false, staleStages: ['EXECUTE'], loopHealth: 'HEALTHY',
  lastRunAt: new Date().toISOString(), nextRunAt: null, intervalMs: 900000,
};

const home = {
  role: 'STRATEGIST', summary: '1 to decide, 1 to steer.',
  buyerBand: bandView([item()]),
  strategistBand: bandView([item({ id: 'goal:g1', band: 'STRATEGIST', type: 'PLAN_ADJUSTMENT', title: 'Goal blendedCac off track', severity: 'HIGH', humanAction: 'adjust', evidenceRef: 'g1' })]),
  loop,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCollabRole).mockReturnValue({ role: WORKSPACE_ROLE.STRATEGIST } as never);
  vi.mocked(useHome).mockReturnValue({ home, isStale: false, isLoading: false, error: null, refetch: vi.fn() } as never);
});

describe('agendaItemRoute — navigates to the owning surface (never executes)', () => {
  it('routes each item type to its surface', () => {
    // A VERDICT deep-links to its campaign row (?entity=); other types keep their surface.
    expect(agendaItemRoute(item({ type: 'VERDICT' }))).toBe(`${appRoutes.campaigns}?entity=as1`);
    expect(agendaItemRoute(item({ type: 'VERDICT', entityId: null }))).toBe(appRoutes.campaigns);
    expect(agendaItemRoute(item({ type: 'TEST' }))).toBe(appRoutes.testing);
    expect(agendaItemRoute(item({ type: 'FATIGUE' }))).toBe(appRoutes.insights);
    expect(agendaItemRoute(item({ type: 'PACING' }))).toBe(appRoutes.insights);
  });
  it('sends a goal adjustment to Insights but the blended gap to Blended Truth', () => {
    expect(agendaItemRoute(item({ type: 'PLAN_ADJUSTMENT', id: 'goal:g1' }))).toBe(appRoutes.insights);
    expect(agendaItemRoute(item({ type: 'PLAN_ADJUSTMENT', id: 'blended:gap' }))).toBe(appRoutes.blendedTruth);
  });
});

describe('AgendaItem — verb + evidence honesty', () => {
  it('shows the backend human verb and a backed-by chip when a row backs it', () => {
    render(<AgendaItem item={item({ humanAction: 'confirm', type: 'VERDICT', evidenceRef: 'd1' })} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    // C-13/F-5 — this line read /backed by guardrail/i, and it passed because
    // the label was the hardcoded string 'guardrail' for EVERY verdict. The
    // fixture carries no decisionClass, so what it was really pinning was the
    // defect: an unclassified verdict claiming a policy breach backed it.
    // Unclassified now degrades to "decision" — true of every case it covers.
    expect(screen.getByText(/backed by decision/i)).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
  });

  it('omits the evidence chip when nothing backs the claim', () => {
    render(<AgendaItem item={item({ evidenceRef: null })} />);
    expect(screen.queryByText(/backed by/i)).not.toBeInTheDocument();
  });

  it('navigates to the owning surface on click (no execution)', () => {
    render(<AgendaItem item={item({ type: 'VERDICT' })} />);
    fireEvent.click(screen.getByRole('button'));
    // Deep-links to the specific campaign row, not just the list.
    expect(navigateMock).toHaveBeenCalledWith(`${appRoutes.campaigns}?entity=as1`);
  });

  it('shows the Impact chip when the item carries a score (the Campaigns-page lever)', () => {
    render(<AgendaItem item={item({ impactScore: 9 })} />);
    expect(screen.getByText(/impact 9\/10/i)).toBeInTheDocument();
  });

  it('omits the Impact chip when impactScore is null (never a fabricated 0)', () => {
    render(<AgendaItem item={item({ impactScore: null })} />);
    expect(screen.queryByText(/impact \d+\/10/i)).not.toBeInTheDocument();
  });
});

describe('AgendaBand — honest, never-hidden empty states', () => {
  it('renders the buyer empty copy when there are no items', () => {
    render(<AgendaBand band="BUYER" data={bandView([])} />);
    expect(screen.getByText(/No urgent decisions — radar monitoring active/i)).toBeInTheDocument();
  });
  it('renders the strategist empty copy when there are no items', () => {
    render(<AgendaBand band="STRATEGIST" data={bandView([])} />);
    expect(screen.getByText(/Portfolio on track — no adjustments needed/i)).toBeInTheDocument();
  });
  it('renders items with a count when present', () => {
    render(<AgendaBand band="BUYER" data={bandView([item()])} />);
    expect(screen.getByText('KILL Cold #1')).toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  // The band used to hardcode "Portfolio health", discarding the title the
  // backend sends. That name sits one word away from the "Account health" KPI
  // card, which is a different number on a different substrate — the
  // deterministic health score, not the sweep's portfolio agenda.
  it('uses the title the server sent, not a hardcoded one', () => {
    render(<AgendaBand band="STRATEGIST" data={bandView([], 'Tracking to a Q3 CAC goal')} />);
    expect(screen.getByText('Tracking to a Q3 CAC goal')).toBeInTheDocument();
  });

  it('falls back to its own label when the server sends none', () => {
    render(<AgendaBand band="STRATEGIST" data={{ items: [], count: 0, empty: true }} />);
    expect(screen.getByText(STRATEGIST_TITLE)).toBeInTheDocument();
  });

  it('never reads as the Account health KPI card', () => {
    render(<AgendaBand band="STRATEGIST" data={bandView([])} />);
    expect(screen.queryByText('Portfolio health')).not.toBeInTheDocument();
  });
});

describe('LoopStatusRing — health + the single sweep control', () => {
  it('shows the health label and a six-stage strip in the full variant', () => {
    render(<LoopStatusRing loop={loop} summary="all good" canRunSweep compact={false} />);
    expect(screen.getByText('Loop healthy')).toBeInTheDocument();
    expect(screen.getByText('PLAN')).toBeInTheDocument();
    expect(screen.getByText('EXECUTE')).toBeInTheDocument();
  });
  it('hides the sweep button for a non-operator', () => {
    render(<LoopStatusRing loop={loop} summary="" canRunSweep={false} />);
    expect(screen.queryByRole('button', { name: /run a sweep now/i })).not.toBeInTheDocument();
  });
  it('nudges on STALLED for an operator', () => {
    render(<LoopStatusRing loop={{ ...loop, loopHealth: 'STALLED' }} summary="" canRunSweep />);
    expect(screen.getByText(/Loop stalled — run a manual sweep/i)).toBeInTheDocument();
  });
});

describe('AgenticShellView — role-aware composition', () => {
  it('STRATEGIST sees the ring + the portfolio band', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: WORKSPACE_ROLE.STRATEGIST } as never);
    render(<AgenticShellView />);
    expect(screen.getByText('Loop healthy')).toBeInTheDocument();
    expect(screen.getByText(STRATEGIST_TITLE)).toBeInTheDocument();
  });

  it('BUYER sees the ring alone — no strategist band', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: WORKSPACE_ROLE.BUYER } as never);
    render(<AgenticShellView />);
    expect(screen.getByText('Loop healthy')).toBeInTheDocument();
    expect(screen.queryByText(STRATEGIST_TITLE)).not.toBeInTheDocument();
  });

  it('CLIENT sees the portfolio band only — no ring', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: WORKSPACE_ROLE.CLIENT } as never);
    vi.mocked(useHome).mockReturnValue({ home: { ...home, buyerBand: null }, isStale: false, isLoading: false, error: null, refetch: vi.fn() } as never);
    render(<AgenticShellView />);
    expect(screen.queryByText('Loop healthy')).not.toBeInTheDocument();
    expect(screen.getByText(STRATEGIST_TITLE)).toBeInTheDocument();
  });

  // The shell used to render the buyer band too. Home's own Act now / Keep
  // watching / Doing well bands cover the same verdicts, ranked and capped —
  // rendering both asked for the same decision twice, and the uncapped copy
  // (48 unranked items) buried the ranked one.
  it.each([WORKSPACE_ROLE.STRATEGIST, WORKSPACE_ROLE.BUYER])(
    'never renders the buyer band, whatever the role (%s)', (role) => {
      vi.mocked(useCollabRole).mockReturnValue({ role } as never);
      render(<AgenticShellView />);
      expect(screen.queryByText("Today's decisions")).not.toBeInTheDocument();
      expect(screen.queryByText('KILL Cold #1')).not.toBeInTheDocument();
    });

  it('shows a loading skeleton then an honest error', () => {
    vi.mocked(useHome).mockReturnValue({ home: null, isStale: false, isLoading: true, error: null, refetch: vi.fn() } as never);
    const { rerender } = render(<AgenticShellView />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();

    vi.mocked(useHome).mockReturnValue({ home: null, isStale: false, isLoading: false, error: new Error('x'), refetch: vi.fn() } as never);
    rerender(<AgenticShellView />);
    expect(screen.getByText(/Couldn.t load your agenda/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs a decision right now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Portfolio on track/i)).not.toBeInTheDocument();
  });

  it.each([409, 503])('workspace %s is never complete Home content', (httpStatus) => {
    const error = Object.assign(new Error('workspace'), { httpStatus, code: httpStatus === 409 ? 'NoWorkspace' : 'PLATFORM_ERROR' });
    vi.mocked(useHome).mockReturnValue({ home: null, isStale: false, isLoading: false, error, refetch: vi.fn() } as never);
    render(<AgenticShellView />);
    if (httpStatus === 409) expect(screen.getByText(/agenda is not configured/i)).toBeInTheDocument();
    else {
      expect(screen.getByText(/Couldn.t load your agenda/i)).toBeInTheDocument();
      expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Loop healthy')).not.toBeInTheDocument();
    expect(screen.queryByText(STRATEGIST_TITLE)).not.toBeInTheDocument();
  });
});

describe('contract seam — the home envelope safeParses', () => {
  it('AgentHomeSchema validates a representative envelope', () => {
    expect(AgentHomeSchema.safeParse(home).success).toBe(true);
  });
  it('accepts a CLIENT envelope with a null buyer band', () => {
    expect(AgentHomeSchema.safeParse({ ...home, buyerBand: null }).success).toBe(true);
  });
});
