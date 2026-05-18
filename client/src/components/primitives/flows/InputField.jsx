// ============================================================
// InputField — Semantic Input Base Component
// ============================================================
// Base primitive for all decision input fields.
// Handles the label + input + hint pattern with semantic intent.
//
// Philosophy:
//   - Encapsulates the repeating Field pattern from InputView
//   - Intent-aware rather than generic
//   - Designed for composition, not configuration
// ============================================================
import { cn } from '@/lib/utils.js';
import { InputLabel } from './InputLabel';
import { InputHint } from './InputHint';

/**
 * Semantic input field with label and optional hint.
 *
 * @param {Object} props
 * @param {import('./InputLabel').LabelIntent} [props.labelIntent='context']
 * @param {string} props.label - Field label text
 * @param {boolean} [props.required=false]
 * @param {React.ReactNode} [props.hint] - Optional cognitive hint
 * @param {import('./InputHint').HintType} [props.hintType='guidance']
 * @param {React.ReactNode} props.children - The input element
 * @param {string} [props.className] - Wrapper className
 */
export function InputField({
  labelIntent = 'context',
  label,
  required = false,
  hint,
  hintType = 'guidance',
  children,
  className,
  ...props
}) {
  return (
    <div className={cn('space-y-1.5', className)} {...props}>
      <InputLabel intent={labelIntent} required={required}>
        {label}
      </InputLabel>
      {children}
      {hint && (
        <InputHint type={hintType}>
          {hint}
        </InputHint>
      )}
    </div>
  );
}
