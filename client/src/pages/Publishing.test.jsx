// ============================================================
// Publishing Page Tests — incl. the PR #104 reachability check
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Publishing from './Publishing.jsx';

// RecordPublishForm (rendered for real via ArtifactCard) imports the api
// client through useRecordPublish — stub it so the firebase import chain does
// not load. The network is never hit on render; this only matters for imports.
vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// Control the data source; ArtifactCard + RecordPublishForm stay REAL so the
// reachability assertion is a true integration check.
let hookState;
vi.mock('../hooks/useApprovedArtifacts.js', () => ({
  useApprovedArtifacts: () => hookState,
}));

const approvedArtifact = {
  id: 'artifact-1',
  type: 'hook',
  nodeId: 'node-1',
  size: 512,
  createdAt: '2026-06-19T10:00:00Z',
  approval: { id: 'ap-1', status: 'COMPLETED', decision: 'APPROVED' },
};

beforeEach(() => {
  hookState = { artifacts: [], loading: false, error: null, refetch: vi.fn() };
});

describe('Publishing page', () => {
  it('shows a skeleton while loading (never a blank page)', () => {
    hookState = { artifacts: [], loading: true, error: null, refetch: vi.fn() };
    const { container } = render(<Publishing />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('shows an honest empty state when nothing is approved', () => {
    render(<Publishing />);
    expect(screen.getByText(/No approved creative yet/i)).toBeInTheDocument();
  });

  it('shows a mapped error with a retry affordance', () => {
    hookState = { artifacts: [], loading: false, error: 'Network error', refetch: vi.fn() };
    render(<Publishing />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('lists approved artifacts AND the Record Meta publish action is reachable', () => {
    hookState = { artifacts: [approvedArtifact], loading: false, error: null, refetch: vi.fn() };
    render(<Publishing />);
    // The whole point of the PR: the form (via ArtifactCard) is actually
    // rendered and reachable from real navigation, not just existing in code.
    expect(screen.getByRole('button', { name: /Record Meta publish/i })).toBeInTheDocument();
  });

  it('never offers the publish action for a non-approved artifact', () => {
    const pending = { ...approvedArtifact, approval: { status: 'PENDING', decision: null } };
    hookState = { artifacts: [pending], loading: false, error: null, refetch: vi.fn() };
    render(<Publishing />);
    expect(screen.queryByRole('button', { name: /Record Meta publish/i })).not.toBeInTheDocument();
  });
});
