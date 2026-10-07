// ============================================================
// MARCOM / Lumi — FatigueForecastPanel  (Growth Strategy · forward signal)
// ------------------------------------------------------------
// Per-campaign, NAMED fatigue forecast from /api/lumi/entities/fatigue. Every
// field traces to a real row (name/channel/currentFrequency from the connector
// graph; velocity + daysUntilSaturation from the least-squares forecaster).
// Honest: hidden entirely when there's nothing to forecast (not an empty state),
// velocity omitted when frequency isn't rising, days shown as "~N" (a projection).
// ============================================================
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { appRoutes } from '@/app/routeManifest.js';
import { isRetryableReadError } from '@/design-system/states/readStatus.js';

const STATUS = {
  SATURATED: { text: 'text-signal-kill',  bg: 'bg-signal-kill-bg'  },
  AT_RISK:   { text: 'text-signal-watch', bg: 'bg-signal-watch-bg' },
  MONITOR:   { text: 'text-signal-hold',  bg: 'bg-signal-hold-bg'  },
  HEALTHY:   { text: 'text-signal-scale', bg: 'bg-signal-scale-bg' },
  STABLE:    { text: 'text-lumi-muted',   bg: 'bg-lumi-elevated'   },
};

// Compact human number for the mono line (45 200 → "45.2k"). Reach only.
function compact(n) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function breachLabel(item) {
  const d = item.daysUntilSaturation;
  switch (item.status) {
    case 'SATURATED': return 'saturated now';
    case 'AT_RISK':   return `~${d} day${d === 1 ? '' : 's'}`;
    case 'MONITOR': {
      const w = Math.max(1, Math.ceil(d / 7));
      return `~${w} week${w === 1 ? '' : 's'}`;
    }
    case 'HEALTHY':   return '3+ weeks';
    case 'STABLE':    return 'stable';
    default:          return '—';
  }
}

export function FatigueForecastPanel({ forecast = [], frequencyCeiling = null, loading = false, error = null, refetch }) {
  if (loading) {
    return (
      <section className="mb-10">
        <div className="section-label">Fatigue Forecast</div>
        <div className="mt-3 rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">
          Loading…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-10">
        <div className="section-label">Fatigue Forecast</div>
        <div role="alert" className="mt-3 rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">
          Couldn’t read fatigue forecast.
          {isRetryableReadError(error) && typeof refetch === 'function' && (
            <button type="button" onClick={refetch} className="ml-2 underline">
              Try again
            </button>
          )}
        </div>
      </section>
    );
  }

  // Nothing to forecast → hide the section entirely (not an empty-state card).
  if (!forecast?.length) return null;

  return (
    <section className="mb-10">
      <div className="section-label flex items-center gap-2">
        Fatigue Forecast
        <HelpTip variant="popover" content={HELP.FATIGUE_FORECAST} />
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        When each campaign’s audience is projected to saturate — from how fast frequency is rising, re-scored each sync.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {forecast.map((item) => {
          const cfg = STATUS[item.status] ?? STATUS.STABLE;
          return (
            <li key={item.entityId} className="min-w-0">
              {/* Deep-link to the campaign row on the Campaigns page (reads
                  ?entity= to scroll-to + expand it) — entityId is the connector
                  Campaign.id, so this resolves to the same row the agenda uses. */}
              <Link
                to={`${appRoutes.campaigns}?entity=${encodeURIComponent(item.entityId)}`}
                className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center bg-lumi-surface border border-lumi-border rounded-xl p-4 hover:border-lumi-accent/40 transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-lumi-bg"
              >
                <div className="min-w-0 flex-1 w-full">
                  <p className="font-display text-sm text-lumi-text break-words">{item.name || 'Unnamed campaign'}</p>
                  <p className="mt-0.5 font-mono text-sm text-lumi-muted break-words">
                    {item.channel || 'channel'} · freq {item.currentFrequency}
                    {item.velocity != null && ` · +${item.velocity}/day`}
                    {item.reach != null && ` · reach ${compact(item.reach)}`}
                    {item.exhaustionPct != null && (
                      <span className="ml-1 text-lumi-muted">
                        · {item.exhaustionPct}% of ceiling
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 max-w-full inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-sm break-words',
                    cfg.text, cfg.bg,
                  )}
                >
                  {item.status === 'SATURATED' && <AlertTriangle className="w-3 h-3" strokeWidth={2} />}
                  <span className="text-lumi-text">{breachLabel(item)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {typeof frequencyCeiling === 'number' && Number.isFinite(frequencyCeiling) && frequencyCeiling > 0 && (
        <p className="mt-3 font-mono text-sm text-lumi-muted">
          Saturation threshold: frequency ≥ {frequencyCeiling} · re-scored each sync
        </p>
      )}
    </section>
  );
}
