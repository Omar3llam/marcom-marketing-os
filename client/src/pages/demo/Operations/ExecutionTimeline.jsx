// ============================================================
// Operations · Execution Timeline
// ============================================================
import { useState, useEffect, useMemo } from 'react';
import { History, AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../../../lib/api.js';
import { StatePill } from './components/StatePill.jsx';
import { PanelMessage } from './components/PanelMessage.jsx';
import { LoadingBlock } from './components/LoadingBlock.jsx';
import { getTimeoutOverageMs } from '@marcom/runtime-contracts';
import { shortId } from './utils/formatting.js';
import { TransitionRow } from './TimelineRow.jsx';
import styles from './Operations.module.css';

export function ExecutionTimeline({ executionId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    setData(null);
    setLoading(true);
    api.get(`/api/execute/${executionId}/transitions`)
      .then((res) => {
        if (!res.data?.execution?.id || !Array.isArray(res.data.transitions)
          || res.data.transitions.some(t => !t.id || typeof t.createdAt !== 'string' || !Number.isFinite(Date.parse(t.createdAt)))) {
          throw new Error('The response did not contain a usable transition history.');
        }
        if (!cancelled) { setData(res.data); setError(null); }
      })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load transitions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [executionId]);

  const rows = useMemo(() => {
    if (!data?.transitions) return [];
    return data.transitions.map((t, i, arr) => {
      const prevTs = i > 0 ? arr[i - 1].createdAt : null;
      const measuredMs = prevTs ? new Date(t.createdAt).getTime() - new Date(prevTs).getTime() : null;
      const deltaMs = Number.isFinite(measuredMs) && measuredMs >= 0 ? measuredMs : null;
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
    <div className={styles.eventLayout}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <div>
            <button
              type="button"
              onClick={onBack}
              className="font-mono"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-text-muted)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}
            >
              ← Live Monitor
            </button>
            <div className="font-mono" style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
              Execution
            </div>
            <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 2 }}>
              #{shortId(execution.id)} · {execution.actionType}
            </div>
            <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>
              {execution.correlationId || 'no correlation'} · version {execution.version ?? '—'}
            </div>
          </div>
          <StatePill state={execution.status} size="lg" />
        </div>

        {rows.length === 0 ? (
          <PanelMessage icon={History} title="No transitions recorded" hint="No persisted transitions were returned for this execution." />
        ) : (
          <ol aria-label="Transition history" className={styles.transitionHistory}>
            {rows.map((r, i) => (
              <TransitionRow key={r.id} r={r} last={i === rows.length - 1} />
            ))}
          </ol>
        )}
        {summary && <SummaryBanner summary={summary} transitionCount={rows.length} />}
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
            <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
              No correlation ID attached to this execution.
            </div>
          )}
        </div>

        <div className="section-label" style={{ marginTop: 18, marginBottom: 10 }}>Version jumps</div>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 14 }}>
          {rows.length === 0 ? (
            <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>—</div>
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
  return <p className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-soft)', margin: '0 0 12px', overflowWrap: 'anywhere' }}>
    {transitionCount} transitions · {retries} {retries === 1 ? 'retry' : 'retries'} · {occConflicts} OCC {occConflicts === 1 ? 'conflict' : 'conflicts'} · {timeouts} {timeouts === 1 ? 'timeout' : 'timeouts'} · {overages} timeout overages · observed span {totalWallSec.toFixed(2)}s
  </p>;
}

function LineageRow({ id, label, cur, first }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: first ? 'none' : '1px dashed var(--c-surface-border)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cur ? 'var(--c-gold)' : 'var(--c-surface-border-strong)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-mono" style={{ fontSize: 12, color: cur ? 'var(--c-text-base)' : 'var(--c-text-soft)', fontWeight: cur ? 600 : 400 }}>{id}</div>
        <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 1 }}>{label}</div>
      </div>
    </div>
  );
}

function VersionDelta({ from, to, actor, highlight, first }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: first ? 'none' : '1px dashed var(--c-surface-border)' }}>
      <span className="font-mono tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: highlight ? 'var(--c-text-base)' : 'var(--c-text-soft)' }}>{from == null ? '—' : `v${from}`}</span>
      <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
      <span className="font-mono tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-base)' }}>{to == null ? '—' : `v${to}`}</span>
      <span className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', marginLeft: 6, overflowWrap: 'anywhere' }}>{actor}</span>
    </div>
  );
}
