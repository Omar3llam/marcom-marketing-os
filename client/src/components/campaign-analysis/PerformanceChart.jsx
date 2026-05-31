import { cn } from '@/lib/utils.js';
import { pct } from './campaignFormatters.js';

function LegendDot({ color, text, pct: pctVal, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('w-2 h-2 rounded-full', color)} aria-hidden="true" />
      {text} · {pctVal}%
    </span>
  );
}

export function PerformanceChart({ totals }) {
  if (totals.spend === 0) {
    return (
      <section className="mb-6">
        <div className="section-label mb-3">Budget Allocation Recommendation</div>
        <div className="rounded-xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6 text-center text-sm text-lumi-muted">
          Upload a CSV to see budget allocation.
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <div className="section-label mb-3">Budget Allocation Recommendation</div>
      <div
        className="h-4 rounded-full overflow-hidden flex bg-lumi-border"
        role="img"
        aria-label={`Allocation: kill ${pct(totals.kill, totals.spend)}%, hold ${pct(totals.hold, totals.spend)}%, scale ${pct(totals.scale, totals.spend)}%`}
      >
        <div className="bg-signal-kill"  style={{ width: `${pct(totals.kill,  totals.spend)}%` }} />
        <div className="bg-signal-hold"  style={{ width: `${pct(totals.hold,  totals.spend)}%` }} />
        <div className="bg-signal-scale" style={{ width: `${pct(totals.scale, totals.spend)}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
        <LegendDot color="bg-signal-kill"  text="Kill"  pct={pct(totals.kill,  totals.spend)} className="text-signal-kill"  />
        <LegendDot color="bg-signal-hold"  text="Hold"  pct={pct(totals.hold,  totals.spend)} className="text-signal-hold"  />
        <LegendDot color="bg-signal-scale" text="Scale" pct={pct(totals.scale, totals.spend)} className="text-signal-scale" />
      </div>
    </section>
  );
}
