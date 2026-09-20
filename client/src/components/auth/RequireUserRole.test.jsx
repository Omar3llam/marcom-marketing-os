// ============================================================
// RequireUserRole — system-ADMIN route guard
// ------------------------------------------------------------
// Errs CLOSED: renders NOTHING while the role resolves (no flash of admin
// content), then children for an ADMIN or the fallback for everyone else.
// The hook is mocked so the three states are driven directly.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useUserRole.js', async (io) => ({ ...(await io()), useUserRole: vi.fn() }));
import { useUserRole } from '@/hooks/useUserRole.js';
import RequireUserRole from './RequireUserRole.jsx';

function renderGuard() {
  return render(
    <RequireUserRole role="ADMIN" fallback={<span>nope</span>}>
      <span>secret</span>
    </RequireUserRole>,
  );
}

describe('RequireUserRole', () => {
  it('renders nothing while loading (no flash of admin content)', () => {
    useUserRole.mockReturnValue({ isAdmin: true, isLoading: true });
    const { container } = renderGuard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders children once an ADMIN resolves', () => {
    useUserRole.mockReturnValue({ isAdmin: true, isLoading: false, status: 'PRESENT' });
    renderGuard();
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders the fallback for a non-admin', () => {
    useUserRole.mockReturnValue({ isAdmin: false, isLoading: false, status: 'PRESENT' });
    renderGuard();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('nope')).toBeInTheDocument();
  });
});
