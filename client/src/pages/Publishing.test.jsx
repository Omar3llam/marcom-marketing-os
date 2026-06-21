// ============================================================
// Publishing Page Tests — two-zone workflow (pending → approved)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Publishing from './Publishing.jsx';

// RecordPublishForm (rendered for real via ArtifactCard) reaches the api client
// through useRecordPublish — stub it so the firebase import chain doesn't load.
vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// Control both data sources; ArtifactCard + PendingApprovalItem stay REAL so the
// zone partitioning and the decide-link reachability are true integration checks.
let pendingState;
let approvedState;
vi.mock('../hooks/usePendingApprovals.js', () => ({
  usePendingApprovals: () => pendingState,
}));
vi.mock('../hooks/useApprovedArtifacts.js', () => ({
  useApprovedArtifacts: () => approvedState,
}));

// Control the role PendingApprovalItem reads (STRATEGIST can decide; BUYER can't).
let roleState;
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => roleState,
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

const pendingArtifact = {
  id: 'art-p1',
  type: 'hook',
  nodeId: 'node-p1',
  createdAt: '2026-06-20T10:00:00Z',
  content: 'pending hook copy',
  executionId: 'exec-1',
  approval: { id: 'ap-p1', status: 'PENDING' },
};

const approvedArtifact = {
  id: 'art-a1',
  type: 'ad_copy',
  nodeId: 'node-a1',
  size: 512,
  createdAt: '2026-06-19T10:00:00Z',
  approval: { id: 'ap-a1', status: 'COMPLETED', decision: 'APPROVED' },
};

function renderPublishing() {
  return render(
    <MemoryRouter>
      <Publishing />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pendingState = { pending: [], loading: false, error: null, refetch: vi.fn() };
  approvedState = { artifacts: [], loading: false, error: null, refetch: vi.fn() };
  roleState = { role: 'STRATEGIST' };
});

describe('Publishing — two zones', () => {
  it('renders both zone headers always, as the two stages of one workflow', () => {
    renderPublishing();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText(/Approved — record publish/)).toBeInTheDocument();
  });

  it('partitions data into the right zones and surfaces both actions', () => {
    pendingState = { pending: [pendingArtifact], loading: false, error: null, refetch: vi.fn() };
    approvedState = { artifacts: [approvedArtifact], loading: false, error: null, refetch: vi.fn() };
    renderPublishing();

    // Pending zone → decide link (STRATEGIST). Approved zone → record-publish form.
    expect(screen.getByRole('link', { name: /Review & decide/i })).toHaveAttribute(
      'href',
      '/app/approvals/exec-1',
    );
    expect(screen.getByRole('button', { name: /Record Meta publish/i })).toBeInTheDocument();
  });

  it('shows a per-zone empty message (the empty zone stays visible, not hidden)', () => {
    // Pending empty, approved has items.
    approvedState = { artifacts: [approvedArtifact], loading: false, error: null, refetch: vi.fn() };
    renderPublishing();

    expect(screen.getByText(/Nothing awaiting approval right now/i)).toBeInTheDocument();
    // Approved zone still rendered its item alongside the empty pending zone.
    expect(screen.getByRole('button', { name: /Record Meta publish/i })).toBeInTheDocument();
  });

  it('shows the other per-zone empty message when only pending has items', () => {
    pendingState = { pending: [pendingArtifact], loading: false, error: null, refetch: vi.fn() };
    renderPublishing();

    expect(screen.getByText(/No approved creative yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review & decide/i })).toBeInTheDocument();
  });

  it('loads each zone independently (pending skeleton does not blank the approved zone)', () => {
    pendingState = { pending: [], loading: true, error: null, refetch: vi.fn() };
    approvedState = { artifacts: [approvedArtifact], loading: false, error: null, refetch: vi.fn() };
    const { container } = renderPublishing();

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record Meta publish/i })).toBeInTheDocument();
  });

  it('maps a per-zone error with its own retry', () => {
    pendingState = { pending: [], loading: false, error: 'Network error', refetch: vi.fn() };
    renderPublishing();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/Couldn’t load pending approvals/i)).toBeInTheDocument();
    expect(within(alert).getByText(/Network error/i)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('gates the decide action by role — a BUYER sees an honest note, not a link', () => {
    roleState = { role: 'BUYER' };
    pendingState = { pending: [pendingArtifact], loading: false, error: null, refetch: vi.fn() };
    renderPublishing();

    expect(screen.queryByRole('link', { name: /Review & decide/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Awaiting a strategist’s approval/i)).toBeInTheDocument();
  });
});
