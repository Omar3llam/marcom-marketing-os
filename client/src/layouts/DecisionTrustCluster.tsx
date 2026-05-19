// ============================================================
// MARCOM v4.1 — DecisionTrustCluster
// ------------------------------------------------------------
// Semantic component for displaying campaign decision + trust signals.
// Architecture role: Decision feed primary unit.
//
// FROZEN CONTRACT:
// - Props based on BACKEND-CONTRACTS.md § Lumi Feed
// - Uses types from @/types (Phase B)
//
// USAGE:
//   <DecisionTrustCluster
//     campaign={campaign}
//     alert={alert}
//     onExecute={() => dispatch({ type: 'CONFIRM_EXECUTION' })}
//   />
// ============================================================

import type { Campaign, Alert } from '@/types';
import { Panel } from '@/primitives/Panel';
import { Stack } from '@/primitives/Stack';
import { Cluster } from '@/primitives/Cluster';
import { MetricSignalGrid } from './MetricSignalGrid';
import { AlertActionPlan } from './AlertActionPlan';
import { HistoricalInsight } from './HistoricalInsight';
import { PriorityBadge } from './PriorityBadge';
import { StageBadge } from './StageBadge';

export interface DecisionTrustClusterProps {
  campaign: Campaign;
  alert: Alert;
  /**
   * Callback when user confirms execution.
   * Triggers FSM transition: SUCCESS → CONFIRM_EXECUTION
   */
  onExecute?: () => void;
  /**
   * Callback when user dismisses alert.
   */
  onDismiss?: () => void;
  /**
   * FSM state (controls button states).
   */
  isExecuting?: boolean;
}

/**
 * DecisionTrustCluster — Campaign decision display with trust signals.
 *
 * Semantic role: Decision feed primary unit.
 * Replaces: <BigCard /> or <CampaignDecisionCard />
 */
export function DecisionTrustCluster({
  campaign,
  alert,
  onExecute,
  onDismiss,
  isExecuting = false,
}: DecisionTrustClusterProps) {
  return (
    <Panel
      elevation="raised"
      padding="lg"
      header={
        <Cluster justify="space-between" align="center">
          <div>
            <h2
              style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                marginBottom: 'var(--spacing-xs)',
              }}
            >
              {campaign.campaign_name || campaign.campaign_id}
            </h2>
          </div>
          <Cluster gap="sm">
            <PriorityBadge priority={alert.priority} />
            <StageBadge stage={campaign.stage} />
          </Cluster>
        </Cluster>
      }
    >
      <Stack gap="lg">
        {/* Analysis */}
        <div>
          <h3
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--spacing-sm)',
            }}
          >
            {alert.analysis.verdict}
          </h3>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            {alert.analysis.root_cause}
          </p>
        </div>

        {/* Metrics */}
        <MetricSignalGrid metrics={alert.metrics} />

        {/* Historical Insight */}
        {alert.historical_insight && (
          <HistoricalInsight
            insight={alert.historical_insight}
            memory={alert.memory}
          />
        )}

        {/* Action Plan */}
        <AlertActionPlan
          actionPlan={alert.action_plan}
          onExecute={onExecute}
          isExecuting={isExecuting}
        />

        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            disabled={isExecuting}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)',
              cursor: isExecuting ? 'not-allowed' : 'pointer',
              opacity: isExecuting ? 0.5 : 1,
            }}
          >
            Dismiss
          </button>
        )}
      </Stack>
    </Panel>
  );
}
