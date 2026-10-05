// Supporting comparison evidence for Campaigns and Overview. The server owns
// the selected ad set, metric, baseline and gap; the campaign row supplies only
// identity / learning / action context. A comparison never diagnoses a cause.
import { ACTIONABLE_VERDICTS, evidenceMetricLabel, formatEvidenceValue, formatEvidenceGap, evidenceBasisLabel, evidencePopulationLabel } from './executionContext.js';
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
  const metricLabel = evidenceMetricLabel(metric);
  const childValue = formatEvidenceValue(metric, worst?.[metric]);
  const parentValue = formatEvidenceValue(metric, parent?.[metric]);
  const gap = formatEvidenceGap(worst?._gap, 'campaign');
  if (!comparisonEnvelope || !worst || !metricLabel || !childValue || !parentValue || !gap || !Array.isArray(evidence.ranked)) return null;
  const spendKnown = isKnownMinorAmount(worst.spendMinor) && isKnownCurrency(worst.currency);

  return (
    <div className="mt-2 rounded-lg border border-lumi-border bg-lumi-surface p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-lumi-accent">Where to execute</p>
      <div className="mb-3">
        <Label>Execute here</Label>
        <p className="font-display text-sm font-semibold text-lumi-text">{worst.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-lumi-subtle">AD SET · {worst.channel}</p>
      </div>
      <section aria-label="Selected comparison" className="mb-3">
        <Label>Selected because</Label>
        <p className="mb-2 font-display text-sm font-semibold text-lumi-text">{metricLabel}</p>
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="font-mono text-[10px] text-lumi-muted">Ad set</dt>
            <dd className="font-mono text-sm tabular-nums text-lumi-text">{childValue}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] text-lumi-muted">Campaign</dt>
            <dd className="font-mono text-sm tabular-nums text-lumi-text">{parentValue}</dd>
          </div>
        </dl>
        <p className="mt-2 flex flex-wrap gap-x-3 font-mono text-xs text-lumi-text">
          <span>{gap.signed}</span><span>{gap.relation}</span>
        </p>
        <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-lumi-muted">{evidenceBasisLabel(comparisonEnvelope)}</p>
        <p className="mt-1 text-xs leading-relaxed text-lumi-muted">{evidencePopulationLabel(comparisonEnvelope, 'ad sets')}</p>
      </section>
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
