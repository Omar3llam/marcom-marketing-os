import { useEffect } from 'react';
import { X } from 'lucide-react';

// Raw JSON view of the transition chain — the forensic "show me everything"
// surface. No additional fetch needed: the Incident Panel already loaded
// the transitions when it mounted via GET /api/execute/:id/incident.
export function RawAuditLogModal({ executionId, transitions, onClose }) {
  // Close on Escape for keyboard ergonomics.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Raw audit log for execution ${executionId}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(11,11,15,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(900px, 100%)',
          maxHeight: '80vh',
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border-strong)',
          borderRadius: 16,
          boxShadow: 'var(--sh-card-hover)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--c-surface-border)' }}>
          <div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Raw audit log
            </div>
            <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 2 }}>
              #{(executionId || '').slice(-6).toUpperCase()} · {transitions.length} transition{transitions.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close raw audit log"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 6, borderRadius: 8, color: 'var(--c-text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <pre
          className="font-mono"
          style={{
            margin: 0,
            padding: 18,
            overflow: 'auto',
            background: 'var(--c-surface-elevated)',
            color: 'var(--c-text-base)',
            fontSize: 11,
            lineHeight: 1.55,
            flex: 1,
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
          }}
        >
          {JSON.stringify(transitions, null, 2)}
        </pre>
      </div>
    </div>
  );
}
