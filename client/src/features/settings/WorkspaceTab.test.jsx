// ============================================================
// WorkspaceTab — plan label + upgrade path
// ------------------------------------------------------------
// The FREE plan should carry a real "See paid features" link. There is no
// in-app billing page (the /app/settings/billing section is unreachable), so
// the honest target is the public landing page's pricing anchor.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceTab } from './WorkspaceTab.jsx';

const baseProps = {
  workspaceName: 'My Workspace',
  setWorkspaceName: vi.fn(),
  workspaceChanged: false,
  handleSaveWorkspace: vi.fn(),
  busy: false,
};

describe('WorkspaceTab — plan + upgrade link', () => {
  it('shows the FREE plan pill', () => {
    render(<WorkspaceTab {...baseProps} />);
    expect(screen.getByText('✨ FREE')).toBeInTheDocument();
  });

  it('links "See paid features" to the public pricing section (a real anchor)', () => {
    render(<WorkspaceTab {...baseProps} />);
    const link = screen.getByRole('link', { name: /see paid features/i });
    expect(link).toHaveAttribute('href', '/#pricing');
  });
});
