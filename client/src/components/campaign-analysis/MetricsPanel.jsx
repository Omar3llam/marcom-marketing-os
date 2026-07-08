import { Link } from 'react-router-dom';
import InlineBar from '@/components/ui/InlineBar.jsx';
import { cn }    from '@/lib/utils.js';
import { appRoutes } from '@/app/routeManifest.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { fmtCurrency } from './campaignFormatters.js';

function KpiCard({ label, help, value, valueClass, delta, deltaClass, footer }) {
  return (
    <article className="bg-lumi-surface border border-lumi-border rounded-xl p-5">
      <div className="section-label flex items-center gap-1">{label}{help}</div>
      <div className={cn('mt-2 metric-display text-lumi-text', valueClass)}>{value}</div>
      {delta && <div className={cn('mt-1 text-xs font-mono', deltaClass)}>{delta}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </article>
  );
}

// Source-resolved KPI strip. Each card shows the value of whichever substrate
// can actually back it (the live connector graph is preferred for spend/CPA;
// Wasted Spend + Account Health exist only in the CSV-analysis pipeline), and
// renders "—" when no source backs it — never a fabricated 0 or a stale
// "CSV-derived" label asserting a source that isn't feeding the page.
export function MetricsPanel({
  spend, spendLabel, blendedCpa, wasted, wastedPct,
  healthScore, healthLabel, healthColor, currency = 'USD', loading,
}) {
  const wastedKnown = wasted != null;
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <KpiCard
        label="Total Spend"
        help={<HelpTip content={HELP.TOTAL_SPEND} />}
        value={spend != null ? fmtCurrency(spend, currency) : '—'}
        delta={loading ? '—' : spendLabel}
        deltaClass="text-lumi-subtle"
      />
      <KpiCard
        label="Blended CPA"
        help={<HelpTip variant="popover" content={HELP.BLENDED_CPA} />}
        value={blendedCpa != null ? fmtCurrency(blendedCpa, currency) : '—'}
        delta={blendedCpa != null ? 'Per-campaign avg' : 'No conversions tracked yet'}
        deltaClass="text-lumi-subtle"
        footer={blendedCpa == null ? (
          <Link to={appRoutes.settingsRevenue} className="text-xs font-medium text-lumi-accent hover:underline">
            Add revenue data to unlock ROAS →
          </Link>
        ) : undefined}
      />
      <KpiCard
        label="Wasted Spend"
        help={<HelpTip variant="popover" content={HELP.WASTED_SPEND} />}
        value={wastedKnown ? fmtCurrency(wasted, currency) : '—'}
        valueClass={wastedKnown ? 'text-trend-danger' : undefined}
        delta={wastedKnown ? `${wastedPct}% of total` : 'Needs analysis'}
        deltaClass={wastedKnown ? 'text-trend-danger' : 'text-lumi-subtle'}
        footer={wastedKnown ? <InlineBar value={wastedPct} max={100} ariaLabel={`${wastedPct}% wasted spend`} /> : undefined}
      />
      <KpiCard
        label="Account Health"
        help={<HelpTip variant="popover" content={HELP.ACCOUNT_HEALTH} />}
        value={healthScore == null ? '—' : `${healthScore}/100`}
        valueClass={healthColor}
        delta={healthLabel}
        deltaClass={healthColor}
      />
    </section>
  );
}
