// ============================================================
// Operations · Workflow Graph (static FSM diagram)
// ============================================================
// SVG DAG of decision_engine.v4 with the EXECUTING node ringed
// by an animated pulse. State legend strip underneath.
// ============================================================
import { StatePill } from './components/StatePill.jsx';
import { STATE_CFG } from './utils/stateConfig.js';

const NODES = [
  { id: 'csv',      label: 'Sync ingest',     state: 'EXECUTED_SUCCESS', x: 80,   y: 60,  w: 130 },
  { id: 'validate', label: 'Validate',        state: 'EXECUTED_SUCCESS', x: 260,  y: 60,  w: 130 },
  { id: 'scan',     label: 'Scan 14 vectors', state: 'EXECUTING',        x: 440,  y: 60,  w: 150 },
  { id: 'memory',   label: 'Memory lookup',   state: 'EXECUTED_SUCCESS', x: 440,  y: 160, w: 150 },
  { id: 'verdict',  label: 'Lock verdict',    state: 'PENDING',          x: 640,  y: 110, w: 130 },
  { id: 'auth',     label: 'Auth + lock',     state: 'PENDING',          x: 820,  y: 60,  w: 130 },
  { id: 'exec',     label: 'Meta Graph',      state: 'PENDING',          x: 820,  y: 160, w: 130 },
  { id: 'audit',    label: 'Audit log',       state: 'PENDING',          x: 1000, y: 110, w: 130 },
];

const EDGES = [
  ['csv', 'validate'], ['validate', 'scan'], ['validate', 'memory'],
  ['scan', 'verdict'], ['memory', 'verdict'],
  ['verdict', 'auth'], ['verdict', 'exec'],
  ['auth', 'audit'], ['exec', 'audit'],
];

const LEGEND_STATES = ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING', 'EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED'];

export function WorkflowGraph() {
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
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

          {EDGES.map(([from, to], i) => {
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

          {NODES.map((n) => {
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
        {LEGEND_STATES.map((s) => <StatePill key={s} state={s} />)}
      </div>
    </div>
  );
}
