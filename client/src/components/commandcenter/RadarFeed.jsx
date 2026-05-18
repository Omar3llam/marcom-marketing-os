import { AlertTriangle, TrendingDown, ArrowRight } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';

export default function RadarFeed({ radarAlerts, onReviewAlert }) {
  const alertCount = radarAlerts.length;

  return (
    <section aria-labelledby="radar-heading" className="mb-12">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full bg-signal-kill animate-pulse"
            aria-hidden="true"
          />
          <h2 id="radar-heading" className="font-display font-bold text-base sm:text-lg text-dark-base">
            🔴 Active Radar
          </h2>
        </div>
        <span
          className="font-mono text-xs text-dark-soft"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {alertCount} bleeding campaign{alertCount !== 1 ? 's' : ''} detected
        </span>
      </div>

      {alertCount === 0 ? (
        <EmptyRadar />
      ) : (
        <div className="space-y-3" role="list" aria-label="Radar alerts">
          {radarAlerts.map((alert, index) => (
            <RadarAlertCard
              key={alert.id}
              alert={alert}
              onReview={() => onReviewAlert(alert)}
              index={index}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RadarAlertCard({ alert, onReview, index }) {
  const riskBg = alert.risk_level === 'HIGH'   ? 'bg-signal-kill/5 border-signal-kill/20'
               : alert.risk_level === 'MEDIUM' ? 'bg-signal-hold/5 border-signal-hold/20'
               : 'bg-lumi-gold/5 border-lumi-gold/20';

  const riskText = alert.risk_level === 'HIGH'   ? 'text-signal-kill'
                 : alert.risk_level === 'MEDIUM' ? 'text-signal-hold'
                 : 'text-lumi-gold';

  const riskLabel = alert.risk_level === 'HIGH' ? 'High risk'
                  : alert.risk_level === 'MEDIUM' ? 'Medium risk'
                  : 'Low risk';

  return (
    <article
      className={cn(
        'rounded-2xl border p-4 sm:p-5 bg-surface-card transition-all hover:border-lumi-gold/40 shadow-card hover:shadow-card-hover focus-within:border-lumi-gold/60 focus-within:ring-2 focus-within:ring-lumi-gold/20',
        riskBg,
      )}
      role="listitem"
      aria-label={`Alert ${index + 1}: ${alert.title}`}
    >
      <div className="flex flex-col sm:flex-row items-start gap-4">
        {/* Alert Icon */}
        <div className="shrink-0">
          <div
            className="w-10 h-10 rounded-xl bg-lumi-gold/10 border border-lumi-gold/20 flex items-center justify-center"
            aria-label={riskLabel}
          >
            <TrendingDown className={cn('w-5 h-5', riskText)} strokeWidth={1.5} aria-hidden="true" />
          </div>
        </div>

        {/* Alert Content */}
        <div className="flex-1 min-w-0 w-full">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
            <h3 className="font-display font-bold text-base text-dark-base">{alert.title}</h3>
            <VerdictPill verdict={alert.verdict} />
          </div>

          {/* Impact (Psychological UX: Use exact copy) */}
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-signal-kill/10 border border-signal-kill/20 px-3 py-1.5">
            <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={1.5} aria-hidden="true" />
            <span className="font-mono text-xs sm:text-sm text-signal-kill">{alert.impact}</span>
          </div>

          {/* Why Breakdown */}
          <ul className="space-y-1 mb-4" aria-label="Alert reasons">
            {alert.why.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-dark-soft">
                <span className="text-lumi-gold mt-0.5" aria-hidden="true">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {/* Confidence + Review Button */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3">
            <span className="font-mono text-xs text-dark-soft">
              Confidence: <span className="text-dark-base tabular-nums font-semibold">{alert.confidence}%</span>
            </span>
            <button
              type="button"
              onClick={onReview}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onReview();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-display font-semibold text-sm bg-lumi-gold text-dark-base hover:bg-lumi-deep hover:shadow-gold-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lumi-gold shadow-card transition-all w-full sm:w-auto justify-center"
              aria-label={`Review alert for ${alert.title}`}
            >
              Review Alert <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
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
      <p className="text-dark-base font-display font-semibold">Radar sweep complete — market stable</p>
      <p className="mt-1 text-dark-soft text-sm">No bleeding campaigns detected. Intelligence monitoring active.</p>
    </div>
  );
}
