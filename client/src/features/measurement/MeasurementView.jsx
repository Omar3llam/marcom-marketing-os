// ============================================================
// MARCOM / Lumi — MeasurementView  (/app/measure · Phase 4-E)
// ------------------------------------------------------------
// Two surfaces that answer forward + causal questions:
//   • Scenario — a forward what-if on the real channel mix (all roles; ranges).
//   • Incrementality — holdout testing, the only causal signal (STRATEGIST,
//     and tier-gated server-side: a 403 renders an honest locked state).
//
// The page wrapper owns the fetches; the panels are pure + prop-driven (unit-
// tested directly). Mirrors the Phase-11A surfacing pattern.
// ============================================================
import { FlaskConical } from 'lucide-react';
import { useScenario } from '@/hooks/useScenario.js';
import { useIncrementality } from '@/hooks/useIncrementality.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import RoleGate from '@/components/auth/RoleGate.jsx';
import { ScenarioPanel } from './ScenarioPanel.jsx';
import { IncrementalityPanel } from './IncrementalityPanel.jsx';

export function MeasurementView() {
  const { scenario, message, gated: scenarioGated, loading: scenarioLoading, error: scenarioError, run } = useScenario();
  const inc = useIncrementality();
  // The page owns the workspace read; the pure panels stay prop-driven. This is
  // the scenario currency (scenario data may override it). It cannot denominate
  // historical incrementality values.
  const { workspace } = useWorkspace();
  const currency = workspace?.currency ?? 'USD';

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 lg:p-8 animate-fade-in">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="decision-title text-lumi-text">Measurement</h1>
          <p className="text-lumi-muted text-sm mt-1">Forward scenarios + causal incrementality — measured, never guessed.</p>
        </div>
        <div className="inline-flex items-center gap-1.5 bg-stage-testing/10 border border-stage-testing/25 text-stage-testing font-mono text-xs px-3 py-1 rounded-full self-start sm:self-auto">
          <FlaskConical className="w-3 h-3" strokeWidth={1.5} />
          Measurement OS
        </div>
      </header>

      <ScenarioPanel scenario={scenario} message={message} gated={scenarioGated} loading={scenarioLoading} error={scenarioError} onRun={run} currency={currency} />

      <RoleGate role={['STRATEGIST']}>
        <IncrementalityPanel
          tests={inc.tests}
          readouts={inc.readouts}
          gated={inc.gated}
          gateReason={inc.gateReason}
          loading={inc.loading}
          error={inc.error}
          busyId={inc.busyId}
          onDesign={inc.design}
          onRecord={inc.recordCounts}
          onConclude={inc.conclude}
        />
      </RoleGate>
    </div>
  );
}

export default MeasurementView;
