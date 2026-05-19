// ============================================================
// MARCOM v4.1 — DecisionViewV2 (Sprint 1.5)
// ------------------------------------------------------------
// Route orchestrator: delegates to hooks + views.
//
// ARCHITECTURE:
// - FSM-native: State-driven view selection
// - Type-safe: Contract schemas with runtime validation
// - Composed: Hooks (data) + Views (presentation) + Selectors (logic)
// - Observable: Telemetry tracking (render time, API calls, errors)
//
// SPRINT 1.5 CHANGES:
// - ✅ Runtime contract validation (Zod schemas)
// - ✅ Adapter layer with normalization
// - ✅ Result pattern (no exception-driven architecture)
// - ✅ Contract drift telemetry
// - ✅ Typed errors (AppError hierarchy)
// - ✅ Hook extraction (useDecisionFeed, useExecution)
// - ✅ Component split (decision/ folder structure)
// ============================================================
import { useEffect } from 'react';
import { track } from '@/lib/telemetry';

// Hook layer
import { useDecisionFeed } from './decision/hooks/useDecisionFeed';
import { useExecution } from './decision/hooks/useExecution';

// View layer
import { LoadingView } from './decision/views/LoadingView';
import { ErrorView } from './decision/views/ErrorView';
import { EmptyStateView } from './decision/views/EmptyStateView';
import { FeedView } from './decision/views/FeedView';

/**
 * DecisionViewV2 — Route orchestrator
 *
 * Pure orchestration: hooks provide data, views handle presentation.
 * No inline logic, no inline components.
 */
export function DecisionViewV2() {
  // Hook layer: Data fetching + execution
  const { state, data, error, refetch } = useDecisionFeed();
  const { handleExecute, executingActions } = useExecution({ onSuccess: refetch });

  // Track render time (telemetry)
  useEffect(() => {
    const start = performance.now();
    return () => {
      const elapsed = performance.now() - start;
      track('route_render', {
        route: '/v2/decision',
        version: 'v2',
        renderTime: elapsed,
        state,
      });
    };
  }, [state]);

  // ══════════════════════════════════════════════════════════════
  // State-driven view selection
  // ══════════════════════════════════════════════════════════════
  if (state === 'loading') {
    return <LoadingView />;
  }

  if (state === 'error' && error) {
    return <ErrorView error={error} onRetry={refetch} onReset={() => window.location.reload()} />;
  }

  if (state === 'success' && data) {
    // Empty state check
    const totalAlerts = data.campaigns.reduce((acc, c) => acc + c.alerts.length, 0);
    if (totalAlerts === 0) {
      return <EmptyStateView />;
    }

    // Feed display
    return <FeedView data={data} executingActions={executingActions} onExecute={handleExecute} />;
  }

  // Idle state (should not reach here)
  return null;
}
