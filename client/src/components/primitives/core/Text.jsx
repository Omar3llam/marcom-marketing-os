import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// ============================================================
// MARCOM Semantic Text Engine
// ============================================================
// Base polymorphic text primitive with semantic role mapping.
// All typography primitives extend this core.
//
// Architecture:
//   - Polymorphic via `as` prop (h1, h2, p, span, etc.)
//   - Semantic role → CSS class mapping
//   - forwardRef-ready for animations, measurements, a11y
//
// Usage:
//   <Text role="decision-title" as="h2">Title</Text>
//   <Text role="metric-value" as="p">42.5</Text>
// ============================================================

const roleClassMap = {
  // Decision flow typography
  'decision-title':   'decision-title',
  'section-label':    'section-label',
  'body-muted':       'body-muted',
  'body-subtle':      'body-subtle',

  // Metrics and data
  'metric-value':     'metric-display',
  'verdict-number':   'verdict-number',

  // Radar and signals
  'radar-label':      'radar-label',
  'signal-label':     'signal-label',
};

export const Text = forwardRef(function Text(
  {
    as: Component = 'p',
    role,
    className,
    children,
    ...props
  },
  ref
) {
  if (!role) {
    throw new Error(
      '[Text] Missing required `role` prop. Use semantic role like "decision-title" or "metric-value".'
    );
  }

  const roleClass = roleClassMap[role];
  if (!roleClass) {
    console.warn(`[Text] Unknown role "${role}". Falling back to unstyled.`);
  }

  return (
    <Component
      ref={ref}
      className={cn(roleClass, className)}
      {...props}
    >
      {children}
    </Component>
  );
});
