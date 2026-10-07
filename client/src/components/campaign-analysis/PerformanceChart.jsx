import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';

// EVIDENCE supporting the campaign verdict queue. The connector-verdict
// contract owns amounts, denomination, lanes and shares; this chart renders
// them. Loading/read failure, withheld currency and successful empty remain
// distinct. It answers how scored spend is distributed across verdict lanes.

function SpendLane({ label, amountMinor, currency, pct, color }) {
  return (
    <li>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-lumi-text">{label}</span>
        <span className="inline-flex gap-3 font-mono text-lumi-muted">
          <span>{formatCurrency(amountMinor, currency)}</span>
          <span>{pct}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-lumi-border" aria-hidden="true">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

export function PerformanceChart({ budgetDistribution, loading = false, error = null }) {
  let message;
  let role;
  if (loading) {
    message = 'Loading scored campaign spend distribution…'; role = 'status';
  } else if (error || !budgetDistribution) {
    message = 'Couldn’t load scored campaign spend distribution.'; role = 'alert';
  } else if (budgetDistribution.status === 'EMPTY') {
    message = 'No scored campaign spend to distribute yet.';
  } else if (budgetDistribution.status === 'UNAVAILABLE' && budgetDistribution.reason === 'MIXED_CURRENCY') {
    message = 'Scored campaign spend distribution unavailable: currencies cannot be combined.';
  } else if (budgetDistribution.status === 'UNAVAILABLE' && budgetDistribution.reason === 'UNKNOWN_CURRENCY') {
    message = 'Scored campaign spend distribution unavailable: denomination cannot be established.';
  } else if (budgetDistribution.status !== 'AVAILABLE') {
    message = 'Couldn’t load scored campaign spend distribution.'; role = 'alert';
  }
  if (message) {
    return (
      <section className="mb-6">
        <div className="section-label mb-3">Scored campaign spend distribution</div>
        <div role={role} className="rounded-xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6 text-center text-sm text-lumi-muted">
          {message}
        </div>
      </section>
    );
  }

  const { currency, totalSpendMinor, killSpendMinor, holdSpendMinor, scaleSpendMinor,
    killPct, holdPct, scalePct } = budgetDistribution;

  return (
    <section className="mb-6">
      <div className="section-label mb-2">Scored campaign spend distribution</div>
      <p className="mb-3 text-sm text-lumi-muted">Positive spend on campaigns with a current LUMI verdict.</p>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="text-lumi-muted">Total scored spend</span>
        <span className="font-mono text-lumi-text">{formatCurrency(totalSpendMinor, currency)}</span>
        <span className="font-mono text-lumi-muted">{currency}</span>
      </div>
      <ul className="space-y-3">
        <SpendLane label="Kill" amountMinor={killSpendMinor} currency={currency} pct={killPct} color="bg-signal-kill" />
        <SpendLane label="Hold / Watch / Reallocate / Refresh" amountMinor={holdSpendMinor} currency={currency} pct={holdPct} color="bg-lumi-muted" />
        <SpendLane label="Scale" amountMinor={scaleSpendMinor} currency={currency} pct={scalePct} color="bg-signal-scale" />
      </ul>
    </section>
  );
}
