// ============================================================
// MARCOM v4.1 — Stack Primitive
// ------------------------------------------------------------
// Vertical layout with consistent spacing.
// Semantic role: Flow layout, vertical rhythm.
//
// ARCHITECTURE:
// - Arranges children vertically with gap
// - Provides semantic spacing (no manual margins)
// - Supports dividers between items
// - No business logic (pure layout)
//
// USAGE:
//   <Stack gap="md">
//     <Alert {...alert1} />
//     <Alert {...alert2} />
//   </Stack>
// ============================================================

import type { ReactNode } from 'react';

export interface StackProps {
  children: ReactNode;
  /**
   * Gap between items.
   */
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Alignment (horizontal).
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /**
   * Show dividers between items.
   */
  dividers?: boolean;
}

/**
 * Stack — Vertical layout with consistent spacing.
 *
 * Semantic role: Flow layout, vertical rhythm.
 * Replaces: <div className="space-y-4">
 */
export function Stack({ children, gap = 'md', align = 'stretch', dividers = false }: StackProps) {
  const gapMap = {
    xs: 'var(--spacing-xs)',
    sm: 'var(--spacing-sm)',
    md: 'var(--spacing-md)',
    lg: 'var(--spacing-lg)',
    xl: 'var(--spacing-xl)',
  };

  const alignMap = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    stretch: 'stretch',
  };

  return (
    <div
      className="stack"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: gapMap[gap],
        alignItems: alignMap[align],
      }}
    >
      {dividers
        ? Array.isArray(children) &&
          children.map((child, idx) => (
            <div key={idx}>
              {child}
              {idx < children.length - 1 && (
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid var(--color-border-subtle)',
                    margin: `${gapMap[gap]} 0`,
                  }}
                />
              )}
            </div>
          ))
        : children}
    </div>
  );
}
