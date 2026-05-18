import { forwardRef } from 'react';
import { Text } from '../core/Text';

// ============================================================
// BodySubtle — Semantic Typography Primitive
// ============================================================
// Purpose: Tertiary body text, disclaimers, footnotes.
// Replaces: text-gray-500, text-xs
// Default tag: p (override with `as` prop for semantic HTML)
//
// Usage:
//   <BodySubtle>Terms apply</BodySubtle>
//   <BodySubtle as="small">Beta feature</BodySubtle>
// ============================================================

export const BodySubtle = forwardRef(function BodySubtle(
  { as = 'p', ...props },
  ref
) {
  return (
    <Text
      ref={ref}
      as={as}
      variant="body"
      intent="subtle"
      {...props}
    />
  );
});
