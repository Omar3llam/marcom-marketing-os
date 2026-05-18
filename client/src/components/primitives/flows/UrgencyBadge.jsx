import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ============================================================
// UrgencyBadge — Decision Flow Primitive
// ============================================================
// Purpose: Indicates time-sensitivity and execution priority.
// Semantic Domain: Urgency levels, time constraints, action priority.
//
// Usage:
//   <UrgencyBadge priority="low" />
//   <UrgencyBadge priority="high" deadline="24h" />
//   <UrgencyBadge priority="critical" deadline="2h" showPulse />
//
// Priority Levels:
//   low → No rush (gray)
//   medium → Moderate priority (blue)
//   high → Time-sensitive (orange)
//   critical → Immediate action (red, pulsing)
// ============================================================

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-sans text-xs font-semibold uppercase tracking-wide',
  {
    variants: {
      priority: {
        low: 'bg-gray-100 text-gray-600 border border-gray-200',
        medium: 'bg-blue-50 text-blue-700 border border-blue-200',
        high: 'bg-orange-50 text-orange-700 border border-orange-200',
        critical: 'bg-red-50 text-red-700 border border-red-200',
      },
      pulse: {
        true: 'animate-pulse',
        false: '',
      },
    },
    defaultVariants: {
      pulse: false,
    },
  }
);

const dotVariants = cva(
  'w-1.5 h-1.5 rounded-full',
  {
    variants: {
      priority: {
        low: 'bg-gray-400',
        medium: 'bg-blue-500',
        high: 'bg-orange-500',
        critical: 'bg-red-500 animate-pulse',
      },
    },
  }
);

const labelMap = {
  low: 'Low Priority',
  medium: 'Medium Priority',
  high: 'High Priority',
  critical: 'Urgent',
};

export const UrgencyBadge = forwardRef(function UrgencyBadge(
  {
    priority,
    deadline,
    showPulse = false,
    showLabel = true,
    className,
    ...props
  },
  ref
) {
  if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
    console.warn(
      `[UrgencyBadge] Invalid priority "${priority}". Must be one of: low, medium, high, critical.`
    );
    return null;
  }

  const label = labelMap[priority];
  const shouldPulse = showPulse || priority === 'critical';

  return (
    <div
      ref={ref}
      className={cn(badgeVariants({ priority, pulse: shouldPulse }), className)}
      role="status"
      aria-label={deadline ? `${label} — Deadline: ${deadline}` : label}
      {...props}
    >
      {/* Priority dot */}
      <span className={dotVariants({ priority })} aria-hidden="true" />

      {/* Label */}
      {showLabel && <span>{label}</span>}

      {/* Deadline (optional) */}
      {deadline && (
        <span className="font-normal tracking-normal">
          · {deadline}
        </span>
      )}
    </div>
  );
});
