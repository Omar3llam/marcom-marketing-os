// ============================================================
// Operations · state design language (UI visual config)
// ------------------------------------------------------------
// Visual representation (color / bg / label / dot style) for every
// execution status the runtime can emit. Backend uses
// EXECUTED_SUCCESS / EXECUTED_FAILED canonically; we map the
// shorthand SUCCESS / FAILED here too so either resolves.
//
// Semantic categorizations (IN_FLIGHT_STATUSES, FAILURE_STATUSES,
// transition matrix, etc.) live in @marcom/runtime-contracts.
// ============================================================

export const STATE_CFG = {
  PENDING:          { color: 'var(--c-text-muted)',  bg: 'var(--c-surface-elevated)', label: 'PENDING',   dot: 'muted' },
  QUEUED:           { color: '#3B82F6',              bg: 'rgba(59,130,246,0.10)',     label: 'QUEUED',    dot: 'blue'  },
  EXECUTING:        { color: 'var(--c-gold-deep)',   bg: 'rgba(246,201,69,0.12)',     label: 'EXECUTING', dot: 'pulse' },
  RETRYING:         { color: '#A855F7',              bg: 'rgba(168,85,247,0.10)',     label: 'RETRYING',  dot: 'pulse' },
  SUCCESS:          { color: 'var(--c-scale-text)',  bg: 'var(--c-scale-bg)',         label: 'SUCCESS',   dot: 'solid' },
  EXECUTED_SUCCESS: { color: 'var(--c-scale-text)',  bg: 'var(--c-scale-bg)',         label: 'SUCCESS',   dot: 'solid' },
  FAILED:           { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)',          label: 'FAILED',    dot: 'sharp' },
  EXECUTED_FAILED:  { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)',          label: 'FAILED',    dot: 'sharp' },
  TIMED_OUT:        { color: 'var(--c-hold-text)',   bg: 'var(--c-hold-bg)',          label: 'TIMED_OUT', dot: 'warn'  },
  CANCELLED:        { color: 'var(--c-text-subtle)', bg: 'var(--c-surface-elevated)', label: 'CANCELLED', dot: 'faded' },
};
