/**
 * LoadingView — Skeleton state while feed loads
 */
import { Shell } from '@/primitives';

export function LoadingView() {
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
        <div
          style={{
            padding: 'var(--spacing-xl)',
            textAlign: 'center',
          }}
        >
          {/* Spinner */}
          <div
            style={{
              width: '48px',
              height: '48px',
              border: '4px solid var(--color-border-default)',
              borderTop: '4px solid var(--color-accent-blue)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto var(--spacing-lg)',
            }}
          />
          <p
            style={{
              fontSize: 'var(--font-size-md)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading decision feed...
          </p>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-tertiary)',
              marginTop: 'var(--spacing-xs)',
            }}
          >
            Analyzing campaigns and building trust signals
          </p>
        </div>
      </div>
    </Shell>
  );
}
