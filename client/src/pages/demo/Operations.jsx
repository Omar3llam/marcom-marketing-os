// ============================================================
// Marcom AI — Operations / Runtime panel  (demo route)
// ------------------------------------------------------------
// "MRI scanner for the runtime." Four sub-views:
//   1. Live Monitor      — grid of in-flight executions
//   2. Execution Timeline — state-transition viewer
//   3. Incident Panel    — failure forensics
//   4. Workflow Graph    — DAG of nodes
//
// Ported from MARCOM Demo prototype (project/operations.jsx).
// Lucide icons swapped in for the prototype's hand-traced set.
// Design tokens scoped via Operations.module.css to avoid leak.
// ============================================================
import { useState, useEffect } from 'react';
import {
  Activity, History, AlertTriangle, Layers,
  Cpu, Search, ChevronRight, ArrowRight,
  RotateCcw, FileText, X,
} from 'lucide-react';
import styles from './Operations.module.css';

// ── State design language ────────────────────────────────────
const STATE_CFG = {
  PENDING:   { color: 'var(--c-text-muted)',  bg: 'var(--c-surface-elevated)', label: 'PENDING',   dot: 'muted' },
  QUEUED:    { color: '#3B82F6',              bg: 'rgba(59,130,246,0.10)',     label: 'QUEUED',    dot: 'blue'  },
  EXECUTING: { color: 'var(--c-gold-deep)',   bg: 'rgba(246,201,69,0.12)',     label: 'EXECUTING', dot: 'pulse' },
  RETRYING:  { color: '#A855F7',              bg: 'rgba(168,85,247,0.10)',     label: 'RETRYING',  dot: 'pulse' },
  SUCCESS:   { color: 'var(--c-scale-text)',  bg: 'var(--c-scale-bg)',         label: 'SUCCESS',   dot: 'solid' },
  FAILED:    { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)',          label: 'FAILED',    dot: 'sharp' },
  TIMED_OUT: { color: 'var(--c-hold-text)',   bg: 'var(--c-hold-bg)',          label: 'TIMED_OUT', dot: 'warn'  },
  CANCELLED: { color: 'var(--c-text-subtle)', bg: 'var(--c-surface-elevated)', label: 'CANCELLED', dot: 'faded' },
};

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

// ── Demo executions ──────────────────────────────────────────
const EXECUTIONS = [
  { id: 'A72F', action: 'meta.pause_adset',       target: '#4218990', actor: 'lumi', state: 'EXECUTING', version: 14, age: '0:08',  duration: '8s',   correlation: 'corr-3814' },
  { id: 'B91C', action: 'meta.reallocate_budget', target: '#4099120', actor: 'lumi', state: 'QUEUED',    version: 3,  age: '0:02',  duration: '—',    correlation: 'corr-3814' },
  { id: 'C30E', action: 'meta.update_creative',   target: '#5510042', actor: 'omar', state: 'RETRYING',  version: 8,  age: '0:24',  duration: '24s',  correlation: 'corr-3791' },
  { id: 'D88A', action: 'meta.pause_adset',       target: '#8821110', actor: 'lumi', state: 'SUCCESS',   version: 9,  age: '1:42',  duration: '4s',   correlation: 'corr-3776' },
  { id: 'E14B', action: 'meta.update_status',     target: '#7110488', actor: 'lumi', state: 'FAILED',    version: 11, age: '2:18',  duration: '18s',  correlation: 'corr-3771' },
  { id: 'F22D', action: 'meta.duplicate_adset',   target: '#9009987', actor: 'omar', state: 'TIMED_OUT', version: 6,  age: '3:04',  duration: '60s',  correlation: 'corr-3760' },
  { id: 'G55F', action: 'meta.set_budget',        target: '#3344298', actor: 'lumi', state: 'PENDING',   version: 1,  age: '—',     duration: '—',    correlation: 'corr-3820' },
  { id: 'H77C', action: 'meta.update_creative',   target: '#1199003', actor: 'omar', state: 'CANCELLED', version: 4,  age: '4:51',  duration: '0s',   correlation: 'corr-3748' },
];

const TIMELINE_A72F = [
  { ts: '09:31:02.140', from: '∅',         to: 'PENDING',   actor: 'API',          note: 'request accepted',           correlation: 'corr-3814' },
  { ts: '09:31:02.290', from: 'PENDING',   to: 'QUEUED',    actor: 'API',          note: 'enqueued · q:meta',          correlation: 'corr-3814' },
  { ts: '09:31:05.012', from: 'QUEUED',    to: 'EXECUTING', actor: 'WORKER-7',     note: 'lock acquired v=12',         correlation: 'corr-3814' },
  { ts: '09:31:11.450', from: 'EXECUTING', to: 'RETRYING',  actor: 'RETRY_POLICY', note: '503 from Graph · attempt 1/3', correlation: 'corr-3814' },
  { ts: '09:31:14.880', from: 'RETRYING',  to: 'EXECUTING', actor: 'WORKER-7',     note: 'backoff 3.4s · v=14',        correlation: 'corr-3814' },
  { ts: '09:31:22.310', from: 'EXECUTING', to: 'SUCCESS',   actor: 'WORKER-7',     note: 'meta.pause_adset OK',        correlation: 'corr-3814' },
];

const INCIDENT_E14B = {
  id: 'E14B',
  title: 'FAILED at v14',
  cause: 'timeout collision',
  winner: 'TIMEOUT_HANDLER',
  loser: 'WORKER-3',
  transitions: [
    { ts: '14:08:02', from: '∅',         to: 'PENDING',   actor: 'API' },
    { ts: '14:08:03', from: 'PENDING',   to: 'QUEUED',    actor: 'API' },
    { ts: '14:08:08', from: 'QUEUED',    to: 'EXECUTING', actor: 'WORKER-3' },
    { ts: '14:09:08', from: 'EXECUTING', to: 'TIMED_OUT', actor: 'TIMEOUT_HANDLER', highlight: true },
    { ts: '14:09:09', from: 'TIMED_OUT', to: 'FAILED',    actor: 'SUPERVISOR',      highlight: true },
  ],
  telemetry: [
    { tag: 'occ_conflict',     value: '1 detected at v=14',         tone: 'kill' },
    { tag: 'retry_count',      value: '3 / 3 exhausted',            tone: 'hold' },
    { tag: 'stale_packets',    value: '2 dropped',                  tone: 'hold' },
    { tag: 'lock_holder',      value: 'WORKER-3 → SUPERVISOR',      tone: 'neutral' },
    { tag: 'correlation',      value: 'corr-3771 · lineage 4 deep', tone: 'neutral' },
    { tag: 'last_known_state', value: 'EXECUTING (v=14, age 60.2s)', tone: 'neutral' },
  ],
  graph: { from: 'EXECUTING', winner: 'TIMEOUT_HANDLER', loser: 'WORKER-3', resolution: 'FAILED' },
};

// ══════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════
export default function Operations() {
  const [tab, setTab] = useState('monitor');

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
          {tab === 'monitor'  && <LiveMonitor />}
          {tab === 'timeline' && <ExecutionTimeline />}
          {tab === 'incident' && <IncidentPanel />}
          {tab === 'graph'    && <WorkflowGraph />}
        </div>
      </div>
    </div>
  );
}

// ── Runtime health strip ─────────────────────────────────────
function RuntimeHealthStrip() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <Vital label="In-flight"    value="3"    color="var(--c-gold)"  pulse />
      <Divider />
      <Vital label="Success / hr" value="142"  color="var(--c-scale)" />
      <Divider />
      <Vital label="Failed / hr"  value="3"    color="var(--c-kill)" />
      <Divider />
      <Vital label="p95"          value="412ms" mono />
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

// ══════════════════════════════════════════════════════════════
// 1. LIVE MONITOR
// ══════════════════════════════════════════════════════════════
function LiveMonitor() {
  const [filter, setFilter] = useState('all');
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const filters = ['all', 'in-flight', 'failed', 'stale'];
  const isInFlight = (s) => ['QUEUED', 'EXECUTING', 'RETRYING', 'PENDING'].includes(s);
  const isFailed   = (s) => ['FAILED', 'TIMED_OUT'].includes(s);
  const isStale    = (e) => isInFlight(e.state) && parseFloat(e.age) > 0.5;

  const rows = EXECUTIONS.filter((e) => {
    if (filter === 'in-flight') return isInFlight(e.state);
    if (filter === 'failed')    return isFailed(e.state);
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
              background: 'var(--c-scale)',
              boxShadow: '0 0 6px var(--c-scale)',
              animation: 'intel-pulse 1.6s ease-in-out infinite',
            }} />
            SSE live · {rows.length} rows
          </span>
          <button type="button" className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}>
            <Search size={12} />
            Search
          </button>
        </div>
      </div>

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
          return (
            <div
              key={e.id}
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
              <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)' }}>#{e.id}</span>
              <div>
                <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-base)' }}>{e.action}</div>
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 2 }}>→ {e.target}</div>
              </div>
              <StatePill state={e.state} />
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>{e.correlation}</span>
              <ActorBadge name={e.actor} />
              <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>v{e.version}</span>
              <span className="font-mono tabular-nums" style={{ fontSize: 11, color: stale ? 'var(--c-hold-text)' : 'var(--c-text-muted)' }}>
                {stale && <AlertTriangle size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                {e.age}
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{e.duration}</span>
              <ChevronRight size={14} style={{ color: 'var(--c-text-subtle)' }} />
            </div>
          );
        })}
      </div>

      <div className="font-mono" style={{ marginTop: 12, fontSize: 10, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span><span style={{ color: 'var(--c-hold)' }}>●</span> stale = in-flight &gt; 30s</span>
        <span>·</span>
        <span>workspace-isolated · tenant: maison-salam</span>
      </div>
    </div>
  );
}

function ActorBadge({ name }) {
  const isMachine = ['lumi', 'worker', 'api', 'retry_policy', 'supervisor', 'timeout_handler']
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
function parseTs(s) {
  const [h, m, secMs] = s.split(':');
  const [sec, ms] = secMs.split('.');
  return (+h * 3600) + (+m * 60) + (+sec) + (+ms / 1000);
}

function ExecutionTimeline() {
  const rows = TIMELINE_A72F.map((t, i, arr) => {
    let delta = '';
    if (i > 0) {
      const a = parseTs(arr[i - 1].ts);
      const b = parseTs(t.ts);
      delta = `+${(b - a).toFixed(2)}s`;
    }
    return { ...t, delta };
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold-deep)' }}>
              Execution
            </div>
            <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 2 }}>
              #A72F · meta.pause_adset
            </div>
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
              corr-3814 · v=14 · workspace: maison-salam
            </div>
          </div>
          <StatePill state="SUCCESS" size="lg" />
        </div>

        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 8, boxShadow: 'var(--sh-card)' }}>
          {rows.map((r, i) => (
            <TransitionRow key={`${r.ts}-${i}`} r={r} last={i === rows.length - 1} />
          ))}
        </div>

        <div className="font-mono" style={{ marginTop: 12, fontSize: 10, color: 'var(--c-text-subtle)' }}>
          Total wall time: <span style={{ color: 'var(--c-text-base)' }}>20.17s</span> · v=12 → v=14 (1 retry)
        </div>
      </div>

      <aside>
        <div className="section-label" style={{ marginBottom: 10 }}>Correlation lineage</div>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 14, boxShadow: 'var(--sh-card)' }}>
          {[
            { id: 'corr-3814', label: 'Decision · KILL',               cur: false },
            { id: '↳ #A72F',   label: 'pause_adset',                   cur: true  },
            { id: '↳ #B91C',   label: 'reallocate_budget · sibling',   cur: false },
          ].map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i ? '1px dashed var(--c-surface-border)' : 'none' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.cur ? 'var(--c-gold)' : 'var(--c-surface-border-strong)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="font-mono" style={{ fontSize: 11, color: c.cur ? 'var(--c-text-base)' : 'var(--c-text-soft)', fontWeight: c.cur ? 600 : 400 }}>{c.id}</div>
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 1 }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="section-label" style={{ marginTop: 18, marginBottom: 10 }}>Version jumps</div>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 14 }}>
          <VersionDelta from="12" to="13" actor="WORKER-7" />
          <VersionDelta from="13" to="14" actor="WORKER-7 (retry)" highlight />
        </div>
      </aside>
    </div>
  );
}

function TransitionRow({ r, last }) {
  const toCfg = STATE_CFG[r.to];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 22px 1fr 120px 60px', gap: 14, alignItems: 'center', padding: '10px 12px', borderBottom: last ? 'none' : '1px solid var(--c-surface-border)' }}>
      <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{r.ts}</span>
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: toCfg.color,
          boxShadow: r.to === 'EXECUTING' || r.to === 'RETRYING' ? `0 0 8px ${toCfg.color}` : 'none',
        }} />
        {!last && <span style={{ position: 'absolute', top: 14, width: 1, height: 18, background: 'var(--c-surface-border)' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {r.from !== '∅' ? <StatePill state={r.from} /> : <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>∅</span>}
        <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
        <StatePill state={r.to} />
        <span style={{ fontSize: 11, color: 'var(--c-text-soft)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</span>
      </div>
      <ActorBadge name={r.actor} />
      <span className="font-mono tabular-nums" style={{ fontSize: 10, color: 'var(--c-text-subtle)', textAlign: 'right' }}>{r.delta}</span>
    </div>
  );
}

function VersionDelta({ from, to, actor, highlight }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px dashed var(--c-surface-border)' }}>
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
function IncidentPanel() {
  const inc = INCIDENT_E14B;
  const toneColor = (t) => t === 'kill' ? 'var(--c-kill-text)' : t === 'hold' ? 'var(--c-hold-text)' : 'var(--c-text-base)';
  const toneBg    = (t) => t === 'kill' ? 'var(--c-kill-bg)'   : t === 'hold' ? 'var(--c-hold-bg)'   : 'var(--c-surface-elevated)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18, background: 'var(--c-surface-card)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, marginBottom: 18, boxShadow: '0 0 24px rgba(239,68,68,0.06)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--c-kill-bg)', color: 'var(--c-kill-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <AlertTriangle size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>
            Execution #{inc.id} · {inc.title}
          </div>
          <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-soft)', marginTop: 2 }}>
            Cause: <span style={{ color: 'var(--c-kill-text)', fontWeight: 600 }}>{inc.cause}</span> · Winner: <strong>{inc.winner}</strong> · Loser: <strong>{inc.loser}</strong>
          </div>
        </div>
        <StatePill state="FAILED" size="lg" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18 }}>
        <div>
          <div className="section-label" style={{ marginBottom: 10 }}>Transition chain</div>
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 8, marginBottom: 18, boxShadow: 'var(--sh-card)' }}>
            {inc.transitions.map((t, i) => (
              <div
                key={`${t.ts}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr 110px',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: i === inc.transitions.length - 1 ? 'none' : '1px solid var(--c-surface-border)',
                  background: t.highlight ? 'rgba(239,68,68,0.04)' : 'transparent',
                  borderLeft: t.highlight ? '2px solid var(--c-kill)' : '2px solid transparent',
                }}
              >
                <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t.ts}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t.from !== '∅' ? <StatePill state={t.from} /> : <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>∅</span>}
                  <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
                  <StatePill state={t.to} />
                </div>
                <ActorBadge name={t.actor} />
              </div>
            ))}
          </div>

          <div className="section-label" style={{ marginBottom: 10 }}>Collision resolution</div>
          <CollisionGraph graph={inc.graph} />
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: 10 }}>Telemetry</div>
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 4, boxShadow: 'var(--sh-card)' }}>
            {inc.telemetry.map((t, i) => (
              <div
                key={t.tag}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 1fr',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: i === inc.telemetry.length - 1 ? 'none' : '1px solid var(--c-surface-border)',
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
            <button type="button" className="btn-gold" style={{ width: '100%', justifyContent: 'center', padding: '11px 14px', fontSize: 13 }}>
              <RotateCcw size={14} />
              Retry from last known good
            </button>
            <button type="button" className="btn-ghost" style={{ width: '100%', justifyContent: 'center', padding: '10px 14px', fontSize: 13 }}>
              <FileText size={13} />
              Open raw audit log
            </button>
          </div>
        </div>
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
// 4. WORKFLOW GRAPH
// ══════════════════════════════════════════════════════════════
function WorkflowGraph() {
  const nodes = [
    { id: 'csv',      label: 'CSV ingest',      state: 'SUCCESS',   x: 80,   y: 60,  w: 130 },
    { id: 'validate', label: 'Validate',        state: 'SUCCESS',   x: 260,  y: 60,  w: 130 },
    { id: 'scan',     label: 'Scan 14 vectors', state: 'EXECUTING', x: 440,  y: 60,  w: 150 },
    { id: 'memory',   label: 'Memory lookup',   state: 'SUCCESS',   x: 440,  y: 160, w: 150 },
    { id: 'verdict',  label: 'Lock verdict',    state: 'PENDING',   x: 640,  y: 110, w: 130 },
    { id: 'auth',     label: 'Auth + lock',     state: 'PENDING',   x: 820,  y: 60,  w: 130 },
    { id: 'exec',     label: 'Meta Graph',      state: 'PENDING',   x: 820,  y: 160, w: 130 },
    { id: 'audit',    label: 'Audit log',       state: 'PENDING',   x: 1000, y: 110, w: 130 },
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
        {Object.keys(STATE_CFG).map((s) => <StatePill key={s} state={s} />)}
      </div>
    </div>
  );
}
