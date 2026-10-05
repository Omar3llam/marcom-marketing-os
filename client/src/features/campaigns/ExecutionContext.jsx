// Supporting comparison evidence for Campaigns and Overview. The server owns
// the selected ad set, metric, baseline and gap; the campaign row supplies only
// identity / learning / action context. A comparison never diagnoses a cause.
import { ACTIONABLE_VERDICTS, buildRelativeBaselineReadout } from './executionContext.js';
import { RelativeBaselineEvidence } from './RelativeBaselineEvidence.jsx';
import { formatCurrency } from '@/lib/money';
import { isKnownCurrency, isKnownMinorAmount } from '@/lib/monetaryCurrency.js';
import { useDecisionLearning } from '@/hooks/useDecisionLearning.js';
import { LearningInsight } from './LearningInsight.jsx';
import { DecisionLifecycle } from './DecisionLifecycle.jsx';

const Label = ({ children }) => (
  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

export function ExecutionContext({
  campaign, parent, evidence, comparisonEnvelope, verdict,
  onExecute = null, onDismiss = null, executionState = null,
}) {
  const learning = useDecisionLearning(campaign?.entityId ?? null);
  if (!campaign || !ACTIONABLE_VERDICTS.includes(verdict)) return null;
  const worst = evidence?.summary?.bottom;
  const metric = evidence?.metric;
  if (!comparisonEnvelope || !worst || !Array.isArray(evidence.ranked)) return null;
  const readout = buildRelativeBaselineReadout({ metric, subjectValue: worst[metric], parentValue: parent?.[metric],
    gap: worst._gap, comparisonEnvelope, subjectLabel: 'Ad set', parentLabel: 'Campaign',
    relationParentLabel: 'campaign', populationNoun: 'ad sets' });
  if (!readout) return null;
  const spendKnown = isKnownMinorAmount(worst.spendMinor) && isKnownCurrency(worst.currency);

  return (
    <div className="mt-2 rounded-lg border border-lumi-border bg-lumi-surface p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-lumi-accent">Where to execute</p>
      <div className="mb-3">
        <Label>Execute here</Label>
        <p className="font-display text-sm font-semibold text-lumi-text">{worst.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-lumi-subtle">AD SET · {worst.channel}</p>
      </div>
      <Label>Selected because</Label>
      <RelativeBaselineEvidence readout={readout} />
      <div className="mb-3 border-t border-lumi-border pt-3">
        <Label>Reported ad-set spend</Label>
        <p className="font-mono text-xs tabular-nums text-lumi-muted">
          {spendKnown ? formatCurrency(worst.spendMinor, worst.currency)
            : <span className="text-lumi-subtle" title="No data">—</span>}
        </p>
      </div>
      <div className="rounded-lg bg-lumi-elevated px-3 py-2.5">
        <Label>Inspection context</Label>
        <p className="text-xs leading-relaxed text-lumi-text">
          Inspect <span className="font-semibold">{worst.name}</span> first.
        </p>
        <LearningInsight learning={learning} />
      </div>
      <DecisionLifecycle onExecute={onExecute} onDismiss={onDismiss} executionState={executionState} />
    </div>
  );
}
