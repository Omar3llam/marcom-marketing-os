// ============================================================
// Marcom AI — Operations / Runtime panel
// ------------------------------------------------------------
// "MRI scanner for the runtime." Four sub-views:
//   1. Live Monitor       — grid of in-flight executions
//   2. Execution Timeline — state-transition viewer
//   3. Incident Panel     — failure forensics
//   4. Workflow Graph     — DAG of nodes
//
// Wired to live ExecutionTransition data via:
//   GET /api/execute/active
//   GET /api/execute/:id/transitions
//   GET /api/execute/:id/incident
//   POST /api/execute/:id/retry
//   GET /api/execute/vitals
//
// SSE topology: every successful lifecycle transition broadcasts
// an `execution.transition` event on the workspace channel, which
// the Live Monitor consumes with a version-filter merge.
// ============================================================
import { useState } from 'react';
import { Activity, History, AlertTriangle, Layers, Cpu } from 'lucide-react';
import { LiveMonitor } from './LiveMonitor.jsx';
import { ExecutionTimeline } from './ExecutionTimeline.jsx';
import { IncidentPanel } from './IncidentPanel.jsx';
import { WorkflowGraph } from './WorkflowGraph.jsx';
import { RuntimeHealthStrip } from './components/RuntimeHealthStrip.jsx';
import styles from './Operations.module.css';

const TABS = [
  { id: 'monitor',  label: 'Live Monitor',       Icon: Activity },
  { id: 'timeline', label: 'Execution Timeline', Icon: History  },
  { id: 'incident', label: 'Incident Panel',     Icon: AlertTriangle },
  { id: 'graph',    label: 'Workflow Graph',     Icon: Layers },
];

export default function Operations() {
  const [tab, setTab] = useState('monitor');
  const [selectedExecutionId, setSelectedExecutionId] = useState(null);

  const openTimeline = (id) => { setSelectedExecutionId(id); setTab('timeline'); };
  const openIncident = (id) => { setSelectedExecutionId(id); setTab('incident'); };

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
          {TABS.map((t) => {
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
