import { forwardRef } from 'react';
import { Text } from '../core/Text';

// ============================================================
// BodyMuted — Semantic Typography Primitive
// ============================================================
// Purpose: Secondary body text, explanations, helper text.
// Replaces: text-gray-400, text-gray-500, text-sm
// Default tag: p (override with `as` prop for semantic HTML)
//
// Usage:
//   <BodyMuted>Last updated 2 hours ago</BodyMuted>
//   <BodyMuted as="span">Optional field</BodyMuted>
// ============================================================

export const BodyMuted = forwardRef(function BodyMuted(
  { as = 'p', ...props },
  ref
) {
  return (
    <Text
      ref={ref}
      as={as}
      variant="body"
      intent="muted"
      {...props}
    />
  );
});
