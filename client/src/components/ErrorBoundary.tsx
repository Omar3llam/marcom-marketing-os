// ============================================================
// MARCOM v4.1 — ErrorBoundary Component
// ------------------------------------------------------------
// React error boundary for catching render errors.
//
// ARCHITECTURE:
// - Class component (required by React error boundary API)
// - Catches errors in child component tree
// - Logs errors to telemetry
// - Renders fallback UI on error
//
// USAGE:
//   <ErrorBoundary fallback={<ErrorFallback />}>
//     <MyComponent />
//   </ErrorBoundary>
// ============================================================

import { Component, ReactNode, ErrorInfo } from 'react';
import { track } from '@/lib/telemetry';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Fallback UI to render when an error is caught.
   * If not provided, renders a default error UI.
   */
  fallback?: ReactNode;
  /**
   * Optional identifier for error tracking (e.g., route name).
   */
  boundaryId?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — React error boundary component.
 *
 * Catches JavaScript errors anywhere in child component tree,
 * logs them to telemetry, and displays a fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { boundaryId } = this.props;

    // Log to telemetry
    track('error_boundary_caught', {
      boundaryId: boundaryId || 'unknown',
      errorMessage: error.message,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Log to console for dev debugging
    console.error('[ErrorBoundary]', boundaryId || 'Root', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return <DefaultErrorFallback error={this.state.error} onReset={() => this.setState({ hasError: false, error: null })} />;
    }

    return this.props.children;
  }
}

/**
 * DefaultErrorFallback — Default error UI when no fallback is provided.
 */
function DefaultErrorFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-xl)',
      }}
    >
      <div
        style={{
          maxWidth: '600px',
          padding: 'var(--spacing-xl)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-status-danger)',
          borderRadius: 'var(--radius-lg)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 'var(--font-size-3xl)',
            marginBottom: 'var(--spacing-md)',
          }}
        >
          ⚠️
        </div>
        <h1
          style={{
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 700,
            color: 'var(--color-status-danger)',
            marginBottom: 'var(--spacing-sm)',
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: 'var(--font-size-md)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--spacing-lg)',
          }}
        >
          An unexpected error occurred while rendering this page.
        </p>

        {error && (
          <details
            style={{
              marginBottom: 'var(--spacing-lg)',
              padding: 'var(--spacing-md)',
              background: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'left',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 600,
                marginBottom: 'var(--spacing-sm)',
              }}
            >
              Error details
            </summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {error.message}
              {'\n\n'}
              {error.stack}
            </pre>
          </details>
        )}

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'center' }}>
          <button
            onClick={onReset}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-lg)',
              background: 'var(--color-bg-accent-blue)',
              color: 'var(--color-text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <button
            onClick={() => (window.location.href = '/app/feed')}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-lg)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-md)',
              cursor: 'pointer',
            }}
          >
            Go to feed
          </button>
        </div>
      </div>
    </div>
  );
}
