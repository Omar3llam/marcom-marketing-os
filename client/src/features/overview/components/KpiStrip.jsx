// ============================================================
// MARCOM / Lumi — KpiStrip (Home · the four headline numbers)
// ------------------------------------------------------------
// Connector-first (live sync), legacy feed only as fallback — the values arrive
// already resolved from overviewKpis (overviewDerive.js); this component only
// formats them.
//
// The rule it exists to hold: every figure is null-when-absent and renders "—",
// never a fabricated 0. A card that printed 0 for an unmeasured metric would be
// making a measurement nobody took.
//
// Lifted verbatim out of OverviewView so the page stops carrying four cards'
// worth of markup. Presentation only — no fetching, no deriving.
// ============================================================
import { BarChart, Target, AlertTriangle, Activity } from 'lucide-react';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';
import StatCard from '@/components/ui/StatCard.jsx';

export default function KpiStrip({ kpis, killCount = 0, healthLabel, healthTone }) {
  return (
    // responsive: 1 col mobile, 2 col tablet, 4 col desktop
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
      <StatCard
        label="Total spend"
        value={kpis.spend != null ? formatCurrencyWhole(kpis.spend, kpis.currency) : '—'}
        sub="last 30 days"
        Icon={BarChart}
        tone="neutral"
      />
      <StatCard
        label="Blended CPA"
        value={kpis.cpa != null ? formatCurrencyWhole(kpis.cpa, kpis.currency) : '—'}
        sub="across active campaigns"
        Icon={Target}
        tone="neutral"
      />
      <StatCard
        label="Wasted spend"
        value={kpis.wasted != null ? `${formatCurrencyWhole(kpis.wasted, kpis.currency)}/mo` : '—'}
        sub={killCount > 0 ? `${killCount} KILL-verdict campaign${killCount === 1 ? '' : 's'}` : 'flagged for review'}
        Icon={AlertTriangle}
        tone="danger"
      />
      <StatCard
        label="Account health"
        value={kpis.health != null ? `${kpis.health}/100` : '—'}
        sub={healthLabel}
        Icon={Activity}
        tone={healthTone}
        gauge={kpis.health ?? undefined}
      />
    </div>
  );
}
