import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { getSignalTokens } from '@/design-system/signals/signals';

// ============================================================
// VerdictBadge — Composite State Primitive
// ============================================================
// Purpose: Verdict capsule with semantic state styling.
// Replaces: inline verdict badges with text-xl + bg-*/border-*
//
// Architecture:
//   - Composite semantic: text + surface + border + glow
//   - State-driven (not appearance-driven)
//   - Uses signals.js registry for token mapping
//
// Usage:
//   <VerdictBadge verdict="SCALE">SCALE</VerdictBadge>
//   <VerdictBadge verdict="KILL" />
//
// Why not typography primitive?
//   Verdict badges encode STATE, not just text hierarchy.
//   They bundle: color, surface, border, glow, typography.
// ============================================================

export const VerdictBadge = forwardRef(function VerdictBadge(
  {
    verdict,
    children,
    className,
    ...props
  },
  ref
) {
  const tokens = getSignalTokens(verdict);

  return (
    <div
      ref={ref}
      className={cn(
        // Base structure
        'inline-flex items-center gap-2 rounded-2xl border px-6 py-3',
        // Typography (semantic role)
        'font-display font-bold text-xl',
        // State-driven tokens from signals registry
        tokens.text,
        tokens.surface,
        tokens.border,
        tokens.glow,
        // User overrides
        className
      )}
      {...props}
    >
      {children || verdict}
    </div>
  );
});
