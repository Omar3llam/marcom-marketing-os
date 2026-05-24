import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ============================================================
// RecommendationStrength — Decision Flow Primitive
// ============================================================
// Purpose: Visualizes AI recommendation strength with reasoning.
// Semantic Domain: AI confidence, recommendation power, decision support.
//
// Usage:
//   <RecommendationStrength value="strong" reasoning="3-week uptrend" />
//   <RecommendationStrength value="weak" reasoning="Insufficient data" showBar />
//   <RecommendationStrength value="very-strong" reasoning="97% confidence" />
//
// Strength Levels:
//   weak → Low conviction (1 bar, gray)
//   moderate → Medium conviction (2 bars, amber)
//   strong → High conviction (3 bars, green)
//   very-strong → Maximum conviction (4 bars, bright green)
// ============================================================

const strengthVariants = cva(
  'inline-flex flex-col gap-2 rounded-lg border p-3 font-sans',
  {
    variants: {
      value: {
        weak: 'border-gray-200 bg-gray-50',
        moderate: 'border-amber-200 bg-amber-50',
        strong: 'border-green-200 bg-green-50',
        'very-strong': 'border-emerald-200 bg-emerald-50',
      },
    },
  }
);

const labelVariants = cva(
  'text-xs font-bold uppercase tracking-wider',
  {
    variants: {
      value: {
        weak: 'text-gray-700',
        moderate: 'text-amber-700',
        strong: 'text-green-700',
        'very-strong': 'text-emerald-700',
      },
    },
  }
);

const barContainerClass = 'flex items-center gap-1';

const barVariants = cva(
  'h-1.5 w-6 rounded-full transition-all',
  {
    variants: {
      active: {
        true: '',
        false: 'opacity-20',
      },
      value: {
        weak: 'bg-gray-500',
        moderate: 'bg-amber-500',
        strong: 'bg-green-500',
        'very-strong': 'bg-emerald-500',
      },
    },
  }
);

const labelMap = {
  weak: 'Weak Recommendation',
  moderate: 'Moderate Recommendation',
  strong: 'Strong Recommendation',
  'very-strong': 'Very Strong Recommendation',
};

const strengthMap = {
  weak: 1,
  moderate: 2,
  strong: 3,
  'very-strong': 4,
};

export const RecommendationStrength = forwardRef(function RecommendationStrength(
  {
    value,
    reasoning,
    showBar = true,
    showLabel = true,
    className,
    ...props
  },
  ref
) {
  if (!['weak', 'moderate', 'strong', 'very-strong'].includes(value)) {
    console.warn(
      `[RecommendationStrength] Invalid value "${value}". Must be one of: weak, moderate, strong, very-strong.`
    );
    return null;
  }

  const label = labelMap[value];
  const strength = strengthMap[value];

  return (
    <div
      ref={ref}
      className={cn(strengthVariants({ value }), className)}
      role="status"
      aria-label={reasoning ? `${label}: ${reasoning}` : label}
      {...props}
    >
      {/* Label */}
      {showLabel && (
        <div className={labelVariants({ value })}>
          {label}
        </div>
      )}

      {/* Strength bars */}
      {showBar && (
        <div className={barContainerClass}>
          {[1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className={barVariants({
                active: bar <= strength,
                value,
              })}
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      {/* Reasoning (optional) */}
      {reasoning && (
        <p className="text-xs text-dark-muted leading-snug mt-1">
          {reasoning}
        </p>
      )}
    </div>
  );
});
