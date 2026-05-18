import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ============================================================
// ConfidenceIndicator — Decision Flow Primitive
// ============================================================
// Purpose: Visual representation of AI/system confidence levels.
// Semantic Domain: Decision quality, recommendation strength, model certainty.
//
// Usage:
//   <ConfidenceIndicator level={0.87} />
//   <ConfidenceIndicator level={0.45} showLabel />
//   <ConfidenceIndicator level={0.92} size="sm" />
//
// Confidence Thresholds:
//   0.85+ → High (green)
//   0.60-0.84 → Medium (amber)
//   <0.60 → Low (red)
// ============================================================

const indicatorVariants = cva(
  'inline-flex items-center gap-2 font-sans antialiased',
  {
    variants: {
      level: {
        high: 'text-signal-success',
        medium: 'text-signal-warning',
        low: 'text-signal-danger',
      },
      size: {
        sm: 'text-xs',
        base: 'text-sm',
        lg: 'text-base',
      },
    },
    defaultVariants: {
      size: 'base',
    },
  }
);

const dotVariants = cva(
  'rounded-full',
  {
    variants: {
      level: {
        high: 'bg-signal-success',
        medium: 'bg-signal-warning',
        low: 'bg-signal-danger',
      },
      size: {
        sm: 'w-1.5 h-1.5',
        base: 'w-2 h-2',
        lg: 'w-2.5 h-2.5',
      },
    },
    defaultVariants: {
      size: 'base',
    },
  }
);

function getConfidenceLevel(level) {
  if (level >= 0.85) return 'high';
  if (level >= 0.60) return 'medium';
  return 'low';
}

function getConfidenceLabel(level) {
  if (level >= 0.85) return 'High Confidence';
  if (level >= 0.60) return 'Medium Confidence';
  return 'Low Confidence';
}

export const ConfidenceIndicator = forwardRef(function ConfidenceIndicator(
  {
    level,
    showLabel = false,
    showPercentage = true,
    size = 'base',
    className,
    ...props
  },
  ref
) {
  if (typeof level !== 'number' || level < 0 || level > 1) {
    console.warn(
      `[ConfidenceIndicator] Invalid level "${level}". Must be between 0 and 1.`
    );
    return null;
  }

  const confidenceLevel = getConfidenceLevel(level);
  const confidenceLabel = getConfidenceLabel(level);
  const percentage = Math.round(level * 100);

  return (
    <div
      ref={ref}
      className={cn(indicatorVariants({ level: confidenceLevel, size }), className)}
      role="status"
      aria-label={`${confidenceLabel}: ${percentage}%`}
      {...props}
    >
      {/* Confidence dot */}
      <span className={dotVariants({ level: confidenceLevel, size })} />

      {/* Label or percentage */}
      {showLabel ? (
        <span className="font-medium">{confidenceLabel}</span>
      ) : showPercentage ? (
        <span className="font-medium tabular-nums">{percentage}%</span>
      ) : null}
    </div>
  );
});
