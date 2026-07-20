// ============================================================
// MARCOM Design System — Signal Registry
// ============================================================
// Semantic state-to-token mapping for decision verdicts,
// alerts, and signal indicators.
//
// Architecture:
//   - Each signal defines: surface, text, border, glow
//   - Used by VerdictBadge, SignalPill, StatusIndicator
//   - Single source of truth for signal semantics
//
// Philosophy:
//   State semantics (SCALE, HOLD, KILL) map to visual tokens,
//   NOT raw colors. This decouples business logic from design.
// ============================================================

export const SIGNALS = {
  // Campaign verdicts
  SCALE: {
    surface: 'bg-signal-scale-bg',
    text:    'text-signal-scale',
    border:  'border-signal-scale/30',
    glow:    'shadow-scale-glow',
  },

  HOLD: {
    surface: 'bg-signal-hold-bg',
    text:    'text-signal-hold',
    border:  'border-signal-hold/30',
    glow:    'shadow-hold-glow',
  },

  KILL: {
    surface: 'bg-signal-kill-bg',
    text:    'text-signal-kill',
    border:  'border-signal-kill/30',
    glow:    'shadow-kill-glow',
  },

  // Phase-2 verdicts. Without these three, getSignalTokens fell back to HOLD
  // (with a console.warn) — a decision-first UI would render WATCH/REALLOCATE/
  // REFRESH as HOLD. WATCH/REFRESH read as "attention/action" (watch blue);
  // REALLOCATE reuses the hold amber (a budget move, not a creative one).
  WATCH: {
    surface: 'bg-signal-watch-bg',
    text:    'text-signal-watch',
    border:  'border-signal-watch/30',
    glow:    'shadow-hold-glow',
  },

  REALLOCATE: {
    surface: 'bg-signal-hold-bg',
    text:    'text-signal-hold',
    border:  'border-signal-hold/30',
    glow:    'shadow-hold-glow',
  },

  REFRESH: {
    surface: 'bg-signal-watch-bg',
    text:    'text-signal-watch',
    border:  'border-signal-watch/30',
    glow:    'shadow-hold-glow',
  },

  OPTIMIZE: {
    surface: 'bg-stage-testing/10',
    text:    'text-stage-testing',
    border:  'border-stage-testing/30',
    glow:    'shadow-optimize-glow',
  },

  // Generic alert states (future)
  WARNING: {
    surface: 'bg-signal-hold-bg',
    text:    'text-signal-hold',
    border:  'border-signal-hold/30',
    glow:    'shadow-hold-glow',
  },

  SUCCESS: {
    surface: 'bg-signal-scale-bg',
    text:    'text-signal-scale',
    border:  'border-signal-scale/30',
    glow:    'shadow-scale-glow',
  },

  DANGER: {
    surface: 'bg-signal-kill-bg',
    text:    'text-signal-kill',
    border:  'border-signal-kill/30',
    glow:    'shadow-kill-glow',
  },
};

// Helper: Get signal tokens by verdict string
export function getSignalTokens(verdict) {
  const signal = SIGNALS[verdict?.toUpperCase()];
  if (!signal) {
    console.warn(`[signals] Unknown verdict "${verdict}". Falling back to HOLD.`);
    return SIGNALS.HOLD;
  }
  return signal;
}
