// ============================================================
// Operations · Live Monitor
// ============================================================
// Real-time grid of in-flight executions. SSE primary, 30s
// safety-net poll. Version-filtered merges keep state coherent
// against out-of-order packets.
// ============================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, AlertTriangle, Search, ChevronRight } from 'lucide-react';
import { api } from '../../../lib/api.js';
import { connectExecutionStream } from '../../../lib/events.js';
import { auth } from '../../../firebase.js';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { PanelMessage } from './components/PanelMessage.jsx';
import { LoadingBlock } from './components/LoadingBlock.jsx';
import { IN_FLIGHT, FAILURE } from './utils/stateConfig.js';
import { shortId, formatAge } from './utils/formatting.js';

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
const isInFlight = (s) => IN_FLIGHT.includes(s);
const isFailed   = (s) => FAILURE.includes(s);
const isStale    = (e) => isInFlight(e.status) && typeof e.liveAgeSeconds === 'number' && e.liveAgeSeconds > 30;

const GRID_COLS = '90px 1fr 130px 140px 80px 80px 90px 90px 32px';
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
      setExecutions(data.executions || []);
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
        const isTerminalIncoming = !IN_FLIGHT.includes(incoming.status);

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
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="font-mono"
              style={{
                padding: '6px 12px',
                background: filter === f ? 'var(--c-lumi-elevated)' : 'transparent',
                border: `1px solid ${filter === f ? 'var(--c-surface-border-strong)' : 'var(--c-surface-border)'}`,
                color: filter === f ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                borderRadius: 999,
                fontSize: 11,
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
          <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: sseConnected ? 'var(--c-scale)' : 'var(--c-hold)',
              boxShadow: sseConnected ? '0 0 6px var(--c-scale)' : '0 0 6px var(--c-hold)',
              animation: 'intel-pulse 1.6s ease-in-out infinite',
            }} />
            {sseConnected ? 'SSE live' : 'Polling fallback'} · {rows.length} rows
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
          hint="The runtime is idle, or your filter is too narrow."
        />
      ) : (
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, gap: 12, padding: '12px 16px', background: 'var(--c-surface-elevated)', borderBottom: '1px solid var(--c-surface-border)' }}>
            {['Exec ID', 'Action / Target', 'State', 'Correlation', 'Actor', 'Ver', 'Age', 'Duration', ''].map((h, idx) => (
              <span key={`${h}-${idx}`} className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
                {h}
              </span>
            ))}
          </div>
          {rows.map((e) => {
            const stale = isStale(e);
            const failed = isFailed(e.status);
            const onClick = () => (failed ? onOpenIncident(e.id) : onOpen(e.id));
            const duration = e.createdAt && e.updatedAt
              ? `${Math.max(0, Math.round((new Date(e.updatedAt).getTime() - new Date(e.createdAt).getTime()) / 1000))}s`
              : '—';
            return (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={onClick}
                onKeyDown={(ev) => { if (ev.key === 'Enter') onClick(); }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID_COLS,
                  gap: 12,
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--c-surface-border)',
                  alignItems: 'center',
                  background: stale ? 'rgba(245,158,11,0.04)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 120ms',
                }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = stale ? 'rgba(245,158,11,0.08)' : 'var(--c-surface-elevated)'; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = stale ? 'rgba(245,158,11,0.04)' : 'transparent'; }}
              >
                <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)' }}>#{shortId(e.id)}</span>
                <div>
                  <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-base)' }}>{e.actionType}</div>
                  <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 2 }}>→ {e.targetId || '—'}</div>
                </div>
                <StatePill state={e.status} />
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>{e.correlationId || '—'}</span>
                <ActorBadge name={e.actor || 'SYSTEM'} />
                <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>v{e.version ?? 0}</span>
                <span className="font-mono tabular-nums" style={{ fontSize: 11, color: stale ? 'var(--c-hold-text)' : 'var(--c-text-muted)' }}>
                  {stale && <AlertTriangle size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                  {formatAge(e.liveAgeSeconds)}
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{duration}</span>
                <ChevronRight size={14} style={{ color: 'var(--c-text-subtle)' }} />
              </div>
            );
          })}
        </div>
      )}

      <div className="font-mono" style={{ marginTop: 12, fontSize: 10, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span><span style={{ color: 'var(--c-hold)' }}>●</span> stale = in-flight &gt; 30s</span>
        <span>·</span>
        <span>workspace-isolated · SSE primary · 30s safety-net poll</span>
      </div>
    </div>
  );
}
