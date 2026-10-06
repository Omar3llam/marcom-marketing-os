// ============================================================
// Operations · Live Monitor
// ============================================================
// Real-time grid of in-flight executions. SSE primary, 30s
// safety-net poll. Version-filtered merges keep state coherent
// against out-of-order packets.
// ============================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, AlertTriangle, Search } from 'lucide-react';
import { api } from '../../../lib/api.js';
import { connectExecutionStream } from '../../../lib/events.js';
import { auth } from '../../../firebase.js';
import { IN_FLIGHT_STATUSES, FAILURE_STATUSES } from '@marcom/runtime-contracts';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { PanelMessage } from './components/PanelMessage.jsx';
import { LoadingBlock } from './components/LoadingBlock.jsx';
import { shortId, formatAge } from './utils/formatting.js';
import styles from './Operations.module.css';

// 1-second tick used to repaint age + stale state without re-fetching.
// Pure clock — no execution-list mutations happen on this interval.
function useNowTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Status predicates — hoisted out of the component so they keep a
// stable identity (cleaner deps for useMemo).
const isInFlight = (s) => IN_FLIGHT_STATUSES.includes(s);
const isFailed   = (s) => FAILURE_STATUSES.includes(s);
const isStale    = (e) => isInFlight(e.status) && typeof e.liveAgeSeconds === 'number' && e.liveAgeSeconds > 30;

const FILTERS = ['all', 'in-flight', 'failed', 'stale'];

export function LiveMonitor({ onOpen, onOpenIncident }) {
  const [filter, setFilter] = useState('all');
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sseConnected, setSseConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/execute/active');
      if (!Array.isArray(data?.executions) || data.executions.some(e => !e?.id)) throw new Error('The execution list could not be established from this response.');
      setExecutions(data.executions);
      setError(null);
    } catch (err) {
      setError(err?.message || 'Failed to load executions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + safety-net poll (30s, slower than before because SSE
  // is the primary delivery channel now).
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  // SSE subscription — merges execution.transition events into the list
  // with a version filter so out-of-order packets never regress state.
  useEffect(() => {
    const getToken = () => auth.currentUser?.getIdToken();

    const disconnect = connectExecutionStream(getToken, {
      onConnected: () => setSseConnected(true),
      onError: () => setSseConnected(false),
      onTransition: (event) => {
        const incoming = event.execution;
        if (!incoming?.id) return;

        const incomingActor = event.actor || 'SYSTEM';
        const isTerminalIncoming = !IN_FLIGHT_STATUSES.includes(incoming.status);

        setExecutions((prev) => {
          const idx = prev.findIndex((row) => row.id === incoming.id);

          // Terminal arrives for an unknown row → nothing to do.
          if (idx === -1) {
            if (isTerminalIncoming) return prev;
            // New in-flight execution we haven't seen yet — inject.
            return [
              {
                id: incoming.id,
                actionType: incoming.actionType,
                targetId: incoming.targetId,
                status: incoming.status,
                version: incoming.version,
                correlationId: incoming.correlationId,
                createdAt: incoming.updatedAt,
                updatedAt: incoming.updatedAt,
                actor: incomingActor,
                ageSeconds: 0,
              },
              ...prev,
            ];
          }

          const existing = prev[idx];

          // CRITICAL STALE-EVENT LAW: drop out-of-order packets.
          // incoming.version <= existing.version → REGRESSION, ignore.
          if (typeof incoming.version === 'number'
              && typeof existing.version === 'number'
              && incoming.version <= existing.version) {
            return prev;
          }

          // Terminal transition → row leaves the in-flight list.
          if (isTerminalIncoming) {
            return prev.filter((_, i) => i !== idx);
          }

          // In-flight update → replace in place, preserving createdAt
          // so the "Duration" column stays anchored to original start.
          const updatedAt = incoming.updatedAt || new Date().toISOString();
          const ageSeconds = Math.max(
            0,
            Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000),
          );
          const next = [...prev];
          next[idx] = {
            ...existing,
            status: incoming.status,
            version: incoming.version,
            correlationId: incoming.correlationId ?? existing.correlationId,
            updatedAt,
            actor: incomingActor,
            ageSeconds,
          };
          return next;
        });
      },
    });

    return () => {
      disconnect();
      setSseConnected(false);
    };
  }, []);

  // 1-second clock for animated age + stale evaluation. Decoupled from
  // state mutations so the executions list isn't reallocated each tick.
  const now = useNowTick(1000);

  // Each row is recomputed against `now` so age stays fresh between
  // SSE events. Pure projection of state + clock; no allocations on
  // unrelated re-renders.
  const liveRows = useMemo(() => executions.map((e) => {
    const updatedAtMs = e.updatedAt ? new Date(e.updatedAt).getTime() : null;
    const liveAgeSeconds = updatedAtMs != null
      ? Math.max(0, Math.floor((now - updatedAtMs) / 1000))
      : e.ageSeconds;
    return { ...e, liveAgeSeconds };
  }), [executions, now]);

  const rows = useMemo(() => liveRows.filter((e) => {
    if (filter === 'in-flight') return isInFlight(e.status);
    if (filter === 'failed')    return isFailed(e.status);
    if (filter === 'stale')     return isStale(e);
    return true;
  }), [liveRows, filter]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="font-mono"
              style={{
                padding: '6px 12px',
                background: filter === f ? 'var(--c-lumi-elevated)' : 'transparent',
                border: `1px solid ${filter === f ? 'var(--c-surface-border-strong)' : 'var(--c-surface-border)'}`,
                color: filter === f ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--c-text-muted)',
            }} />
            {sseConnected ? 'SSE connected' : 'Polling fallback'} · {loading ? 'Reading executions' : error ? 'Read unavailable' : `${rows.length} rows`}
          </span>
          <button type="button" className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}>
            <Search size={12} />
            Search
          </button>
        </div>
      </div>

      {loading && executions.length === 0 ? (
        <LoadingBlock label="Loading active executions…" />
      ) : error ? (
        <PanelMessage icon={AlertTriangle} title="Could not load executions" hint={error} />
      ) : rows.length === 0 ? (
        <PanelMessage
          icon={Activity}
          title="No executions match this filter"
          hint="No executions from the current read match the selected filter."
        />
      ) : (
        <div className={styles.executionList}>
          {rows.map((e) => {
            const failed = isFailed(e.status);
            const onClick = () => (failed ? onOpenIncident(e.id) : onOpen(e.id));
            const durationMs = e.createdAt && e.updatedAt
              ? new Date(e.updatedAt).getTime() - new Date(e.createdAt).getTime() : null;
            const duration = Number.isFinite(durationMs) && durationMs >= 0 ? `${Math.round(durationMs / 1000)}s` : '—';
            const facts = [
              ['Action', e.actionType || '—'], ['Target', e.targetId || '—'],
              ['Correlation', e.correlationId || '—'], ['Actor', e.actor ? <ActorBadge name={e.actor} /> : '—'],
              ['Version', e.version == null ? '—' : `v${e.version}`],
              ['Age since update', formatAge(e.liveAgeSeconds)], ['Duration', duration],
            ];
            return <article key={e.id} aria-label={`Execution ${shortId(e.id)}`} className={styles.executionRecord}>
              <div className={styles.executionIdentity}>
                <button type="button" onClick={onClick} className={styles.executionOpen}>Open execution #{shortId(e.id)}</button>
                <StatePill state={e.status} />
              </div>
              <dl className={styles.eventFacts}>{facts.map(([label, value]) => <div key={label}>
                <dt>{label}</dt><dd className="font-mono">{value}</dd>
              </div>)}</dl>
              {isStale(e) && <p className={styles.eventReason}>Stale by the current in-flight age filter (&gt;30s).</p>}
            </article>;
          })}
        </div>
      )}

      <div className="font-mono" style={{ marginTop: 12, fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
        <span><span aria-hidden="true" style={{ color: 'var(--c-hold)' }}>●</span> stale = in-flight &gt; 30s</span>
        <span>·</span>
        <span>workspace-isolated · SSE primary · 30s safety-net poll</span>
      </div>
    </div>
  );
}
