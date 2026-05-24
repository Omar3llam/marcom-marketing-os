import { ArrowRight, Clock, Zap, Hourglass } from 'lucide-react';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { STATE_CFG } from './utils/stateConfig.js';
import { formatTs } from './utils/formatting.js';

function DurationPill({ deltaMs }) {
  if (deltaMs == null) {
    return <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>—</span>;
  }
  const seconds = deltaMs / 1000;
  const label = seconds < 60 ? `${seconds.toFixed(2)}s` : `${(seconds / 60).toFixed(1)}m`;
  return (
    <span
      className="font-mono tabular-nums"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 999,
        background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)',
        color: 'var(--c-text-soft)', fontSize: 10, fontWeight: 600,
        letterSpacing: '0.02em', whiteSpace: 'nowrap',
      }}
    >
      <Clock size={9} />
      {label}
    </span>
  );
}

function OccMarker() {
  return (
    <span
      className="font-mono"
      title="OCC conflict — version drift detected at this transition"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 6px', borderRadius: 4,
        background: 'var(--c-kill-bg)', color: 'var(--c-kill-text)',
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', border: '1px solid rgba(239,68,68,0.3)',
      }}
    >
      <Zap size={9} />
      OCC
    </span>
  );
}

function OverageMarker({ overageMs }) {
  const overSec = overageMs / 1000;
  const label = overSec < 60 ? `+${overSec.toFixed(1)}s over` : `+${(overSec / 60).toFixed(1)}m over`;
  return (
    <span
      className="font-mono"
      title="Segment exceeded its timeout policy budget"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 6px', borderRadius: 4,
        background: 'var(--c-hold-bg)', color: 'var(--c-hold-text)',
        fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', border: '1px solid rgba(245,158,11,0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      <Hourglass size={9} />
      {label}
    </span>
  );
}

export function TransitionRow({ r, last }) {
  const toCfg = STATE_CFG[r.toStatus] || STATE_CFG.PENDING;
  const hasOverage = r.overageMs != null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 22px 1fr 120px 90px',
        gap: 14, alignItems: 'center',
        padding: '10px 12px',
        borderBottom: last ? 'none' : '1px solid var(--c-surface-border)',
        background: hasOverage ? 'rgba(245,158,11,0.04)' : 'transparent',
        borderLeft: hasOverage ? '2px solid var(--c-hold)' : '2px solid transparent',
      }}
    >
      <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
        {formatTs(r.createdAt)}
      </span>
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: toCfg.color,
          boxShadow: r.toStatus === 'EXECUTING' || r.toStatus === 'RETRYING' ? `0 0 8px ${toCfg.color}` : 'none',
        }} />
        {!last && <span style={{ position: 'absolute', top: 14, width: 1, height: 18, background: 'var(--c-surface-border)' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
        <StatePill state={r.fromStatus} />
        <ArrowRight size={11} style={{ color: 'var(--c-text-subtle)' }} />
        <StatePill state={r.toStatus} />
        {r.occConflict && <OccMarker />}
        {hasOverage && <OverageMarker overageMs={r.overageMs} />}
        {r.reason && (
          <span style={{ fontSize: 11, color: 'var(--c-text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.reason}
          </span>
        )}
      </div>
      <ActorBadge name={r.actor} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DurationPill deltaMs={r.deltaMs} />
      </div>
    </div>
  );
}
