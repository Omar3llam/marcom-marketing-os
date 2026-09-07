import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ============================================================
// RiskSignal — Decision Flow Primitive
// ============================================================
// Purpose: Indicates risk level for actions/decisions/campaigns.
// Semantic Domain: Risk assessment, caution indicators, execution safety.
//
// Usage:
//   <RiskSignal severity="low" />
//   <RiskSignal severity="moderate" reason="High CPA volatility" />
//   <RiskSignal severity="critical" reason="Budget exceeded" showIcon />
//
// Risk Levels:
//   low → Minimal risk (green)
//   moderate → Caution advised (amber)
//   high → Significant risk (orange)
//   critical → Dangerous/blocked (red)
// ============================================================

const signalVariants = cva(
  'inline-flex items-center gap-2 rounded-full px-3 py-1 font-sans text-xs font-medium uppercase tracking-wide',
  {
    variants: {
      severity: {
        low: 'bg-signal-scale/10 text-signal-scale border border-signal-scale/20',
        moderate: 'bg-signal-hold/10 text-signal-hold border border-signal-hold/20',
        high: 'bg-orange-500/10 text-orange-600 border border-orange-500/20',
        critical: 'bg-signal-kill/10 text-signal-kill border border-signal-kill/20',
      },
    },
  }
);

const iconMap = {
  low: '✓',
  moderate: '⚠',
  high: '⚠',
  critical: '✕',
};

const labelMap = {
  low: 'Low Risk',
  moderate: 'Moderate Risk',
  high: 'High Risk',
  critical: 'Critical Risk',
};

export const RiskSignal = forwardRef(function RiskSignal(
  {
    severity,
    reason,
    showIcon = false,
    showLabel = true,
    className,
    ...props
  },
  ref
) {
  if (!['low', 'moderate', 'high', 'critical'].includes(severity)) {
    console.warn(
      `[RiskSignal] Invalid severity "${severity}". Must be one of: low, moderate, high, critical.`
    );
    return null;
  }

  const icon = iconMap[severity];
  const label = labelMap[severity];

  return (
    <div
      ref={ref}
      className={cn(signalVariants({ severity }), className)}
      role="status"
      aria-label={reason ? `${label}: ${reason}` : label}
      {...props}
    >
      {/* Icon (optional) */}
      {showIcon && (
        <span className="text-sm" aria-hidden="true">
          {icon}
        </span>
      )}

      {/* Label */}
      {showLabel && <span>{label}</span>}

      {/* Reason (optional) */}
      {reason && !showLabel && (
        <span className="font-normal normal-case tracking-normal">{reason}</span>
      )}
    </div>
  );
});
