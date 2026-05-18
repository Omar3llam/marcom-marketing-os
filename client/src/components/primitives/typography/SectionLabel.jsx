import { forwardRef } from 'react';
import { Text } from '../core/Text';

// ============================================================
// SectionLabel — Semantic Typography Primitive
// ============================================================
// Purpose: Labels for sections, cards, or grouped content.
// Replaces: text-sm font-semibold uppercase tracking-wide
// Default tag: h3 (override with `as` prop for semantic HTML)
//
// Usage:
//   <SectionLabel>Active Campaigns</SectionLabel>
//   <SectionLabel as="div">Insights</SectionLabel>
// ============================================================

export const SectionLabel = forwardRef(function SectionLabel(
  { as = 'h3', ...props },
  ref
) {
  return (
    <Text
      ref={ref}
      as={as}
      role="section-label"
      {...props}
    />
  );
});
