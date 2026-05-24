// ============================================================
// Operations · Execution Timeline
// ============================================================
import { useState, useEffect, useMemo } from 'react';
import { History, AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../../../lib/api.js';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { PanelMessage } from './components/PanelMessage.jsx';
import { LoadingBlock } from './components/LoadingBlock.jsx';
import { getTimeoutOverageMs } from '@marcom/runtime-contracts';
import { shortId, formatTs } from './utils/formatting.js';
import { TransitionRow } from './TimelineRow.jsx';

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

  const rows = useMemo(() => {
    if (!data?.transitions) return [];
    return data.transitions.map((t, i, arr) => {
      const prevTs = i > 0 ? arr[i - 1].createdAt : null;
      const deltaMs = prevTs ? new Date(t.createdAt).getTime() - new Date(prevTs).getTime() : null;
      const overageMs = i > 0 ? getTimeoutOverageMs(t.fromStatus, deltaMs) : null;
      const occConflict = Boolean(t.metadata && t.metadata.occConflict);
      return { ...t, deltaMs, overageMs, occConflict };
    });
  }, [data]);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const retries      = rows.filter((r) => r.toStatus === 'RETRYING').length;
    const occConflicts = rows.filter((r) => r.occConflict).length;
    const timeouts     = rows.filter((r) => r.toStatus === 'TIMED_OUT').length;
    const overages     = rows.filter((r) => r.overageMs != null).length;
    const firstMs      = new Date(rows[0].createdAt).getTime();
    const lastMs       = new Date(rows[rows.length - 1].createdAt).getTime();
    const totalWallSec = Math.max(0, (lastMs - firstMs) / 1000);
    return { retries, occConflicts, timeouts, overages, totalWallSec };
  }, [rows]);

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

  const { execution } = data;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <div>
            <button
              type="button"
              onClick={onBack}
              className="font-mono"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}
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

        {summary && <SummaryBanner summary={summary} transitionCount={rows.length} />}

        {rows.length === 0 ? (
          <PanelMessage icon={History} title="No transitions recorded" hint="This execution hasn't moved through any states yet." />
        ) : (
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 8, boxShadow: 'var(--sh-card)' }}>
            {rows.map((r, i) => (
              <TransitionRow key={r.id} r={r} last={i === rows.length - 1} />
            ))}
          </div>
        )}
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
                highlight={r.toStatus === 'RETRYING' || (r.toStatus === 'EXECUTING' && r.fromStatus === 'RETRYING')}
                first={i === 0}
              />
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function SummaryBanner({ summary, transitionCount }) {
  const { retries, occConflicts, timeouts, overages, totalWallSec } = summary;
  const items = [
    { label: 'Wall time',     value: `${totalWallSec.toFixed(2)}s`, tone: 'neutral' },
    { label: 'Transitions',   value: String(transitionCount),        tone: 'neutral' },
    { label: 'Retries',       value: String(retries),     tone: retries > 0 ? 'hold' : 'neutral' },
    { label: 'OCC conflicts', value: String(occConflicts), tone: occConflicts > 0 ? 'kill' : 'neutral' },
    { label: 'Timeouts',      value: String(timeouts),    tone: timeouts > 0 ? 'kill' : 'neutral' },
    { label: 'Overages',      value: String(overages),    tone: overages > 0 ? 'hold' : 'neutral' },
  ];
  const colorFor = (t) => t === 'kill' ? 'var(--c-kill-text)' : t === 'hold' ? 'var(--c-hold-text)' : 'var(--c-text-base)';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, marginBottom: 12, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
      {items.map((it, i) => (
        <div key={it.label} style={{ padding: '10px 14px', borderRight: i < items.length - 1 ? '1px solid var(--c-surface-border)' : 'none' }}>
          <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{it.label}</div>
          <div className="font-mono tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: colorFor(it.tone), marginTop: 2 }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

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
