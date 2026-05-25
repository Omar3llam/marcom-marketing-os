// ============================================================
// ArtifactCard Component Tests — PR #36
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactCard } from './ArtifactCard.jsx';

describe('ArtifactCard Component — PR #36', () => {
  const mockArtifact = {
    id: 'artifact-1',
    type: 'ad_copy',
    nodeId: 'node-123',
    size: 1024,
    createdAt: '2026-05-25T10:00:00Z',
    content: 'This is test ad copy content that will be displayed in the card.',
    metadata: {
      platform: 'facebook',
      format: 'carousel',
    },
    approval: {
      id: 'approval-1',
      status: 'PENDING',
    },
  };

  it('should render artifact metadata', () => {
    render(<ArtifactCard artifact={mockArtifact} />);

    expect(screen.getAllByText(/Ad Copy/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/Node: node-123/i)).toBeInTheDocument();
    expect(screen.getByText(/1.0 KB/i)).toBeInTheDocument();
    expect(screen.getByText(/PENDING/i)).toBeInTheDocument();
  });

  it('should show truncated content when collapsed', () => {
    const longContent = 'A'.repeat(300);
    const artifact = { ...mockArtifact, content: longContent };

    render(<ArtifactCard artifact={artifact} />);

    const contentElement = screen.getByText(/A{200,}\.\.\./, { exact: false });
    expect(contentElement).toBeInTheDocument();
    expect(contentElement.textContent).toHaveLength(203); // 200 chars + "..."
  });

  it('should expand/collapse content on button click', () => {
    render(<ArtifactCard artifact={mockArtifact} />);

    const expandButton = screen.getByRole('button', { name: /expand content/i });
    expect(expandButton).toBeInTheDocument();

    // Click to expand
    fireEvent.click(expandButton);

    const collapseButton = screen.getByRole('button', { name: /collapse content/i });
    expect(collapseButton).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(collapseButton);

    expect(screen.getByRole('button', { name: /expand content/i })).toBeInTheDocument();
  });

  it('should call onExpand callback when toggled', () => {
    const onExpand = vi.fn();
    render(<ArtifactCard artifact={mockArtifact} onExpand={onExpand} />);

    const expandButton = screen.getByRole('button', { name: /expand content/i });
    fireEvent.click(expandButton);

    expect(onExpand).toHaveBeenCalledWith(true);

    const collapseButton = screen.getByRole('button', { name: /collapse content/i });
    fireEvent.click(collapseButton);

    expect(onExpand).toHaveBeenCalledWith(false);
  });

  it('should display metadata when present', () => {
    render(<ArtifactCard artifact={mockArtifact} />);

    expect(screen.getByText(/platform/i)).toBeInTheDocument();
    expect(screen.getByText(/facebook/i)).toBeInTheDocument();
    expect(screen.getByText(/format/i)).toBeInTheDocument();
    expect(screen.getByText(/carousel/i)).toBeInTheDocument();
  });

  it('should show completed decision when approval is completed', () => {
    const completedArtifact = {
      ...mockArtifact,
      approval: {
        id: 'approval-1',
        status: 'COMPLETED',
        decision: 'APPROVED',
        feedback: 'Looks great!',
      },
    };

    render(<ArtifactCard artifact={completedArtifact} />);

    expect(screen.getByText(/Decision: APPROVED/i)).toBeInTheDocument();
    expect(screen.getByText(/Looks great!/i)).toBeInTheDocument();
  });

  it('should handle different artifact types', () => {
    const visualBrief = { ...mockArtifact, type: 'visual_brief' };
    const { rerender } = render(<ArtifactCard artifact={visualBrief} />);

    expect(screen.getByText(/Visual Brief/i)).toBeInTheDocument();

    rerender(<ArtifactCard artifact={{ ...mockArtifact, type: 'hook' }} />);
    expect(screen.getByText(/Hook/i)).toBeInTheDocument();
  });

  it('should handle missing content gracefully', () => {
    const noContent = { ...mockArtifact, content: null };
    render(<ArtifactCard artifact={noContent} />);

    expect(screen.getByText(/No content available/i)).toBeInTheDocument();
  });
});
