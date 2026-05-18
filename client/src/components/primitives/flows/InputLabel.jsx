// ============================================================
// InputLabel — Intent-Aware Field Label
// ============================================================
// Semantic label component that describes decision intent,
// not just field name.
//
// Philosophy:
//   - "Primary Growth Objective" > "Campaign Goal"
//   - "Strategic Constraint" > "Budget"
//   - Executive language over form field language
// ============================================================
import { cn } from '@/lib/utils.js';

/**
 * @typedef {'objective' | 'constraint' | 'context' | 'risk' | 'target'} LabelIntent
 */

/**
 * Intent-aware label for decision inputs.
 *
 * @param {Object} props
 * @param {LabelIntent} [props.intent='context'] - Semantic purpose
 * @param {boolean} [props.required=false] - Whether field is required
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function InputLabel({
  intent = 'context',
  required = false,
  children,
  className,
  ...props
}) {
  return (
    <label
      className={cn(
        'block font-display font-medium tracking-tight',
        // Intent-based styling (subtle color coding)
        intent === 'objective' && 'text-lumi-accent text-sm',
        intent === 'constraint' && 'text-lumi-gold text-sm',
        intent === 'risk' && 'text-trend-danger text-sm',
        intent === 'target' && 'text-signal-scale text-sm',
        intent === 'context' && 'text-lumi-text-muted text-sm',
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="text-trend-danger ml-1" aria-label="required">*</span>}
    </label>
  );
}
