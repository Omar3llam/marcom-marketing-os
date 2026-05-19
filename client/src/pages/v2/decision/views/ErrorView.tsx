/**
 * ErrorView — Typed error display with retry/reset actions
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
  const isRetryable = error.retryable;

  const errorMeta = {
    auth: {
      title: 'Authentication Required',
      color: 'var(--color-status-warning)',
      icon: '🔒',
      action: 'Sign in again',
    },
    network: {
      title: 'Connection Error',
      color: 'var(--color-status-danger)',
      icon: '📡',
      action: 'Retry',
    },
    platform: {
      title: 'Platform Error',
      color: 'var(--color-status-danger)',
      icon: '⚠️',
      action: 'Retry',
    },
    validation: {
      title: 'Invalid Request',
      color: 'var(--color-status-warning)',
      icon: '❌',
      action: 'Reset',
    },
    parsing: {
      title: 'Data Format Error',
      color: 'var(--color-status-danger)',
      icon: '📋',
      action: 'Contact support',
    },
  }[classification] || {
    title: 'Unknown Error',
    color: 'var(--color-status-danger)',
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
                color: errorMeta.color,
                marginBottom: 'var(--spacing-sm)',
              }}
            >
              {errorMeta.title}
            </h2>

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
