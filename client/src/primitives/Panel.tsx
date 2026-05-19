// ============================================================
// MARCOM v4.1 — Panel Primitive
// ------------------------------------------------------------
// Self-contained content region with semantic boundaries.
// Semantic role: Content isolation, visual grouping.
//
// ARCHITECTURE:
// - Wraps logically related content (campaign card, alert card)
// - Provides consistent spacing + borders
// - Supports elevation levels (flat, raised, floating)
// - No business logic (pure layout)
//
// USAGE:
//   <Panel elevation="raised">
//     <h2>Campaign: Summer Sale</h2>
//     <MetricSignalGrid metrics={metrics} />
//   </Panel>
// ============================================================

import type { ReactNode } from 'react';

export interface PanelProps {
  children: ReactNode;
  /**
   * Visual elevation (affects shadow + border).
   * - 'flat': No shadow, subtle border
   * - 'raised': Light shadow, default border
   * - 'floating': Prominent shadow, strong border
   */
  elevation?: 'flat' | 'raised' | 'floating';
  /**
   * Semantic variant (affects border + background color).
   * - 'default': Standard panel colors
   * - 'error': Danger/critical state (red accent)
   * - 'warning': Warning state (yellow accent)
   * - 'success': Success state (green accent)
   */
  variant?: 'default' | 'error' | 'warning' | 'success';
  /**
   * Padding size.
   */
  padding?: 'sm' | 'md' | 'lg';
  /**
   * Optional header element.
   */
  header?: ReactNode;
  /**
   * Optional footer element.
   */
  footer?: ReactNode;
}

/**
 * Panel — Self-contained content region.
 *
 * Semantic role: Content isolation, visual grouping.
 * Replaces: <div className="bg-gray-800 rounded-lg p-6">
 */
export function Panel({
  children,
  elevation = 'raised',
  variant = 'default',
  padding = 'md',
  header,
  footer,
}: PanelProps) {
  const elevationStyles = {
    flat: {
      boxShadow: 'none',
      border: '1px solid var(--color-border-subtle)',
    },
    raised: {
      boxShadow: 'var(--shadow-sm)',
      border: '1px solid var(--color-border-default)',
    },
    floating: {
      boxShadow: 'var(--shadow-lg)',
      border: '1px solid var(--color-border-strong)',
    },
  };

  const variantStyles = {
    default: {
      borderColor: 'var(--color-border-default)',
      background: 'var(--color-bg-secondary)',
    },
    error: {
      borderColor: 'var(--color-status-danger)',
      background: 'var(--color-bg-secondary)',
    },
    warning: {
      borderColor: 'var(--color-status-warning)',
      background: 'var(--color-bg-secondary)',
    },
    success: {
      borderColor: 'var(--color-status-success)',
      background: 'var(--color-bg-secondary)',
    },
  };

  const paddingMap = {
    sm: 'var(--spacing-sm)',
    md: 'var(--spacing-md)',
    lg: 'var(--spacing-lg)',
  };

  const baseElevation = elevationStyles[elevation];
  const variantStyle = variantStyles[variant];

  return (
    <div
      className="panel"
      style={{
        background: variantStyle.background,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        boxShadow: baseElevation.boxShadow,
        border: `1px solid ${variantStyle.borderColor}`,
      }}
    >
      {header && (
        <div
          className="panel-header"
          style={{
            padding: paddingMap[padding],
            borderBottom: '1px solid var(--color-border-default)',
            background: 'var(--color-bg-tertiary)',
          }}
        >
          {header}
        </div>
      )}
      <div
        className="panel-body"
        style={{
          padding: paddingMap[padding],
        }}
      >
        {children}
      </div>
      {footer && (
        <div
          className="panel-footer"
          style={{
            padding: paddingMap[padding],
            borderTop: '1px solid var(--color-border-default)',
            background: 'var(--color-bg-tertiary)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
