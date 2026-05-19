// ============================================================
// MARCOM v4.1 — Shell Primitive
// ------------------------------------------------------------
// Top-level layout container (full viewport).
// Semantic role: Application boundary, FSM container.
//
// ARCHITECTURE:
// - Wraps entire app (replaces <div className="app">)
// - Houses FSM state machine
// - Provides global layout grid
// - No visual styling (delegates to children)
//
// USAGE:
//   <Shell>
//     <Navigation />
//     <Panel>{children}</Panel>
//   </Shell>
// ============================================================

import type { ReactNode } from 'react';

export interface ShellProps {
  children: ReactNode;
  /**
   * Layout mode (affects grid structure).
   * - 'full': Full viewport (decision feed, theater)
   * - 'sidebar': Left sidebar + main (settings, history)
   */
  mode?: 'full' | 'sidebar';
  /**
   * Optional navigation element.
   */
  navigation?: ReactNode;
}

/**
 * Shell — Top-level layout container.
 *
 * Semantic role: Application boundary, FSM container.
 * Replaces: <div className="min-h-screen bg-gray-900">
 */
export function Shell({ children, mode = 'full', navigation }: ShellProps) {
  return (
    <div
      className="shell"
      style={{
        display: 'grid',
        gridTemplateRows: navigation ? 'auto 1fr' : '1fr',
        gridTemplateColumns: mode === 'sidebar' ? '240px 1fr' : '1fr',
        minHeight: '100vh',
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      {navigation && (
        <nav
          style={{
            gridColumn: mode === 'sidebar' ? '1 / -1' : '1',
            gridRow: 1,
            borderBottom: '1px solid var(--color-border-default)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          {navigation}
        </nav>
      )}
      {children}
    </div>
  );
}
