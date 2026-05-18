import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ============================================================
// MARCOM Semantic Text Engine v2.0 (CVA-Based)
// ============================================================
// Production-ready polymorphic text primitive with composable variants.
// All typography primitives extend this core via locked variant presets.
//
// Architecture:
//   - CVA-powered variant system (variant + intent + size)
//   - Polymorphic via `as` prop (h1, h2, p, span, etc.)
//   - Compound variants for special combinations
//   - forwardRef-ready for animations, measurements, a11y
//
// Usage:
//   <Text variant="title">Decision Header</Text>
//   <Text variant="metric" intent="success">+247%</Text>
//   <Text variant="body" intent="muted" size="sm">Help text</Text>
//
// See: client/design-system/CVA-API-CONTRACT.md
// ============================================================

const textVariants = cva(
  // Base classes (always applied)
  'font-sans antialiased',
  {
    variants: {
      // Semantic function (REQUIRED)
      variant: {
        title: 'text-2xl font-bold leading-tight tracking-tight',
        body: 'text-base font-normal leading-relaxed',
        label: 'text-xs font-medium uppercase tracking-wider',
        metric: 'text-3xl font-extrabold tabular-nums leading-none',
        data: 'text-sm font-medium leading-snug',
      },

      // Visual emphasis (optional)
      intent: {
        primary: 'text-text-primary',
        secondary: 'text-text-secondary',
        muted: 'text-text-muted',
        subtle: 'text-text-subtle',
        success: 'text-signal-success',
        warning: 'text-signal-warning',
        danger: 'text-signal-danger',
      },

      // Scale override (optional)
      size: {
        xs: 'text-xs',
        sm: 'text-sm',
        base: 'text-base',
        lg: 'text-lg',
        xl: 'text-xl',
        '2xl': 'text-2xl',
        '3xl': 'text-3xl',
      },
    },

    // Compound variants (special combinations)
    compoundVariants: [
      // Success metrics get subtle glow
      {
        variant: 'metric',
        intent: 'success',
        class: 'drop-shadow-sm',
      },
      // Danger metrics get warning glow
      {
        variant: 'metric',
        intent: 'danger',
        class: 'drop-shadow-sm',
      },
      // Subtle labels reduce tracking
      {
        variant: 'label',
        intent: 'subtle',
        class: 'tracking-wide',
      },
    ],

    // Default values
    defaultVariants: {
      intent: 'primary',
    },
  }
);

export const Text = forwardRef(function Text(
  {
    as: Component = 'p',
    variant,
    intent,
    size,
    className,
    children,
    ...props
  },
  ref
) {
  if (!variant) {
    throw new Error(
      '[Text] Missing required `variant` prop. Use semantic variant like "title", "body", "label", "metric", or "data".'
    );
  }

  return (
    <Component
      ref={ref}
      className={cn(textVariants({ variant, intent, size }), className)}
      {...props}
    >
      {children}
    </Component>
  );
});
