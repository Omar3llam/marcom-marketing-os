// ============================================================
// Operations · Incident Panel
// ============================================================
// Failure forensics: transition chain (with collision rows
// red-railed), telemetry, collision graph, retry action, and
// raw-audit-log modal. Loaded via GET /:id/incident.
// ============================================================
import { useState, useEffect } from 'react';
import { AlertTriangle, ArrowRight, RotateCcw, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/api.js';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { PanelMessage } from './components/PanelMessage.jsx';
import { LoadingBlock } from './components/LoadingBlock.jsx';
import { CollisionGraph } from './components/CollisionGraph.jsx';
import { RawAuditLogModal } from './components/RawAuditLogModal.jsx';
import { FAILURE } from './utils/stateConfig.js';
import { shortId, formatTs } from './utils/formatting.js';

export function IncidentPanel({ executionId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/api/execute/${executionId}/incident`)
      .then((res) => { if (!cancelled) { setData(res.data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load incident'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [executionId]);

  const handleRetry = async () => {
    if (!executionId || retrying) return;
    setRetrying(true);
    try {
      const { data: result } = await api.post(`/api/execute/${executionId}/retry`);
      toast.success(`Retry queued · #${(result.executionId || '').slice(-6).toUpperCase()}`, {
        description: 'New execution created with preserved correlation lineage.',
      });
      // Return to the Live Monitor so the operator sees the new QUEUED row
      // (delivered via the SSE channel from the lifecycle service).
      onBack();
    } catch (err) {
      const code = err?.response?.data?.code;
      const message = err?.response?.data?.error || err?.message || 'Retry failed';
      toast.error(code === 'NOT_RETRYABLE' ? 'Execution is not retryable' : 'Retry failed', {
        description: message,
      });
    } finally {
      setRetrying(false);
    }
  };

  if (!executionId) {
    return (
      <PanelMessage
        icon={AlertTriangle}
        title="No execution selected"
        hint="Pick a failed row from the Live Monitor to inspect the incident."
      />
    );
  }
  if (loading && !data) return <LoadingBlock label="Loading incident…" />;
  if (error) return <PanelMessage icon={AlertTriangle} title="Could not load incident" hint={error} />;
  if (!data) return null;

  const { execution, transitions, incident } = data;

  if (!incident) {
    return (
      <PanelMessage
        icon={AlertTriangle}
        title="No incident for this execution"
        hint={`#${shortId(execution.id)} is in ${execution.status} — incident view is for failed executions only.`}
      />
    );
  }

  const toneColor = (t) => t === 'kill' ? 'var(--c-kill-text)' : t === 'hold' ? 'var(--c-hold-text)' : 'var(--c-text-base)';
  const toneBg    = (t) => t === 'kill' ? 'var(--c-kill-bg)'   : t === 'hold' ? 'var(--c-hold-bg)'   : 'var(--c-surface-elevated)';

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="font-mono"
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--c-text-muted)', fontSize: 11, letterSpacing: '0.06em',
          textTransform: 'uppercase', marginBottom: 12,
        }}
      >
        ← Live Monitor
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18, background: 'var(--c-surface-card)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, marginBottom: 18, boxShadow: '0 0 24px rgba(239,68,68,0.06)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--c-kill-bg)', color: 'var(--c-kill-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <AlertTriangle size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>
            Execution #{shortId(execution.id)} · {incident.title}
          </div>
          <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-soft)', marginTop: 2 }}>
            Cause: <span style={{ color: 'var(--c-kill-text)', fontWeight: 600 }}>{incident.cause}</span> · Winner: <strong>{incident.winner}</strong> · Loser: <strong>{incident.loser}</strong>
          </div>
        </div>
        <StatePill state={execution.status} size="lg" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18 }}>
        <div>
          <div className="section-label" style={{ marginBottom: 10 }}>Transition chain</div>
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 8, marginBottom: 18, boxShadow: 'var(--sh-card)' }}>
            {transitions.map((t, i) => {
              const isFailureRow = FAILURE.includes(t.toStatus);
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr 110px',
                    gap: 12,
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderBottom: i === transitions.length - 1 ? 'none' : '1px solid var(--c-surface-border)',
                    background: isFailureRow ? 'rgba(239,68,68,0.04)' : 'transparent',
                    borderLeft: isFailureRow ? '2px solid var(--c-kill)' : '2px solid transparent',
                  }}
                >
                  <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{formatTs(t.createdAt)}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatePill state={t.fromStatus} />
                    <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
                    <StatePill state={t.toStatus} />
                  </div>
                  <ActorBadge name={t.actor} />
                </div>
              );
            })}
          </div>

          <div className="section-label" style={{ marginBottom: 10 }}>Collision resolution</div>
          <CollisionGraph graph={incident.graph} />
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: 10 }}>Telemetry</div>
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 4, boxShadow: 'var(--sh-card)' }}>
            {incident.telemetry.map((t, i) => (
              <div
                key={t.tag}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 1fr',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: i === incident.telemetry.length - 1 ? 'none' : '1px solid var(--c-surface-border)',
                  alignItems: 'center',
                }}
              >
                <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{t.tag}</span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 12,
                    color: toneColor(t.tone),
                    fontWeight: t.tone !== 'neutral' ? 600 : 400,
                    padding: t.tone !== 'neutral' ? '2px 8px' : 0,
                    borderRadius: 4,
                    background: t.tone !== 'neutral' ? toneBg(t.tone) : 'transparent',
                    display: 'inline-block',
                    justifySelf: 'start',
                  }}
                >
                  {t.value}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexDirection: 'column' }}>
            <button
              type="button"
              className="btn-gold"
              style={{ width: '100%', justifyContent: 'center', padding: '11px 14px', fontSize: 13, opacity: retrying ? 0.7 : 1 }}
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? <Loader2 size={14} style={{ animation: 'intel-pulse 1.4s ease-in-out infinite' }} /> : <RotateCcw size={14} />}
              {retrying ? 'Queueing retry…' : 'Retry from last known good'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{ width: '100%', justifyContent: 'center', padding: '10px 14px', fontSize: 13 }}
              onClick={() => setAuditOpen(true)}
            >
              <FileText size={13} />
              Open raw audit log
            </button>
          </div>
        </div>
      </div>

      {auditOpen && (
        <RawAuditLogModal
          executionId={execution.id}
          transitions={transitions}
          onClose={() => setAuditOpen(false)}
        />
      )}
    </div>
  );
}
