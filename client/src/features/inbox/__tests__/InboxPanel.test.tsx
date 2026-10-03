// ============================================================
// Phase 8 — Inbox: role-routed, pull-only, no dead ends
// ------------------------------------------------------------
//   • toItems() folds the server's role-routed envelope into one ordered list
//     (approvals → radar → narrative), each with a real CTA route, and does NOT
//     double-count the narrative (latestNarrative is the single source for it).
//   • InboxPanel renders honest states (loading / error / neutral empty) and
//     navigates + closes on select.
//   • The contract seam safeParses a representative inbox envelope.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useInbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useInbox.js')>();
  return { ...actual, useInbox: vi.fn() };
});

import { useInbox, toItems, inboxReadState } from '@/hooks/useInbox.js';
import { InboxPanel } from '../InboxPanel.jsx';
import { InboxResponseSchema } from '@/contracts/schemas';
import { appRoutes } from '@/app/routeManifest.js';

const mockInbox = (state: { items: unknown[]; isLoading: boolean; error: Error | null; refetch: ReturnType<typeof vi.fn> }) =>
  vi.mocked(useInbox).mockReturnValue({ ...state, ...inboxReadState(state) });

const envelope = {
  workspaceId: 'ws', role: 'STRATEGIST',
  alerts: [
    { kind: 'RADAR', id: 'd1', verdict: 'KILL', headline: 'Cold #3 bleeding — kill', severity: 'HIGH' },
    { kind: 'NARRATIVE', id: 'n1', headline: 'Weekly report', severity: 'LOW' },
  ],
  severity: { LOW: 1, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
  latestNarrative: { id: 'n1', headline: '3 actions this period', period: 'WEEKLY', confidenceScore: 72, createdAt: new Date().toISOString() },
  pendingApprovals: [{ id: 'a1', planId: 'p1', subjectType: 'PLAN', subjectId: 'p1', state: 'PENDING', createdAt: new Date().toISOString() }],
};

describe('toItems — fold the routed envelope into one ordered list', () => {
  const items = toItems(envelope);

  it('orders approvals → radar → narrative, each with a real route', () => {
    expect(items.map((i) => i.type)).toEqual(['approval', 'radar', 'narrative']);
    expect(items[0].to).toBe(appRoutes.insights);   // approval → Growth Strategy board
    expect(items[1].to).toBe(appRoutes.overview);   // radar → Overview
    expect(items[2].to).toBe(appRoutes.leadership); // narrative → Reports
  });

  it('does NOT double-count the narrative (latestNarrative is its only source)', () => {
    expect(items.filter((i) => i.type === 'narrative')).toHaveLength(1);
  });

  it('carries the radar verdict and omits a fabricated timestamp for it', () => {
    expect(items[1].verdict).toBe('KILL');
    expect(items[1].at).toBeNull();
  });
});

describe('InboxPanel — honest states + actionable navigation', () => {
  beforeEach(() => mockInbox({ items: [], isLoading: false, error: null, refetch: vi.fn() }));

  it('shows a neutral empty state without claiming acknowledgement', () => {
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/No items to show right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/caught up|reviewed|acknowledged|completed|resolved/i)).not.toBeInTheDocument();
  });

  it('renders a loading state', () => {
    mockInbox({ items: [], isLoading: true, error: null, refetch: vi.fn() });
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Loading your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/No items to show right now/i)).not.toBeInTheDocument();
  });

  it('renders a user-facing error state', () => {
    mockInbox({ items: [], isLoading: false, error: new Error('x'), refetch: vi.fn() });
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Couldn’t load your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/No items to show right now/i)).not.toBeInTheDocument();
  });

  it.each([
    { httpStatus: 409, code: 'RoleNotConfigured', context: { roleReason: 'ROLE_UNSET' } },
    { response: { status: 409, data: { error: 'RoleNotConfigured', roleReason: 'ROLE_UNSET' } } },
  ])('missing-role evidence %j renders configuration truth with no retry', (details) => {
    const error = Object.assign(new Error('refused'), details);
    mockInbox({ items: [], isLoading: false, error, refetch: vi.fn() });
    render(<InboxPanel />);
    expect(screen.getByText('Your inbox isn’t available until this seat has a collaboration role.')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load|No items to show|No workspace|temporarily/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry inbox/ })).not.toBeInTheDocument();
  });

  it.each([
    { httpStatus: 503, code: 'PLATFORM_ERROR', context: { roleReason: 'ROLE_LOOKUP_FAILED' } },
    { response: { status: 503, data: { error: 'RoleUnavailable', roleReason: 'ROLE_LOOKUP_FAILED' } } },
  ])('role lookup failure %j reports read unavailability and invokes retry', (details) => {
    const refetch = vi.fn();
    mockInbox({ items: [], isLoading: false, error: Object.assign(new Error('failed'), details), refetch });
    render(<InboxPanel />);
    expect(screen.getByText('Lumi couldn’t determine your inbox access right now.')).toBeInTheDocument();
    expect(screen.queryByText(/collaboration role|No items to show|No workspace|refused/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry inbox' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each(['ROLE_UNKNOWN', 'ROLE_IDENTITY_MISSING'])('permanent unresolved role %s does not invent setup or retry', (roleReason) => {
    const error = Object.assign(new Error('failed'), { httpStatus: 503, context: { roleReason } });
    mockInbox({ items: [], isLoading: false, error, refetch: vi.fn() });
    render(<InboxPanel />);
    expect(screen.getByText('Your inbox access could not be established for this seat.')).toBeInTheDocument();
    expect(screen.queryByText(/collaboration role|No items to show|No workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry inbox/ })).not.toBeInTheDocument();
  });

  it.each([{ httpStatus: 403 }, { response: { status: 403 } }])('generic refusal %j is explicit and non-retryable', (details) => {
    mockInbox({ items: [], isLoading: false, error: Object.assign(new Error('denied'), details), refetch: vi.fn() });
    render(<InboxPanel />);
    expect(screen.getByText('This inbox cannot be accessed for this request.')).toBeInTheDocument();
    expect(screen.queryByText(/role|workspace|plan|No items to show|Couldn’t load/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry inbox/ })).not.toBeInTheDocument();
  });

  it.each([
    Object.assign(new Error('InboxUnavailable'), { httpStatus: 500 }),
    new Error('offline'),
  ])('transient Inbox failure %j retains generic unavailable copy and retry', (error) => {
    mockInbox({ items: [], isLoading: false, error, refetch: vi.fn() });
    render(<InboxPanel />);
    expect(screen.getByText(/Couldn’t load your inbox/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry inbox' })).toBeInTheDocument();
    expect(screen.queryByText(/No items to show/i)).not.toBeInTheDocument();
  });

  it('contract failure is not empty and cannot offer a transport retry', () => {
    const error = new Error('Inbox response failed contract validation');
    mockInbox({ items: [], isLoading: false, error, refetch: vi.fn() });
    render(<InboxPanel />);
    expect(screen.getByText(/Couldn’t load your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/No items to show/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry inbox' })).not.toBeInTheDocument();
  });

  it.each([409, 503])('workspace %s stays separate from successful empty Inbox', (httpStatus) => {
    const error = Object.assign(new Error('workspace'), { httpStatus, code: httpStatus === 409 ? 'NoWorkspace' : 'PLATFORM_ERROR' });
    mockInbox({ items: [], isLoading: false, error, refetch: vi.fn() });
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    if (httpStatus === 409) expect(screen.getByText(/inbox is not configured/i)).toBeInTheDocument();
    else {
      expect(screen.getByText(/Couldn’t load your inbox/i)).toBeInTheDocument();
      expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/No items to show right now/i)).not.toBeInTheDocument();
  });

  it.each([
    [/Approval needed/, appRoutes.insights],
    [/Cold #3 bleeding/, appRoutes.overview],
    [/New weekly report available/i, appRoutes.leadership],
  ])('navigates from %s to %s and closes on select', (title, destination) => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    mockInbox({ items: toItems(envelope), isLoading: false, error: null, refetch: vi.fn() });
    render(<InboxPanel onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(title));
    expect(onNavigate).toHaveBeenCalledWith(destination);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('contract seam — the inbox envelope safeParses', () => {
  it('InboxResponseSchema validates a representative envelope', () => {
    expect(InboxResponseSchema.safeParse(envelope).success).toBe(true);
  });
  it('tolerates a sparse inbox (no narrative, no approvals)', () => {
    expect(InboxResponseSchema.safeParse({ workspaceId: 'ws', role: 'BUYER', alerts: [] }).success).toBe(true);
  });
});
