// ============================================================
// MARCOM v4.1 — Feature Flag System
// ------------------------------------------------------------
// Runtime feature toggles for gradual UI v2 rollout.
//
// ARCHITECTURE:
// - Flags default to OFF (v1 stable)
// - Flags can be overridden via localStorage (dev testing)
// - Flags can be enabled per-route (incremental migration)
//
// USAGE:
//   import { features } from '@/config/features';
//   if (features.newDecisionView) {
//     return <DecisionViewV2 />;
//   }
//   return <DecisionViewV1 />;
//
// DEV OVERRIDE:
//   localStorage.setItem('features', JSON.stringify({ newShell: true }));
//   window.location.reload();
// ============================================================

export interface FeatureFlags {
  // ── Shell & Layout ─────────────────────────────────────────
  /** New semantic shell with FSM-aware routing */
  newShell: boolean;

  /** New decision feed view (replaces DecisionFeed.jsx) */
  newDecisionView: boolean;

  /** New input validation flow (CSV + Meta connect) */
  newInputFlow: boolean;

  /** New theater rendering (AI analysis visualization) */
  newTheater: boolean;

  /** New execution confirmation UI */
  newExecutionFlow: boolean;

  // ── Components ─────────────────────────────────────────────
  /** New semantic primitives (<DecisionTrustCluster />, etc.) */
  newPrimitives: boolean;

  /** New navigation with FSM state awareness */
  newNavigation: boolean;

  // ── Infrastructure ─────────────────────────────────────────
  /** Enable side-by-side comparison harness (dev only) */
  comparisonHarness: boolean;

  /** Enable telemetry tracking (opt-in) */
  telemetry: boolean;
}

// ── Default flags (all OFF = v1 stable) ─────────────────────
const defaultFlags: FeatureFlags = {
  newShell: false,
  newDecisionView: false,
  newInputFlow: false,
  newTheater: false,
  newExecutionFlow: false,
  newPrimitives: false,
  newNavigation: false,
  comparisonHarness: false,
  telemetry: false,
};

// ── Load flags from localStorage (dev override) ─────────────
function loadFlagsFromStorage(): Partial<FeatureFlags> {
  try {
    const stored = localStorage.getItem('features');
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    // Validate keys (security: only allow known flags)
    const valid: Partial<FeatureFlags> = {};
    for (const key of Object.keys(defaultFlags)) {
      if (key in parsed && typeof parsed[key] === 'boolean') {
        valid[key as keyof FeatureFlags] = parsed[key];
      }
    }
    return valid;
  } catch {
    return {};
  }
}

// ── Merge: defaults + localStorage overrides ────────────────
export const features: FeatureFlags = {
  ...defaultFlags,
  ...loadFlagsFromStorage(),
};

// ── Dev helper: enable flag programmatically ────────────────
export function enableFeature(flag: keyof FeatureFlags) {
  const current = loadFlagsFromStorage();
  current[flag] = true;
  localStorage.setItem('features', JSON.stringify(current));
}

// ── Dev helper: disable flag programmatically ───────────────
export function disableFeature(flag: keyof FeatureFlags) {
  const current = loadFlagsFromStorage();
  current[flag] = false;
  localStorage.setItem('features', JSON.stringify(current));
}

// ── Dev helper: reset all flags to defaults ─────────────────
export function resetFeatures() {
  localStorage.removeItem('features');
}

// ── Export for window access (dev console) ──────────────────
if (import.meta.env.DEV) {
  (window as any).__features = { enable: enableFeature, disable: disableFeature, reset: resetFeatures, current: features };
}
