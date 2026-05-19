// ============================================================
// MARCOM v4.1 — Route Isolation Strategy
// ------------------------------------------------------------
// Defines parallel v1/v2 route structure for gradual migration.
//
// ARCHITECTURE:
// - v1 routes: existing paths (e.g., /decision)
// - v2 routes: isolated paths (e.g., /v2/decision)
// - Feature flags control which version renders
// - Both versions hit same backend contracts
//
// MIGRATION PATTERN:
//   Step 1: Build /v2/decision (new implementation)
//   Step 2: Test in parallel (comparison harness)
//   Step 3: Enable feature flag → /decision uses v2
//   Step 4: Remove v1 code once v2 stable
// ============================================================

export const routes = {
  // ── v1 routes (existing stable) ────────────────────────────
  v1: {
    root: '/',
    auth: '/auth',
    onboarding: '/onboarding',
    decision: '/decision',
    history: '/history',
    settings: '/settings',
  },

  // ── v2 routes (new implementation) ─────────────────────────
  v2: {
    root: '/v2',
    auth: '/v2/auth',
    onboarding: '/v2/onboarding',
    decision: '/v2/decision',
    history: '/v2/history',
    settings: '/v2/settings',
  },

  // ── Comparison routes (dev harness) ────────────────────────
  compare: {
    decision: '/compare/decision',
    inputFlow: '/compare/input',
    theater: '/compare/theater',
  },
} as const;

// ── Route resolution (feature-flag aware) ───────────────────
/**
 * Returns the active route based on feature flags.
 * Used by <Link /> components to respect flag state.
 *
 * Example:
 *   const path = getActiveRoute('decision');
 *   // Returns '/decision' (v1) or '/v2/decision' (v2) based on flags
 */
export function getActiveRoute(
  route: keyof typeof routes.v1,
  forceVersion?: 'v1' | 'v2'
): string {
  // Import here to avoid circular dependency
  const { features } = await import('./features.js');

  if (forceVersion === 'v2') {
    return routes.v2[route] || routes.v1[route];
  }

  if (forceVersion === 'v1') {
    return routes.v1[route];
  }

  // Auto-resolve based on feature flags
  switch (route) {
    case 'decision':
      return features.newDecisionView ? routes.v2.decision : routes.v1.decision;
    case 'onboarding':
      return features.newInputFlow ? routes.v2.onboarding : routes.v1.onboarding;
    default:
      return routes.v1[route];
  }
}

// ── Type-safe route params ──────────────────────────────────
export type RouteKey = keyof typeof routes.v1;
export type RouteVersion = 'v1' | 'v2';
