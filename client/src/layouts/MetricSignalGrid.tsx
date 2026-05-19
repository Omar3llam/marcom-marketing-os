// ============================================================
// MARCOM v4.1 — MetricSignalGrid
// ------------------------------------------------------------
// Semantic component for displaying metric signals (CTR, ROAS, etc).
// Architecture role: Trust signal visualization.
//
// FROZEN CONTRACT:
// - Props based on BACKEND-CONTRACTS.md § Lumi Feed → Metric
// - Uses types from @/types (Phase B)
//
// USAGE:
//   <MetricSignalGrid metrics={alert.metrics} />
// ============================================================

import type { Metric } from '@/types';
import { Cluster } from '@/primitives/Cluster';

export interface MetricSignalGridProps {
  metrics: Metric[];
}

/**
 * MetricSignalGrid — Displays metric signals with status/trend.
 *
 * Semantic role: Trust signal visualization.
 * Replaces: <MetricsDisplay /> or <StatsGrid />
 */
export function MetricSignalGrid({ metrics }: MetricSignalGridProps) {
  const statusColors = {
    danger: 'var(--color-status-danger)',
    warning: 'var(--color-status-warning)',
    neutral: 'var(--color-status-neutral)',
    positive: 'var(--color-status-positive)',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    flat: '→',
  };

  return (
    <Cluster gap="md" wrap={true}>
      {metrics.map((metric, idx) => (
        <div
          key={idx}
          style={{
            flex: '1 1 150px',
            padding: 'var(--spacing-md)',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${statusColors[metric.status]}`,
          }}
        >
          {/* Metric name */}
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--spacing-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {metric.metric}
          </div>

          {/* Value + Trend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--spacing-xs)',
              marginBottom: 'var(--spacing-xs)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 600,
                color: statusColors[metric.status],
              }}
            >
              {metric.value}
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {trendIcons[metric.trend]}
            </span>
          </div>

          {/* Delta */}
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {metric.delta}
          </div>

          {/* Context */}
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              marginTop: 'var(--spacing-xs)',
            }}
          >
            {metric.context}
          </div>
        </div>
      ))}
    </Cluster>
  );
}
