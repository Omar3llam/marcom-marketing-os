/**
 * ErrorView — Typed error display with retry/reset actions (Phase 10C)
 *
 * Severity-aware error display for route-level failures.
 * Maps error severity to visual presentation.
 *
 * Note: This component is for high/critical severity errors (route boundaries).
 * Low/medium severity errors should use Toast/InlineWarning components instead.
 */
import { Shell, Panel, Button, Stack } from '@/primitives';
import { AppError } from '@/contracts/errors';

interface ErrorViewProps {
  error: AppError;
  onRetry: () => void;
  onReset: () => void;
}

export function ErrorView({ error, onRetry, onReset }: ErrorViewProps) {
  const classification = error.classification;
  const severity = error.severity;
  const isRetryable = error.retryable;

  // Severity → color mapping
  const severityColors = {
    low: 'var(--color-status-success)',
    medium: 'var(--color-status-warning)',
    high: 'var(--color-status-danger)',
    critical: 'var(--color-text-primary)',
  };

  // Classification → metadata mapping (Phase 10 domain errors)
  const errorMeta = {
    auth: {
      title: 'Authentication Required',
      icon: '🔒',
      action: 'Sign in again',
    },
    network: {
      title: 'Connection Error',
      icon: '📡',
      action: 'Retry',
    },
    platform: {
      title: 'Platform Error',
      icon: '⚠️',
      action: 'Retry',
    },
    validation: {
      title: 'Invalid Request',
      icon: '❌',
      action: 'Reset',
    },
    contract: {
      title: 'Data Format Error',
      icon: '📋',
      action: 'Contact support',
    },
    parsing: {
      title: 'Data Format Error', // Legacy alias
      icon: '📋',
      action: 'Contact support',
    },
    decision_engine: {
      title: 'AI Engine Error',
      icon: '🤖',
      action: 'Retry',
    },
    workspace: {
      title: 'Workspace Error',
      icon: '🏢',
      action: 'Contact admin',
    },
    stream: {
      title: 'Stream Disconnected',
      icon: '📶',
      action: 'Reconnecting...',
    },
    execution: {
      title: 'Action Failed',
      icon: '⚡',
      action: 'Try again',
    },
    rate_limit: {
      title: 'Rate Limited',
      icon: '⏱️',
      action: 'Wait and retry',
    },
  }[classification] || {
    title: 'Unknown Error',
    icon: '⚠️',
    action: 'Retry',
  };

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
            {/* Icon */}
            <div
              style={{
                fontSize: 'var(--font-size-2xl)',
                marginBottom: 'var(--spacing-md)',
              }}
            >
              {errorMeta.icon}
            </div>

            {/* Title */}
            <h2
              style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 600,
                color: severityColors[severity],
                marginBottom: 'var(--spacing-sm)',
              }}
            >
              {errorMeta.title}
            </h2>

            {/* Error code (debugging aid) */}
            {error.code && (
              <p
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  marginBottom: 'var(--spacing-sm)',
                }}
              >
                [{error.code}]
              </p>
            )}

            {/* Message */}
            <p
              style={{
                fontSize: 'var(--font-size-md)',
                color: 'var(--color-text-secondary)',
                marginBottom: 'var(--spacing-lg)',
              }}
            >
              {error.message || 'An unexpected error occurred'}
            </p>

            {/* Fallback action hint */}
            {error.fallbackAction && (
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-tertiary)',
                  marginBottom: 'var(--spacing-lg)',
                }}
              >
                💡 {error.fallbackAction}
              </p>
            )}

            {/* Actions */}
            <Stack gap="sm" align="center">
              {isRetryable && (
                <Button variant="primary" onClick={onRetry} type="button">
                  {errorMeta.action}
                </Button>
              )}
              <Button variant="secondary" onClick={onReset} type="button">
                Go back
              </Button>
            </Stack>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
