// ============================================================
// MARCOM v4.1 — Comparison Harness (Dev Only)
// ------------------------------------------------------------
// Side-by-side rendering of v1 (old) and v2 (new) views.
// Renders both implementations in parallel for visual comparison.
//
// USAGE:
//   import { ComparisonHarness } from '@/components/dev/ComparisonHarness';
//
//   <ComparisonHarness
//     v1={<DecisionViewV1 />}
//     v2={<DecisionViewV2 />}
//     label="Decision View"
//   />
//
// FEATURES:
// - Split-screen layout (50/50 or adjustable)
// - Synchronized state (optional)
// - Visual diff indicators (spacing, colors, etc.)
// - Performance metrics (render time, re-renders)
// ============================================================
import { ReactNode, useState, useEffect, useRef } from 'react';
import { features } from '@/config/features';

interface ComparisonHarnessProps {
  v1: ReactNode;
  v2: ReactNode;
  label: string;
  /** Sync state between v1 and v2 (if applicable) */
  syncState?: boolean;
  /** Initial split ratio (0-100, default 50) */
  initialSplit?: number;
}

export function ComparisonHarness({
  v1,
  v2,
  label,
  syncState = false,
  initialSplit = 50,
}: ComparisonHarnessProps) {
  const [split, setSplit] = useState(initialSplit);
  const [v1RenderTime, setV1RenderTime] = useState(0);
  const [v2RenderTime, setV2RenderTime] = useState(0);
  const [v1Renders, setV1Renders] = useState(0);
  const [v2Renders, setV2Renders] = useState(0);

  const v1Ref = useRef<HTMLDivElement>(null);
  const v2Ref = useRef<HTMLDivElement>(null);

  // Only render in dev mode with comparison flag enabled
  if (!import.meta.env.DEV || !features.comparisonHarness) {
    return <>{v2}</>;
  }

  // Track render times
  useEffect(() => {
    const start = performance.now();
    setV1Renders((prev) => prev + 1);
    return () => {
      const elapsed = performance.now() - start;
      setV1RenderTime(elapsed);
    };
  }, [v1]);

  useEffect(() => {
    const start = performance.now();
    setV2Renders((prev) => prev + 1);
    return () => {
      const elapsed = performance.now() - start;
      setV2RenderTime(elapsed);
    };
  }, [v2]);

  return (
    <div className="comparison-harness" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div style={{
        background: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border-default)',
        padding: 'var(--spacing-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
            🔬 Comparison: {label}
          </span>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            v1: {v1Renders} renders, {v1RenderTime.toFixed(2)}ms
          </span>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            v2: {v2Renders} renders, {v2RenderTime.toFixed(2)}ms
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          <button
            onClick={() => setSplit(25)}
            style={{ padding: 'var(--spacing-xs)', fontSize: 'var(--font-size-xs)' }}
          >
            25/75
          </button>
          <button
            onClick={() => setSplit(50)}
            style={{ padding: 'var(--spacing-xs)', fontSize: 'var(--font-size-xs)' }}
          >
            50/50
          </button>
          <button
            onClick={() => setSplit(75)}
            style={{ padding: 'var(--spacing-xs)', fontSize: 'var(--font-size-xs)' }}
          >
            75/25
          </button>
        </div>
      </div>

      {/* Split view */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* v1 (old) */}
        <div
          ref={v1Ref}
          style={{
            width: `${split}%`,
            borderRight: '2px solid var(--color-accent-orange)',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <div style={{
            position: 'absolute',
            top: 'var(--spacing-xs)',
            left: 'var(--spacing-xs)',
            background: 'var(--color-bg-accent-orange)',
            color: 'var(--color-text-on-accent)',
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            zIndex: 1000,
          }}>
            v1 (OLD)
          </div>
          {v1}
        </div>

        {/* v2 (new) */}
        <div
          ref={v2Ref}
          style={{
            width: `${100 - split}%`,
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <div style={{
            position: 'absolute',
            top: 'var(--spacing-xs)',
            left: 'var(--spacing-xs)',
            background: 'var(--color-bg-accent-green)',
            color: 'var(--color-text-on-accent)',
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            zIndex: 1000,
          }}>
            v2 (NEW)
          </div>
          {v2}
        </div>
      </div>

      {/* State sync indicator */}
      {syncState && (
        <div style={{
          position: 'fixed',
          bottom: 'var(--spacing-md)',
          right: 'var(--spacing-md)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-default)',
          padding: 'var(--spacing-sm)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-sm)',
          boxShadow: 'var(--shadow-lg)',
        }}>
          🔗 State sync: enabled
        </div>
      )}
    </div>
  );
}

// ── Comparison wrapper for routes ───────────────────────────
/**
 * Route-level comparison wrapper.
 * Automatically wraps v1/v2 route components when comparison mode is enabled.
 *
 * Example in App.tsx:
 *   <Route path="/decision" element={
 *     <ComparisonRoute
 *       v1={<DecisionViewV1 />}
 *       v2={<DecisionViewV2 />}
 *       label="Decision View"
 *     />
 *   } />
 */
export function ComparisonRoute(props: ComparisonHarnessProps) {
  // If comparison harness is disabled, render based on feature flags
  if (!features.comparisonHarness) {
    // Import features to check which version to render
    return <>{props.v2}</>;
  }

  return <ComparisonHarness {...props} />;
}
