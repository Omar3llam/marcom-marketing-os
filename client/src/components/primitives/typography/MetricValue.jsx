import { forwardRef } from 'react';
import { Text } from '../core/Text';

// ============================================================
// MetricValue — Semantic Typography Primitive
// ============================================================
// Purpose: Large numeric or metric display (ROAS, CPA, scores).
// Replaces: text-2xl, text-3xl, font-bold
// Default tag: p (override with `as` prop for semantic HTML)
//
// Usage:
//   <MetricValue>4.2x</MetricValue>
//   <MetricValue as="span">$42.50</MetricValue>
// ============================================================

export const MetricValue = forwardRef(function MetricValue(
  { as = 'p', ...props },
  ref
) {
  return (
    <Text
      ref={ref}
      as={as}
      role="metric-value"
      {...props}
    />
  );
});
