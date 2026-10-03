import { cn } from '@/lib/utils.js';

// EVIDENCE supporting the campaign verdict queue. The connector-verdict
// contract owns amounts, denomination, lanes and shares; this chart renders
// them. Loading/read failure, withheld currency and successful empty remain
// distinct. It answers how scored spend is distributed across verdict lanes.

function LegendDot({ color, text, pct: pctVal, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('w-2 h-2 rounded-full', color)} aria-hidden="true" />
      {text} · {pctVal}%
    </span>
  );
}

export function PerformanceChart({ budgetDistribution, loading = false, error = null }) {
  let message;
  let role;
  if (loading) {
    message = 'Loading budget distribution…'; role = 'status';
  } else if (error || !budgetDistribution) {
    message = 'Couldn’t load budget distribution.'; role = 'alert';
  } else if (budgetDistribution.status === 'EMPTY') {
    message = 'No scored campaign spend to distribute yet.';
  } else if (budgetDistribution.status === 'UNAVAILABLE' && budgetDistribution.reason === 'MIXED_CURRENCY') {
    message = 'Budget distribution unavailable: currencies cannot be combined.';
  } else if (budgetDistribution.status === 'UNAVAILABLE' && budgetDistribution.reason === 'UNKNOWN_CURRENCY') {
    message = 'Budget distribution unavailable: denomination cannot be established.';
  } else if (budgetDistribution.status !== 'AVAILABLE') {
    message = 'Couldn’t load budget distribution.'; role = 'alert';
  }
  if (message) {
    return (
      <section className="mb-6">
        <div className="section-label mb-3">Current Budget Distribution</div>
        <div role={role} className="rounded-xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6 text-center text-sm text-lumi-muted">
          {message}
        </div>
      </section>
    );
  }

  const { killPct, holdPct, scalePct } = budgetDistribution;

  return (
    <section className="mb-6">
      <div className="section-label mb-3">Current Budget Distribution</div>
      <div
        className="h-4 rounded-full overflow-hidden flex bg-lumi-border"
        role="img"
        aria-label={`Allocation: kill ${killPct}%, hold ${holdPct}%, scale ${scalePct}%`}
      >
        <div className="bg-signal-kill"  style={{ width: `${killPct}%` }} />
        <div className="bg-signal-hold"  style={{ width: `${holdPct}%` }} />
        <div className="bg-signal-scale" style={{ width: `${scalePct}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
        <LegendDot color="bg-signal-kill"  text="Kill"  pct={killPct} className="text-signal-kill"  />
        <LegendDot color="bg-signal-hold"  text="Hold"  pct={holdPct} className="text-signal-hold"  />
        <LegendDot color="bg-signal-scale" text="Scale" pct={scalePct} className="text-signal-scale" />
      </div>
    </section>
  );
}
