// ============================================================
// InputHint — Cognitive Guidance Layer
// ============================================================
// Provides contextual hints that improve decision quality.
// NOT tooltip. NOT helper text. Cognitive guidance.
//
// Philosophy:
//   - "More specific targets improve recommendation accuracy"
//   - "Executive-level detail preferred over tactical"
//   - Confidence hints over validation messages
// ============================================================
import { cn } from '@/lib/utils.js';

/**
 * @typedef {'guidance' | 'confidence' | 'time' | 'quality'} HintType
 */

/**
 * Cognitive guidance for decision inputs.
 *
 * @param {Object} props
 * @param {HintType} [props.type='guidance'] - Type of hint
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function InputHint({
  type = 'guidance',
  children,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        'font-mono text-xs mt-1.5',
        // Type-based styling
        type === 'guidance' && 'text-lumi-muted',
        type === 'confidence' && 'text-lumi-accent',
        type === 'time' && 'text-lumi-gold',
        type === 'quality' && 'text-signal-scale',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
