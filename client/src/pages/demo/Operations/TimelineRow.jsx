import { ArrowRight } from 'lucide-react';
import { StatePill } from './components/StatePill.jsx';
import { ActorBadge } from './components/ActorBadge.jsx';
import { formatTs } from './utils/formatting.js';
import styles from './Operations.module.css';

function intervalText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 60000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 60000).toFixed(1)}m`;
}

export function TransitionRow({ r }) {
  return <li className={styles.transitionRecord}>
    <div className={styles.transitionStates}>
      <StatePill state={r.fromStatus} />
      <ArrowRight size={12} aria-label="to" />
      <StatePill state={r.toStatus} />
      {r.occConflict && <span className="font-mono">OCC conflict</span>}
      {r.overageMs != null && <span className="font-mono">Timeout overage: {intervalText(r.overageMs)}</span>}
    </div>
    <dl className={styles.eventFacts}>
      <div><dt>Timestamp</dt><dd className="font-mono">{formatTs(r.createdAt)}</dd></div>
      <div><dt>Actor</dt><dd>{r.actor ? <ActorBadge name={r.actor} /> : '—'}</dd></div>
      <div><dt>Interval</dt><dd className="font-mono">{intervalText(r.deltaMs)}</dd></div>
    </dl>
    {r.reason && <p className={styles.eventReason}>{r.reason}</p>}
  </li>;
}
