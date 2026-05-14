import { AlertTriangle, TrendingDown, ArrowRight } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';

export default function RadarFeed({ radarAlerts, onReviewAlert }) {
  return (
    <section aria-labelledby="radar-heading" className="mb-12">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-signal-kill animate-pulse" aria-hidden="true" />
        <h2 id="radar-heading" className="font-display font-bold text-lg text-dark-base">
          🔴 Active Radar
        </h2>
        <span className="font-mono text-xs text-dark-soft ml-2">
          {radarAlerts.length} bleeding campaign{radarAlerts.length !== 1 ? 's' : ''} detected
        </span>
      </div>

      {radarAlerts.length === 0 ? (
        <EmptyRadar />
      ) : (
        <div className="space-y-3">
          {radarAlerts.map((alert) => (
            <RadarAlertCard key={alert.id} alert={alert} onReview={() => onReviewAlert(alert)} />
          ))}
        </div>
      )}
    </section>
  );
}

function RadarAlertCard({ alert, onReview }) {
  const riskBg = alert.risk_level === 'HIGH'   ? 'bg-signal-kill/5 border-signal-kill/20'
               : alert.risk_level === 'MEDIUM' ? 'bg-signal-hold/5 border-signal-hold/20'
               : 'bg-lumi-gold/5 border-lumi-gold/20';

  const riskText = alert.risk_level === 'HIGH'   ? 'text-signal-kill'
                 : alert.risk_level === 'MEDIUM' ? 'text-signal-hold'
                 : 'text-lumi-gold';

  return (
    <article
      className={cn(
        'rounded-2xl border p-5 bg-surface-card transition-all hover:border-lumi-gold/40 shadow-card hover:shadow-card-hover',
        riskBg,
      )}
    >
      <div className="flex items-start gap-4">
        {/* Alert Icon */}
        <div className="shrink-0 mt-1">
          <div className="w-10 h-10 rounded-xl bg-lumi-gold/10 border border-lumi-gold/20 flex items-center justify-center">
            <TrendingDown className={cn('w-5 h-5', riskText)} strokeWidth={1.5} />
          </div>
        </div>

        {/* Alert Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-display font-bold text-base text-dark-base">{alert.title}</h3>
            <VerdictPill verdict={alert.verdict} />
          </div>

          {/* Impact (Psychological UX: Use exact copy) */}
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-signal-kill/10 border border-signal-kill/20 px-3 py-1.5">
            <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={1.5} />
            <span className="font-mono text-sm text-signal-kill">{alert.impact}</span>
          </div>

          {/* Why Breakdown */}
          <ul className="space-y-1 mb-4">
            {alert.why.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-dark-soft">
                <span className="text-lumi-gold mt-0.5">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {/* Confidence + Review Button */}
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-dark-soft">
              Confidence: <span className="text-dark-base tabular-nums">{alert.confidence}%</span>
            </span>
            <button
              type="button"
              onClick={onReview}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-display font-semibold text-sm bg-lumi-gold text-dark-base hover:bg-lumi-deep hover:shadow-gold-glow shadow-card transition-all"
            >
              Review Alert <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyRadar() {
  return (
    <div className="rounded-2xl border border-dashed border-surface-border bg-surface-light/40 py-12 text-center shadow-card">
      <div className="w-12 h-12 mx-auto rounded-full bg-signal-scale/10 flex items-center justify-center mb-3">
        <AlertTriangle className="w-6 h-6 text-signal-scale" strokeWidth={1.5} />
      </div>
      <p className="text-dark-base font-display font-semibold">All clear</p>
      <p className="mt-1 text-dark-soft text-sm">No bleeding campaigns detected. Radar monitoring active.</p>
    </div>
  );
}
