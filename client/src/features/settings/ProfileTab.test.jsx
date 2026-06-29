// ============================================================
// ProfileTab — email help copy
// ------------------------------------------------------------
// The email field is read-only; the help text should point users at support,
// not expose the auth provider ("managed by Firebase").
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileTab } from './ProfileTab.jsx';

const baseProps = {
  displayName: 'Omar',
  setDisplayName: vi.fn(),
  currentUser: { email: 'omar@example.com' },
  profileChanged: false,
  handleSaveProfile: vi.fn(),
  busy: false,
  getInitials: () => 'O',
};

describe('ProfileTab — email help copy', () => {
  it('directs users to support for an email change', () => {
    render(<ProfileTab {...baseProps} />);
    expect(screen.getByText('To update your email address, contact support.')).toBeInTheDocument();
  });

  it('does not leak the auth provider name to the user', () => {
    render(<ProfileTab {...baseProps} />);
    expect(screen.queryByText(/firebase/i)).not.toBeInTheDocument();
  });
});
