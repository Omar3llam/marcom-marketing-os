// ============================================================
// MARCOM v4.1 — HistoricalInsight
// ------------------------------------------------------------
// Semantic component for displaying AI memory/learning.
// Architecture role: Trust signal (what worked before).
//
// FROZEN CONTRACT:
// - Props based on BACKEND-CONTRACTS.md § Lumi Feed → Alert
// - Uses types from @/types (Phase B)
//
// USAGE:
//   <HistoricalInsight
//     insight={alert.historical_insight}
//     memory={alert.memory}
//   />
// ============================================================

import type { DecisionMemory } from '@/types';
import { Stack } from '@/primitives/Stack';

export interface HistoricalInsightProps {
  insight: string;
  memory: DecisionMemory[];
}

/**
 * HistoricalInsight — Displays AI memory/learning.
 *
 * Semantic role: Trust signal (what worked before).
 * Replaces: <MemoryDisplay /> or <LearningCard />
 */
export function HistoricalInsight({ insight, memory }: HistoricalInsightProps) {
  return (
    <div
      style={{
        padding: 'var(--spacing-md)',
        background: 'var(--color-bg-tertiary)',
        borderRadius: 'var(--radius-sm)',
        borderLeft: '3px solid var(--color-accent-purple)',
      }}
    >
      <Stack gap="sm">
        {/* Insight header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-xs)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
            }}
          >
            💡
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Historical Insight
          </span>
        </div>

        {/* Insight text */}
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-primary)',
            lineHeight: 1.6,
          }}
        >
          {insight}
        </p>

        {/* Memory items */}
        {memory.length > 0 && (
          <Stack gap="xs" dividers={true}>
            {memory.map((item, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      item.isSustainable === false
                        ? 'var(--color-status-danger)'
                        : item.isSustainable === true
                        ? 'var(--color-status-positive)'
                        : 'var(--color-text-tertiary)',
                  }}
                >
                  {item.actionType}
                </span>
                {' — '}
                {item.decisionRationale}
                {item.impactDurationHrs !== null && (
                  <span
                    style={{
                      color: 'var(--color-text-tertiary)',
                      fontStyle: 'italic',
                    }}
                  >
                    {' '}
                    (lasted {item.impactDurationHrs}h)
                  </span>
                )}
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </div>
  );
}
