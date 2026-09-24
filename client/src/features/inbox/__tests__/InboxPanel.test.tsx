// ============================================================
// Phase 8 — Inbox: role-routed, pull-only, no dead ends
// ------------------------------------------------------------
//   • toItems() folds the server's role-routed envelope into one ordered list
//     (approvals → radar → narrative), each with a real CTA route, and does NOT
//     double-count the narrative (latestNarrative is the single source for it).
//   • InboxPanel renders honest states (loading / error / "all caught up") and
//     navigates + closes on select.
//   • The contract seam safeParses a representative inbox envelope.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useInbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useInbox.js')>();
  return { ...actual, useInbox: vi.fn() };
});

import { useInbox, toItems } from '@/hooks/useInbox.js';
import { InboxPanel } from '../InboxPanel.jsx';
import { InboxResponseSchema } from '@/contracts/schemas';
import { appRoutes } from '@/app/routeManifest.js';

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
  beforeEach(() => vi.mocked(useInbox).mockReturnValue({ items: [], isLoading: false, error: null, refetch: vi.fn() }));

  it('shows the all-caught-up empty state', () => {
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/You’re all caught up/i)).toBeInTheDocument();
  });

  it('renders a loading state', () => {
    vi.mocked(useInbox).mockReturnValue({ items: [], isLoading: true, error: null, refetch: vi.fn() });
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Loading your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/You’re all caught up/i)).not.toBeInTheDocument();
  });

  it('renders a user-facing error state', () => {
    vi.mocked(useInbox).mockReturnValue({ items: [], isLoading: false, error: new Error('x'), refetch: vi.fn() });
    render(<InboxPanel onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Couldn’t load your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/You’re all caught up/i)).not.toBeInTheDocument();
  });

  it('navigates to the item route and closes on select', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    vi.mocked(useInbox).mockReturnValue({ items: toItems(envelope), isLoading: false, error: null, refetch: vi.fn() });
    render(<InboxPanel onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(/New weekly report available/i));
    expect(onNavigate).toHaveBeenCalledWith(appRoutes.leadership);
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
