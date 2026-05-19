/**
 * FeedView — Main feed display (success state)
 *
 * Renders campaign decision clusters with execution controls.
 */
import { Shell, Stack } from '@/primitives';
import { DecisionTrustCluster } from '@/layouts';
import type { LumiFeedResponse, Campaign, Alert } from '@/contracts/schemas';
import { extractExecutionState } from '../selectors/extractors';

interface FeedViewProps {
  data: LumiFeedResponse;
  executingActions: Set<string>;
  onExecute: (alert: Alert, campaign: Campaign) => void;
}

export function FeedView({ data, executingActions, onExecute }: FeedViewProps) {
  const totalAlerts = data.campaigns.reduce((acc, c) => acc + c.alerts.length, 0);

  return (
    <Shell mode="full">
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: 'var(--spacing-xl)',
        }}
      >
        {/* ── Feed Header ──────────────────────────────────── */}
        <header
          style={{
            marginBottom: 'var(--spacing-xl)',
          }}
        >
          <h1
            style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--spacing-xs)',
            }}
          >
            Decision Feed
          </h1>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {data.campaigns.length} campaigns · {totalAlerts} pending decisions · Generated{' '}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        </header>

        {/* ── Trust Layer: Decision Clusters ──────────────── */}
        <Stack gap="xl">
          {data.campaigns.map((campaign) =>
            campaign.alerts.map((alert) => {
              const isExecuting = executingActions.has(alert.action_id);
              const executionState = extractExecutionState(alert);

              return (
                <DecisionTrustCluster
                  key={alert.action_id}
                  campaign={campaign}
                  alert={alert}
                  onExecute={
                    executionState === 'READY' ? () => onExecute(alert, campaign) : undefined
                  }
                  isExecuting={isExecuting}
                />
              );
            })
          )}
        </Stack>
      </div>
    </Shell>
  );
}
