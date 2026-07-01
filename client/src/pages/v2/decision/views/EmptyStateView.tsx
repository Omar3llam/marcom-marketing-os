/**
 * EmptyStateView — Zero-data state (no campaigns or alerts)
 */
import { Shell, Panel } from '@/primitives';

export function EmptyStateView() {
  return (
    <Shell mode="full">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
        }}
      >
        <Panel elevation="raised" padding="lg">
          <div
            style={{
              maxWidth: '500px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 'var(--font-size-2xl)',
                marginBottom: 'var(--spacing-md)',
              }}
            >
              📊
            </div>
            <h2
              style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                marginBottom: 'var(--spacing-sm)',
              }}
            >
              No Decisions Pending
            </h2>
            <p
              style={{
                fontSize: 'var(--font-size-md)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Connect Meta Ads to get started.
            </p>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
