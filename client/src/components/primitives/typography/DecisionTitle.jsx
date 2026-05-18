import { forwardRef } from 'react';
import { Text } from '../core/Text';

// ============================================================
// DecisionTitle — Semantic Typography Primitive
// ============================================================
// Purpose: Main title for decision states, sections, or flows.
// Replaces: text-xl, font-semibold
// Default tag: h2 (override with `as` prop for semantic HTML)
//
// Usage:
//   <DecisionTitle>Campaign Analysis</DecisionTitle>
//   <DecisionTitle as="h1">Executive Summary</DecisionTitle>
// ============================================================

export const DecisionTitle = forwardRef(function DecisionTitle(
  { as = 'h2', ...props },
  ref
) {
  return (
    <Text
      ref={ref}
      as={as}
      role="decision-title"
      {...props}
    />
  );
});
