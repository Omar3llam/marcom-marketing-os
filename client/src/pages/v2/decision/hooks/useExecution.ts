/**
 * useExecution — Manage Meta action execution
 *
 * Handles:
 * - Action execution with idempotency
 * - Duplicate execution prevention (Set-based tracking)
 * - Optimistic UI updates
 * - Execution telemetry
 *
 * @example
 * ```tsx
 * const { handleExecute, executingActions } = useExecution({ onSuccess: refetch });
 *
 * <Button
 *   onClick={() => handleExecute(alert, campaign)}
 *   disabled={executingActions.has(alert.action_id)}
 * >
 *   Execute
 * </Button>
 * ```
 */
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { track } from '@/lib/telemetry';
import type { Alert, Campaign } from '@/contracts/schemas';

export interface UseExecutionOptions {
  /** Callback to refetch feed after successful execution */
  onSuccess?: () => void;
}

export interface UseExecutionResult {
  handleExecute: (alert: Alert, campaign: Campaign) => Promise<void>;
  executingActions: Set<string>;
}

export function useExecution(options: UseExecutionOptions = {}): UseExecutionResult {
  const [executingActions, setExecutingActions] = useState<Set<string>>(new Set());

  const handleExecute = useCallback(
    async (alert: Alert, campaign: Campaign) => {
      const actionId = alert.action_id;

      // Guard: Prevent duplicate executions
      if (executingActions.has(actionId)) {
        console.warn('[useExecution] Action already executing:', actionId);
        return;
      }

      // Mark as executing
      setExecutingActions((prev) => new Set(prev).add(actionId));

      try {
        // Track execution start
        track('execution_start', {
          version: 'v2',
          actionId,
          campaignId: campaign.campaign_id,
          verdict: alert.analysis.verdict,
          priority: alert.priority,
        });

        // Execute action via Meta API
        const response = await api.post('/api/execute/meta', {
          actionType: alert.action_plan.action,
          targetId: campaign.campaign_id,
          targetType: 'campaign',
          idempotencyKey: alert.idempotency_key,
          options: {},
        });

        if (response.data.success) {
          toast.success('Action executed successfully', {
            description: `${alert.analysis.verdict} applied to ${campaign.campaign_id}`,
            duration: 3000,
          });

          // Track execution success
          track('execution_success', {
            version: 'v2',
            actionId,
            campaignId: campaign.campaign_id,
          });

          // Trigger success callback (e.g., refetch feed)
          options.onSuccess?.();
        } else {
          throw new Error(response.data.error || 'Execution failed');
        }
      } catch (err: any) {
        toast.error('Execution failed', {
          description: err.message || 'Unknown error',
          duration: 4000,
        });

        // Track execution failure
        track('execution_error', {
          version: 'v2',
          actionId,
          campaignId: campaign.campaign_id,
          error: err.message,
        });
      } finally {
        // Remove from executing set
        setExecutingActions((prev) => {
          const next = new Set(prev);
          next.delete(actionId);
          return next;
        });
      }
    },
    [executingActions, options]
  );

  return {
    handleExecute,
    executingActions,
  };
}
