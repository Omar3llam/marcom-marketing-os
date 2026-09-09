import { Link } from 'react-router-dom';
import InlineBar from '@/components/ui/InlineBar.jsx';
import { cn }    from '@/lib/utils.js';
import { appRoutes } from '@/app/routeManifest.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { fmtCurrency } from './campaignFormatters.js';
// The absence vocabulary PARITY-01 published. Compared against by token so the
// one absence that has a fix is the only one offered it.
import { AGGREGATE_ABSENCE } from '@/lib/accountAggregate.js';

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
// ── THE CPA ABSENCE CARRIES ITS OWN REASON ──────────────────────────────────
// This card used to INFER the reason from the value:
//
//     delta={blendedCpa != null ? 'Per-campaign avg' : 'No conversions tracked yet'}
//
// `accountAggregateReading`'s `blank(absence)` sets `blendedCpa: null` for ALL
// SEVEN absences, so six of them rendered the seventh's reason — and the footer
// turned that wrong reason into an ACTION. A failed read, a refused seat, a
// mixed-currency account and a request still in flight were each reported as a
// conversion-tracking gap, under an instruction to go connect revenue data that
// is already connected, or that this seat cannot reach.
//
// C-07 — a token cannot replace a reason. B8-04b — when a VALUE cannot decide an
// absence, the TOKEN must; `blendedCpa == null` cannot tell five absences apart.
// `spendLabel` was already consumed three lines below, which is what made this an
// oversight rather than a position: PARITY-01 published both captions and this
// card adopted one.
//
// RULING (Omar): the aggregate token carries the reason; the consumer does not
// infer it from `blendedCpa === null`.
export function MetricsPanel({
  spend, spendLabel, blendedCpa, cpaLabel = null, cpaAbsence = null, wasted, wastedPct,
  healthScore, healthLabel, healthColor, currency = 'USD', loading,
}) {
  const wastedKnown = wasted != null;
  // Ordered by how close each card sits to a decision: money burning now, then
  // the summary score, then context. Blended CPA is last because it is null for
  // every workspace without revenue data — it held first position while showing
  // "—" and a setup link.
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <KpiCard
        label="Budget at Risk"
        help={<HelpTip variant="popover" content={HELP.WASTED_SPEND} />}
        value={wastedKnown ? fmtCurrency(wasted, currency) : '—'}
        valueClass={wastedKnown ? 'text-trend-danger' : undefined}
        delta={wastedKnown ? `${wastedPct}% of total` : 'Needs analysis'}
        deltaClass={wastedKnown ? 'text-trend-danger' : 'text-lumi-subtle'}
        // The bar shows the budget that IS working — InlineBar's scale is
        // higher-is-better, and wasted spend runs the other way. Passing the
        // raw pct painted 12% waste RED and 80% waste GREEN. The label names
        // what the bar actually represents so the two can't drift.
        footer={wastedKnown
          ? <InlineBar value={100 - wastedPct} max={100} ariaLabel={`${100 - wastedPct}% of spend working`} />
          : undefined}
      />
      <KpiCard
        label="Account Health"
        help={<HelpTip variant="popover" content={HELP.ACCOUNT_HEALTH} />}
        value={healthScore == null ? '—' : `${healthScore}/100`}
        valueClass={healthColor}
        delta={healthLabel}
        deltaClass={healthColor}
      />
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
        // "Per-campaign avg" is the SURFACE's caption for a figure that is
        // present — the reading publishes `cpaLabel: null` in that case for
        // exactly this reason. Every absence names itself.
        delta={blendedCpa != null ? 'Per-campaign avg' : cpaLabel}
        deltaClass="text-lumi-subtle"
        // The instruction belongs to ONE absence. Connecting revenue data fixes
        // a missing denominator; it does nothing for an outage, a mixed-currency
        // account, a seat that may not read this, or a request still in flight.
        footer={cpaAbsence === AGGREGATE_ABSENCE.NO_CONVERSIONS ? (
          <Link to={appRoutes.settingsRevenue} className="text-xs font-medium text-lumi-accent hover:underline">
            Connect sales data to unlock profit-based recommendations →
          </Link>
        ) : undefined}
      />
    </section>
  );
}
