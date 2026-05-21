// ============================================================
// Operations · Execution Timeline
// ============================================================
// Per-execution transition chain with correlation lineage +
// version-jump sidebar. Loaded via GET /:id/transitions.
// ============================================================
import { useState, useEffect } from 'react';
import { History, AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../../../lib/api.js';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { PanelMessage } from './components/PanelMessage.jsx';
import { LoadingBlock } from './components/LoadingBlock.jsx';
import { STATE_CFG } from './utils/stateConfig.js';
import { shortId, durationBetween, formatTs } from './utils/formatting.js';

export function ExecutionTimeline({ executionId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/api/execute/${executionId}/transitions`)
      .then((res) => { if (!cancelled) { setData(res.data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load transitions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [executionId]);

  if (!executionId) {
    return (
      <PanelMessage
        icon={History}
        title="No execution selected"
        hint="Pick a row from the Live Monitor to see its transition chain."
      />
    );
  }
  if (loading && !data) return <LoadingBlock label="Loading transitions…" />;
  if (error) return <PanelMessage icon={AlertTriangle} title="Could not load timeline" hint={error} />;
  if (!data) return null;

  const { execution, transitions } = data;
  const rows = transitions.map((t, i, arr) => ({
    ...t,
    delta: i > 0 ? durationBetween(arr[i - 1].createdAt, t.createdAt) : '',
  }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <div>
            <button
              type="button"
              onClick={onBack}
              className="font-mono"
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--c-text-muted)', fontSize: 11, letterSpacing: '0.06em',
                textTransform: 'uppercase', marginBottom: 6,
              }}
            >
              ← Live Monitor
            </button>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold-deep)' }}>
              Execution
            </div>
            <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 2 }}>
              #{shortId(execution.id)} · {execution.actionType}
            </div>
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
              {execution.correlationId || 'no correlation'} · v={execution.version}
            </div>
          </div>
          <StatePill state={execution.status} size="lg" />
        </div>

        {rows.length === 0 ? (
          <PanelMessage icon={History} title="No transitions recorded" hint="This execution hasn't moved through any states yet." />
        ) : (
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 8, boxShadow: 'var(--sh-card)' }}>
            {rows.map((r, i) => (
              <TransitionRow key={r.id} r={r} last={i === rows.length - 1} />
            ))}
          </div>
        )}

        <div className="font-mono" style={{ marginTop: 12, fontSize: 10, color: 'var(--c-text-subtle)' }}>
          {rows.length > 0 && rows[0].createdAt && rows[rows.length - 1].createdAt && (
            <>
              Total wall time: <span style={{ color: 'var(--c-text-base)' }}>
                {((new Date(rows[rows.length - 1].createdAt).getTime() - new Date(rows[0].createdAt).getTime()) / 1000).toFixed(2)}s
              </span>
              {' · '}{rows.length} transition{rows.length === 1 ? '' : 's'}
            </>
          )}
        </div>
      </div>

      <aside>
        <div className="section-label" style={{ marginBottom: 10 }}>Correlation lineage</div>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 14, boxShadow: 'var(--sh-card)' }}>
          {execution.correlationId ? (
            <>
              <LineageRow id={execution.correlationId} label="Correlation root" cur={false} first />
              <LineageRow id={`↳ #${shortId(execution.id)}`} label={execution.actionType} cur />
            </>
          ) : (
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
              No correlation ID attached to this execution.
            </div>
          )}
        </div>

        <div className="section-label" style={{ marginTop: 18, marginBottom: 10 }}>Version jumps</div>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 14 }}>
          {rows.length === 0 ? (
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>—</div>
          ) : (
            rows.map((r, i) => (
              <VersionDelta
                key={r.id}
                from={r.previousVersion}
                to={r.newVersion}
                actor={r.actor}
                highlight={r.toStatus === 'RETRYING' || r.toStatus === 'EXECUTING' && r.fromStatus === 'RETRYING'}
                first={i === 0}
              />
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Private helpers ──────────────────────────────────────────

function LineageRow({ id, label, cur, first }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: first ? 'none' : '1px dashed var(--c-surface-border)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cur ? 'var(--c-gold)' : 'var(--c-surface-border-strong)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-mono" style={{ fontSize: 11, color: cur ? 'var(--c-text-base)' : 'var(--c-text-soft)', fontWeight: cur ? 600 : 400 }}>{id}</div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 1 }}>{label}</div>
      </div>
    </div>
  );
}

function TransitionRow({ r, last }) {
  const toCfg = STATE_CFG[r.toStatus] || STATE_CFG.PENDING;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 22px 1fr 120px 60px', gap: 14, alignItems: 'center', padding: '10px 12px', borderBottom: last ? 'none' : '1px solid var(--c-surface-border)' }}>
      <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{formatTs(r.createdAt)}</span>
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: toCfg.color,
          boxShadow: r.toStatus === 'EXECUTING' || r.toStatus === 'RETRYING' ? `0 0 8px ${toCfg.color}` : 'none',
        }} />
        {!last && <span style={{ position: 'absolute', top: 14, width: 1, height: 18, background: 'var(--c-surface-border)' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <StatePill state={r.fromStatus} />
        <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
        <StatePill state={r.toStatus} />
        {r.reason && (
          <span style={{ fontSize: 11, color: 'var(--c-text-soft)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
        )}
      </div>
      <ActorBadge name={r.actor} />
      <span className="font-mono tabular-nums" style={{ fontSize: 10, color: 'var(--c-text-subtle)', textAlign: 'right' }}>{r.delta}</span>
    </div>
  );
}

function VersionDelta({ from, to, actor, highlight, first }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: first ? 'none' : '1px dashed var(--c-surface-border)' }}>
      <span className="font-mono tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: highlight ? 'var(--c-gold-deep)' : 'var(--c-text-soft)' }}>v{from}</span>
      <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
      <span className="font-mono tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: highlight ? 'var(--c-gold-deep)' : 'var(--c-text-base)' }}>v{to}</span>
      <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actor}</span>
    </div>
  );
}
