import { X } from 'lucide-react';
import { StatePill } from './StatePill.jsx';

export function CollisionGraph({ graph }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 24, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            State at collision
          </div>
          <StatePill state={graph.from} size="lg" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <X size={40} strokeWidth={2} style={{ color: 'var(--c-kill)' }} />
            <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '1px dashed var(--c-kill)', opacity: 0.4 }} />
          </div>
          <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-kill-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>contention</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ padding: 12, background: 'var(--c-scale-bg)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10 }}>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-scale-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Winner</div>
            <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 2 }}>{graph.winner}</div>
          </div>
          <div style={{ padding: 12, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 10, opacity: 0.7 }}>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Loser</div>
            <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-soft)', marginTop: 2, textDecoration: 'line-through' }}>{graph.loser}</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--c-surface-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>Resolved to</span>
        <StatePill state={graph.resolution} size="lg" />
      </div>
    </div>
  );
}
