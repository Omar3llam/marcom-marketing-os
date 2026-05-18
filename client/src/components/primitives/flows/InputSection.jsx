// ============================================================
// InputSection — Semantic Input Container
// ============================================================
// Purpose-driven wrapper for decision input fields.
// Provides cognitive context boundary for field groups.
//
// Philosophy:
//   - Describes decision context, not form layout
//   - Semantic grouping over visual boxes
//   - Executive intake over form builder
// ============================================================
import { cn } from '@/lib/utils.js';

/**
 * @typedef {'primary' | 'constraint' | 'context'} InputSectionIntent
 * @typedef {'default' | 'compact'} InputSectionDensity
 */

/**
 * Semantic container for related decision inputs.
 *
 * @param {Object} props
 * @param {InputSectionIntent} [props.intent='primary'] - Semantic purpose of this input group
 * @param {InputSectionDensity} [props.density='default'] - Visual density
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function InputSection({
  intent = 'primary',
  density = 'default',
  children,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        'rounded-xl transition-colors',
        // Intent-based semantics (no heavy borders)
        intent === 'primary' && 'bg-lumi-elevated/50',
        intent === 'constraint' && 'bg-lumi-elevated/30',
        intent === 'context' && 'bg-transparent',
        // Density
        density === 'default' && 'p-4 space-y-4',
        density === 'compact' && 'p-3 space-y-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
