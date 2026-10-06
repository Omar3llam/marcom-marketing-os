import { STATE_CFG } from '../utils/stateConfig.js';

export function StatePill({ state, size = 'sm' }) {
  const c = STATE_CFG[state] || { label: state || 'Unknown state', color: 'var(--c-text-muted)', bg: 'var(--c-surface-elevated)', dot: 'muted' };
  const dot = c.dot;
  const fs = 12;
  return (
    <span className="font-mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: size === 'lg' ? '4px 10px' : '2px 8px',
      borderRadius: 4,
      fontSize: fs,
      fontWeight: 600,
      letterSpacing: '0.08em',
      background: c.bg,
      color: 'var(--c-text-base)',
      overflowWrap: 'anywhere',
      border: `1px solid ${c.color}33`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: c.color,
        opacity: dot === 'faded' ? 0.4 : dot === 'muted' ? 0.6 : 1,
        boxShadow: dot === 'pulse' ? `0 0 6px ${c.color}` : dot === 'sharp' ? `0 0 8px ${c.color}` : 'none',
        animation: dot === 'pulse' ? 'intel-pulse 1.4s ease-in-out infinite' : 'none',
      }} />
      {c.label}
    </span>
  );
}
