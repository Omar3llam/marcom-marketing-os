// ============================================================
// MARCOM v4.1 — AlertActionPlan
// ------------------------------------------------------------
// Semantic component for displaying recommended action + execute button.
// Architecture role: FSM execution trigger.
//
// FROZEN CONTRACT:
// - Props based on BACKEND-CONTRACTS.md § Lumi Feed → AlertActionPlan
// - Uses types from @/types (Phase B)
//
// USAGE:
//   <AlertActionPlan
//     actionPlan={alert.action_plan}
//     onExecute={() => dispatch({ type: 'CONFIRM_EXECUTION' })}
//     isExecuting={state.isLocked}
//   />
// ============================================================

import type { AlertActionPlan as AlertActionPlanType } from '@/types';
import { Stack } from '@/primitives/Stack';

export interface AlertActionPlanProps {
  actionPlan: AlertActionPlanType;
  /**
   * Callback when user clicks "Execute" button.
   * Triggers FSM transition: SUCCESS → CONFIRM_EXECUTION
   */
  onExecute?: () => void;
  /**
   * FSM state (controls button state).
   */
  isExecuting?: boolean;
}

/**
 * AlertActionPlan — Displays recommended action + execute button.
 *
 * Semantic role: FSM execution trigger.
 * Replaces: <ActionCard /> or <RecommendedAction />
 */
export function AlertActionPlan({
  actionPlan,
  onExecute,
  isExecuting = false,
}: AlertActionPlanProps) {
  const statusColors = {
    PENDING: 'var(--color-status-neutral)',
    QUEUED: 'var(--color-status-warning)',
    EXECUTING: 'var(--color-status-warning)',
    EXECUTED_SUCCESS: 'var(--color-status-positive)',
    EXECUTED_FAILED: 'var(--color-status-danger)',
  };

  const statusLabels = {
    PENDING: 'Ready to execute',
    QUEUED: 'Queued...',
    EXECUTING: 'Executing...',
    EXECUTED_SUCCESS: 'Executed successfully',
    EXECUTED_FAILED: 'Execution failed',
  };

  return (
    <div
      style={{
        padding: 'var(--spacing-md)',
        background: 'var(--color-bg-tertiary)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-default)',
      }}
    >
      <Stack gap="md">
        {/* Action */}
        <div>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--spacing-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Recommended Action
          </div>
          <p
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            {actionPlan.action}
          </p>
        </div>

        {/* Status badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-xs)',
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            background: statusColors[actionPlan.status],
            color: 'var(--color-text-on-accent)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            width: 'fit-content',
          }}
        >
          {statusLabels[actionPlan.status]}
        </div>

        {/* Creative reference prompt (if present) */}
        {actionPlan.reference_prompt && (
          <div
            style={{
              padding: 'var(--spacing-sm)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              borderLeft: '3px solid var(--color-accent-blue)',
            }}
          >
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-secondary)',
                marginBottom: 'var(--spacing-xs)',
              }}
            >
              Creative Brief:
            </div>
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-primary)',
                fontStyle: 'italic',
              }}
            >
              {actionPlan.reference_prompt}
            </p>
          </div>
        )}

        {/* Execute button */}
        {onExecute && actionPlan.status === 'PENDING' && (
          <button
            onClick={onExecute}
            disabled={isExecuting}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: isExecuting
                ? 'var(--color-bg-accent-disabled)'
                : 'var(--color-bg-accent-blue)',
              color: 'var(--color-text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              cursor: isExecuting ? 'not-allowed' : 'pointer',
              opacity: isExecuting ? 0.5 : 1,
            }}
          >
            {isExecuting ? 'Executing...' : 'Execute Action'}
          </button>
        )}
      </Stack>
    </div>
  );
}
