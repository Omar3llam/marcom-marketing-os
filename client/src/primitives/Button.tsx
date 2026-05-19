// ============================================================
// MARCOM v4.1 — Button Primitive
// ------------------------------------------------------------
// Interactive button with semantic variants.
// Semantic role: User actions, form submissions.
//
// ARCHITECTURE:
// - Supports semantic variants (primary, secondary, danger, ghost)
// - Provides consistent spacing + colors
// - No business logic (pure interaction)
//
// USAGE:
//   <Button variant="primary" onClick={handleSave}>
//     Save Changes
//   </Button>
// ============================================================

import type { ReactNode, ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  children: ReactNode;
  /**
   * Semantic variant (affects background + text color).
   * - 'primary': Main action (blue accent)
   * - 'secondary': Secondary action (neutral)
   * - 'danger': Destructive action (red accent)
   * - 'ghost': Minimal styling (transparent)
   */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /**
   * Size.
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Loading state (disables interaction, shows loading cursor).
   */
  loading?: boolean;
}

/**
 * Button — Interactive action trigger.
 *
 * Semantic role: User actions, form submissions.
 * Replaces: <button className="bg-blue-600 hover:bg-blue-700 ...">
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  ...rest
}: ButtonProps) {
  const variantStyles = {
    primary: {
      background: 'var(--color-bg-accent-blue)',
      color: 'var(--color-text-on-accent)',
      border: 'none',
      hoverBackground: 'var(--color-bg-accent-blue-hover)',
    },
    secondary: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: '1px solid var(--color-border-default)',
      hoverBackground: 'var(--color-bg-tertiary)',
    },
    danger: {
      background: 'var(--color-status-danger)',
      color: 'var(--color-text-on-accent)',
      border: 'none',
      hoverBackground: 'var(--color-status-danger-hover)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: 'none',
      hoverBackground: 'var(--color-bg-tertiary)',
    },
  };

  const sizeStyles = {
    sm: {
      padding: 'var(--spacing-xs) var(--spacing-sm)',
      fontSize: 'var(--font-size-sm)',
    },
    md: {
      padding: 'var(--spacing-sm) var(--spacing-lg)',
      fontSize: 'var(--font-size-md)',
    },
    lg: {
      padding: 'var(--spacing-md) var(--spacing-xl)',
      fontSize: 'var(--font-size-lg)',
    },
  };

  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{
        background: variantStyle.background,
        color: variantStyle.color,
        border: variantStyle.border,
        borderRadius: 'var(--radius-md)',
        padding: sizeStyle.padding,
        fontSize: sizeStyle.fontSize,
        fontWeight: 600,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.background = variantStyle.hoverBackground;
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.background = variantStyle.background;
        }
      }}
    >
      {loading ? 'Loading...' : children}
    </button>
  );
}
