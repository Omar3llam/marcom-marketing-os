// ============================================================
// Marcom AI — Operations / Runtime panel  (demo route)
// ------------------------------------------------------------
// "MRI scanner for the runtime." Four sub-views:
//   1. Live Monitor      — grid of in-flight executions
//   2. Execution Timeline — state-transition viewer
//   3. Incident Panel    — failure forensics
//   4. Workflow Graph    — DAG of nodes
//
// Wired to live ExecutionTransition data via:
//   GET /api/execute/active
//   GET /api/execute/:id/transitions
//   GET /api/execute/:id/incident
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import {
  Activity, History, AlertTriangle, Layers,
  Cpu, Search, ChevronRight, ArrowRight,
  RotateCcw, FileText, X, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { connectExecutionStream } from '../../lib/events.js';
import { auth } from '../../firebase.js';
import styles from './Operations.module.css';

// ── State design language ────────────────────────────────────
const STATE_CFG = {
  PENDING:         { color: 'var(--c-text-muted)',  bg: 'var(--c-surface-elevated)', label: 'PENDING',   dot: 'muted' },
  QUEUED:          { color: '#3B82F6',              bg: 'rgba(59,130,246,0.10)',     label: 'QUEUED',    dot: 'blue'  },
  EXECUTING:       { color: 'var(--c-gold-deep)',   bg: 'rgba(246,201,69,0.12)',     label: 'EXECUTING', dot: 'pulse' },
  RETRYING:        { color: '#A855F7',              bg: 'rgba(168,85,247,0.10)',     label: 'RETRYING',  dot: 'pulse' },
  // Backend uses EXECUTED_SUCCESS / EXECUTED_FAILED canonically; render as
  // SUCCESS / FAILED for the UI but keep both keys mapped so either resolves.
  SUCCESS:         { color: 'var(--c-scale-text)',  bg: 'var(--c-scale-bg)',         label: 'SUCCESS',   dot: 'solid' },
  EXECUTED_SUCCESS:{ color: 'var(--c-scale-text)',  bg: 'var(--c-scale-bg)',         label: 'SUCCESS',   dot: 'solid' },
  FAILED:          { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)',          label: 'FAILED',    dot: 'sharp' },
  EXECUTED_FAILED: { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)',          label: 'FAILED',    dot: 'sharp' },
  TIMED_OUT:       { color: 'var(--c-hold-text)',   bg: 'var(--c-hold-bg)',          label: 'TIMED_OUT', dot: 'warn'  },
  CANCELLED:       { color: 'var(--c-text-subtle)', bg: 'var(--c-surface-elevated)', label: 'CANCELLED', dot: 'faded' },
};

const IN_FLIGHT = ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'];
const FAILURE = ['EXECUTED_FAILED', 'TIMED_OUT'];

function StatePill({ state, size = 'sm' }) {
  const c = STATE_CFG[state] || STATE_CFG.PENDING;
  const dot = c.dot;
  const fs = size === 'lg' ? 12 : 10;
  return (
    <span className="font-mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: size === 'lg' ? '4px 10px' : '2px 8px',
      borderRadius: 4,
      fontSize: fs,
      fontWeight: 600,
      letterSpacing: '0.08em',
      background: c.bg,
      color: c.color,
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

// ── Format helpers ───────────────────────────────────────────
function shortId(id) {
  if (!id) return '—';
  return id.length > 6 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

function formatAge(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `0:${String(seconds).padStart(2, '0')}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function durationBetween(a, b) {
  if (!a || !b) return '';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return '';
  return `+${(ms / 1000).toFixed(2)}s`;
}

function formatTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 23); // HH:MM:SS.mmm
}

// ══════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════
export default function Operations() {
  const [tab, setTab] = useState('monitor');
  const [selectedExecutionId, setSelectedExecutionId] = useState(null);

  const openTimeline = (id) => { setSelectedExecutionId(id); setTab('timeline'); };
  const openIncident = (id) => { setSelectedExecutionId(id); setTab('incident'); };

  const tabs = [
    { id: 'monitor',  label: 'Live Monitor',       Icon: Activity },
    { id: 'timeline', label: 'Execution Timeline', Icon: History  },
    { id: 'incident', label: 'Incident Panel',     Icon: AlertTriangle },
    { id: 'graph',    label: 'Workflow Graph',     Icon: Layers },
  ];

  return (
    <div className={styles.operationsRoot}>
      <div data-screen-label="Operations" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={13} style={{ color: 'var(--c-gold)' }} />
            Runtime · Operational layer
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <h1 className="font-display" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', margin: 0, color: 'var(--c-text-base)' }}>
              See the runtime. Trust the runtime.
            </h1>
            <RuntimeHealthStrip />
          </div>
        </header>

        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, marginBottom: 20, width: 'fit-content' }}>
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px',
                  background: active ? 'var(--c-lumi-elevated)' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  color: active ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                  fontFamily: 'var(--f-display)',
                  fontWeight: active ? 600 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: active ? 'var(--sh-card)' : 'none',
                }}
              >
                <t.Icon size={14} style={{ color: active ? 'var(--c-gold-deep)' : 'currentColor' }} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div key={tab} className="anim-fade-in">
          {tab === 'monitor'  && <LiveMonitor onOpen={openTimeline} onOpenIncident={openIncident} />}
          {tab === 'timeline' && <ExecutionTimeline executionId={selectedExecutionId} onBack={() => setTab('monitor')} />}
          {tab === 'incident' && <IncidentPanel executionId={selectedExecutionId} onBack={() => setTab('monitor')} />}
          {tab === 'graph'    && <WorkflowGraph />}
        </div>
      </div>
    </div>
  );
}

// ── Runtime health strip ─────────────────────────────────────
function formatLatency(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RuntimeHealthStrip() {
  const [vitals, setVitals] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/api/execute/vitals');
        if (!cancelled) {
          setVitals(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = setInterval(load, 10000); // 10s — vitals don't change as fast as the monitor
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const v = vitals;
  const placeholder = error ? '!' : '—';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <Vital
        label="In-flight"
        value={v ? String(v.inFlightCount) : placeholder}
        color="var(--c-gold)"
        pulse={!!v && v.inFlightCount > 0}
      />
      <Divider />
      <Vital
        label="Success / hr"
        value={v ? String(v.successPerHour) : placeholder}
        color="var(--c-scale)"
      />
      <Divider />
      <Vital
        label="Failed / hr"
        value={v ? String(v.failedPerHour) : placeholder}
        color="var(--c-kill)"
      />
      <Divider />
      <Vital
        label="p95"
        value={v ? formatLatency(v.p95LatencyMs) : placeholder}
        mono
      />
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 24, background: 'var(--c-surface-border-strong)' }} />;
}

function Vital({ label, value, color, pulse, mono }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: color,
            boxShadow: pulse ? `0 0 6px ${color}` : 'none',
            animation: pulse ? 'intel-pulse 1.4s ease-in-out infinite' : 'none',
          }} />
        )}
        <span
          className={mono ? 'font-mono tabular-nums' : 'font-display tabular-nums'}
          style={{ fontSize: mono ? 16 : 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-text-base)' }}
        >
          {value}
        </span>
      </div>
      <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// ── Generic stateful blocks ──────────────────────────────────
function PanelMessage({ icon: Icon, title, hint }) {
  return (
    <div style={{
      background: 'var(--c-surface-card)',
      border: '1px dashed var(--c-surface-border-strong)',
      borderRadius: 14,
      padding: '40px 24px',
      textAlign: 'center',
      color: 'var(--c-text-muted)',
    }}>
      {Icon && <Icon size={24} style={{ color: 'var(--c-text-subtle)', marginBottom: 8 }} />}
      <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{title}</div>
      {hint && <div className="font-mono" style={{ fontSize: 11, marginTop: 6, color: 'var(--c-text-muted)' }}>{hint}</div>}
    </div>
  );
}

function LoadingBlock({ label = 'Loading…' }) {
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

// ══════════════════════════════════════════════════════════════
// 1. LIVE MONITOR
// ══════════════════════════════════════════════════════════════
function LiveMonitor({ onOpen, onOpenIncident }) {
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

        // Compute actor from the top-level event field (lifecycle service
        // sends it alongside the execution snapshot).
        const incomingActor = event.actor || 'SYSTEM';
        const isTerminalIncoming = !IN_FLIGHT.includes(incoming.status);

        setExecutions((prev) => {
          const idx = prev.findIndex((row) => row.id === incoming.id);

          // Terminal arrives for an unknown row → nothing to do (already
          // gone from the in-flight set or never tracked here).
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

  const filters = ['all', 'in-flight', 'failed', 'stale'];
  const isInFlight = (s) => IN_FLIGHT.includes(s);
  const isFailed   = (s) => FAILURE.includes(s);
  const isStale    = (e) => isInFlight(e.status) && typeof e.ageSeconds === 'number' && e.ageSeconds > 30;

  const rows = executions.filter((e) => {
    if (filter === 'in-flight') return isInFlight(e.status);
    if (filter === 'failed')    return isFailed(e.status);
    if (filter === 'stale')     return isStale(e);
    return true;
  });

  const gridCols = '90px 1fr 130px 140px 80px 80px 90px 90px 32px';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {filters.map((f) => (
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
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '12px 16px', background: 'var(--c-surface-elevated)', borderBottom: '1px solid var(--c-surface-border)' }}>
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
                  gridTemplateColumns: gridCols,
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
                  {formatAge(e.ageSeconds)}
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

function ActorBadge({ name }) {
  if (!name) return null;
  const isMachine = ['lumi', 'worker', 'api', 'retry_policy', 'supervisor', 'timeout_handler', 'system', 'reconciliation']
    .some((x) => name.toLowerCase().includes(x));
  return (
    <span
      className="font-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: isMachine ? 'rgba(246,201,69,0.10)' : 'var(--c-surface-elevated)',
        color: isMachine ? 'var(--c-gold-deep)' : 'var(--c-text-soft)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'lowercase',
      }}
    >
      {isMachine && <Cpu size={9} />}
      {name}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════
// 2. EXECUTION TIMELINE
// ══════════════════════════════════════════════════════════════
function ExecutionTimeline({ executionId, onBack }) {
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

// ══════════════════════════════════════════════════════════════
// 3. INCIDENT PANEL
// ══════════════════════════════════════════════════════════════
function IncidentPanel({ executionId, onBack }) {
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

// Raw JSON view of the transition chain — the forensic "show me everything"
// surface. No additional fetch needed: the Incident Panel already loaded
// the transitions when it mounted via GET /api/execute/:id/incident.
function RawAuditLogModal({ executionId, transitions, onClose }) {
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

function CollisionGraph({ graph }) {
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

// ══════════════════════════════════════════════════════════════
// 4. WORKFLOW GRAPH — static FSM diagram
// ══════════════════════════════════════════════════════════════
function WorkflowGraph() {
  const nodes = [
    { id: 'csv',      label: 'CSV ingest',      state: 'EXECUTED_SUCCESS', x: 80,   y: 60,  w: 130 },
    { id: 'validate', label: 'Validate',        state: 'EXECUTED_SUCCESS', x: 260,  y: 60,  w: 130 },
    { id: 'scan',     label: 'Scan 14 vectors', state: 'EXECUTING',        x: 440,  y: 60,  w: 150 },
    { id: 'memory',   label: 'Memory lookup',   state: 'EXECUTED_SUCCESS', x: 440,  y: 160, w: 150 },
    { id: 'verdict',  label: 'Lock verdict',    state: 'PENDING',          x: 640,  y: 110, w: 130 },
    { id: 'auth',     label: 'Auth + lock',     state: 'PENDING',          x: 820,  y: 60,  w: 130 },
    { id: 'exec',     label: 'Meta Graph',      state: 'PENDING',          x: 820,  y: 160, w: 130 },
    { id: 'audit',    label: 'Audit log',       state: 'PENDING',          x: 1000, y: 110, w: 130 },
  ];
  const edges = [
    ['csv', 'validate'], ['validate', 'scan'], ['validate', 'memory'],
    ['scan', 'verdict'], ['memory', 'verdict'],
    ['verdict', 'auth'], ['verdict', 'exec'],
    ['auth', 'audit'], ['exec', 'audit'],
  ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const nodeH = 56;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold-deep)' }}>Workflow</div>
          <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>decision_engine.v4</div>
        </div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>
          8 nodes · 9 edges · DAG validated
        </div>
      </div>

      <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 20, overflow: 'auto', boxShadow: 'var(--sh-card)' }}>
        <svg width="1180" height="260" style={{ display: 'block' }}>
          <defs>
            <pattern id="gridP" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="rgba(43,43,43,0.06)" />
            </pattern>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--c-surface-border-strong)" />
            </marker>
          </defs>
          <rect width="1180" height="260" fill="url(#gridP)" />

          {edges.map(([from, to], i) => {
            const a = byId[from];
            const b = byId[to];
            const x1 = a.x + a.w;
            const y1 = a.y + nodeH / 2;
            const x2 = b.x;
            const y2 = b.y + nodeH / 2;
            const cx = (x1 + x2) / 2;
            return (
              <path
                key={`${from}-${to}-${i}`}
                d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2 - 4} ${y2}`}
                stroke="var(--c-surface-border-strong)"
                strokeWidth="1.5"
                fill="none"
                markerEnd="url(#arrow)"
              />
            );
          })}

          {nodes.map((n) => {
            const c = STATE_CFG[n.state];
            const isExec = n.state === 'EXECUTING';
            return (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                {isExec && (
                  <rect
                    x="-3" y="-3"
                    width={n.w + 6} height={nodeH + 6}
                    rx="11"
                    fill="none" stroke={c.color} strokeWidth="1" opacity="0.35"
                  >
                    <animate attributeName="opacity" values="0.15;0.55;0.15" dur="1.6s" repeatCount="indefinite" />
                  </rect>
                )}
                <rect width={n.w} height={nodeH} rx="9" fill="var(--c-surface-card)" stroke={c.color} strokeWidth="1.5" />
                <rect width="3" height={nodeH} fill={c.color} />
                <text x="14" y="22" fontFamily="var(--f-display)" fontWeight="600" fontSize="12" fill="var(--c-text-base)">{n.label}</text>
                <text x="14" y="40" fontFamily="var(--f-mono)" fontWeight="600" fontSize="9" fill={c.color} letterSpacing="0.08em">{c.label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, padding: '10px 14px', background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 10 }}>
        {['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING', 'EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED'].map((s) => (
          <StatePill key={s} state={s} />
        ))}
      </div>
    </div>
  );
}
