// ============================================================
// MARCOM v4.1 — Cluster Primitive
// ------------------------------------------------------------
// Horizontal layout with wrapping (tags, metrics, badges).
// Semantic role: Inline grouping, wrappable flow.
//
// ARCHITECTURE:
// - Arranges children horizontally with gap + wrap
// - Used for: metric grids, tag clouds, action buttons
// - Provides semantic spacing (no manual margins)
// - No business logic (pure layout)
//
// USAGE:
//   <Cluster gap="sm" justify="start">
//     <Badge>HIGH</Badge>
//     <Badge>PAUSE_AND_RELAUNCH</Badge>
//   </Cluster>
// ============================================================

import type { ReactNode } from 'react';

export interface ClusterProps {
  children: ReactNode;
  /**
   * Gap between items.
   */
  gap?: 'xs' | 'sm' | 'md' | 'lg';
  /**
   * Justification (main axis).
   */
  justify?: 'start' | 'center' | 'end' | 'space-between';
  /**
   * Alignment (cross axis).
   */
  align?: 'start' | 'center' | 'end' | 'baseline';
  /**
   * Allow wrapping.
   */
  wrap?: boolean;
}

/**
 * Cluster — Horizontal layout with wrapping.
 *
 * Semantic role: Inline grouping, wrappable flow.
 * Replaces: <div className="flex flex-wrap gap-2">
 */
export function Cluster({
  children,
  gap = 'md',
  justify = 'start',
  align = 'center',
  wrap = true,
}: ClusterProps) {
  const gapMap = {
    xs: 'var(--spacing-xs)',
    sm: 'var(--spacing-sm)',
    md: 'var(--spacing-md)',
    lg: 'var(--spacing-lg)',
  };

  const justifyMap = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    'space-between': 'space-between',
  };

  const alignMap = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    baseline: 'baseline',
  };

  return (
    <div
      className="cluster"
      style={{
        display: 'flex',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: gapMap[gap],
        justifyContent: justifyMap[justify],
        alignItems: alignMap[align],
      }}
    >
      {children}
    </div>
  );
}
