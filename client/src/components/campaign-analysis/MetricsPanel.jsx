import InlineBar from '@/components/ui/InlineBar.jsx';
import { cn }    from '@/lib/utils.js';
import { fmtCurrency } from './campaignFormatters.js';

function KpiCard({ label, value, valueClass, delta, deltaClass, footer }) {
  return (
    <article className="bg-lumi-surface border border-lumi-border rounded-xl p-5">
      <div className="section-label">{label}</div>
      <div className={cn('mt-2 metric-display text-lumi-text', valueClass)}>{value}</div>
      {delta && <div className={cn('mt-1 text-xs font-mono', deltaClass)}>{delta}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </article>
  );
}

export function MetricsPanel({ totals, loading, healthScore, healthLabel, healthColor, currency = 'USD' }) {
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <KpiCard
        label="Total Spend"
        value={fmtCurrency(totals.spend, currency)}
        delta={loading ? '—' : 'Live · CSV-derived'}
        deltaClass="text-lumi-subtle"
      />
      <KpiCard
        label="Blended CPA"
        value={totals.blendedCpa != null ? fmtCurrency(totals.blendedCpa, currency) : '—'}
        delta={totals.blendedCpa != null ? 'Per-campaign avg' : 'No CPA in dataset'}
        deltaClass="text-lumi-subtle"
      />
      <KpiCard
        label="Wasted Spend"
        value={fmtCurrency(totals.kill, currency)}
        valueClass="text-trend-danger"
        delta={`${totals.wastedPct}% of total`}
        deltaClass="text-trend-danger"
        footer={<InlineBar value={totals.wastedPct} max={100} ariaLabel={`${totals.wastedPct}% wasted spend`} />}
      />
      <KpiCard
        label="Account Health"
        value={healthScore == null ? '—' : `${healthScore}/100`}
        valueClass={healthColor}
        delta={healthLabel}
        deltaClass={healthColor}
      />
    </section>
  );
}
