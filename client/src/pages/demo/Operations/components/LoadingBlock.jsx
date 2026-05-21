import { Loader2 } from 'lucide-react';

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div style={{
      background: 'var(--c-surface-card)',
      border: '1px solid var(--c-surface-border)',
      borderRadius: 14,
      padding: '40px 24px',
      textAlign: 'center',
      color: 'var(--c-text-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    }}>
      <Loader2 size={16} className="anim-spin" style={{ animation: 'intel-pulse 1.4s ease-in-out infinite' }} />
      <span className="font-mono" style={{ fontSize: 12 }}>{label}</span>
    </div>
  );
}
