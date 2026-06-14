// ============================================================
// MARCOM / Lumi — FatigueForecast  (Intelligence · the forward signal)
// ------------------------------------------------------------
// Surfaces the feed's `fatiguePredictions` (Phase 2): WHEN an entity is
// projected to breach its fatigue ceiling, before it bleeds. Every field traces
// to a FatiguePrediction row (metric, ceiling, projectedBreachDate, confidence,
// basis) — nothing inferred. The prediction keys the entity graph (entityId), a
// substrate disjoint from the feed's campaign names, so it carries no display
// name; we show the entity LEVEL honestly rather than fake one. Days-to-breach
// is computed from the real projectedBreachDate.
// ============================================================
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

function breachLabel(days) {
  if (days == null) return null;
  if (days <= 0) return 'ceiling reached';
  if (days === 1) return 'in ~1 day';
  return `in ~${days} days`;
}

function urgencyColor(days) {
  if (days == null) return 'text-lumi-subtle';
  if (days <= 2) return 'text-signal-kill';
  if (days <= 5) return 'text-signal-hold';
  return 'text-lumi-text';
}

export function FatigueForecast({ predictions = [], loading = false }) {
  return (
    <section className="mb-10">
      <div className="section-label">Fatigue Forecast</div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        When each entity is projected to breach its fatigue ceiling — the forward signal, before the bleed.
      </p>

      {loading ? (
        <div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading…</div>
      ) : predictions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-8 text-center">
          <TrendingUp className="w-10 h-10 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">No fatigue forecasts yet.</p>
          <p className="mt-1 text-lumi-muted text-sm">Lumi projects breaches as frequency data accumulates per entity.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {predictions.map((p) => {
            const days = daysUntil(p.projectedBreachDate);
            const conf = Number.isFinite(p.confidence) ? Math.round(p.confidence * 100) : null;
            return (
              <li key={`${p.entityId}-${p.metric}`} className="bg-lumi-surface border border-lumi-border rounded-xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs uppercase tracking-wide text-lumi-subtle">{(p.entityLevel || 'ENTITY').replace(/_/g, ' ')}</span>
                  {conf != null && <span className="font-mono text-xs text-lumi-muted">{conf}% confidence</span>}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <AlertTriangle className={cn('w-3.5 h-3.5 self-center', urgencyColor(days))} strokeWidth={2} />
                  <span className="font-display text-sm text-lumi-text">
                    {p.metric || 'frequency'} → {p.ceiling}
                  </span>
                  <span className={cn('font-mono text-xs', urgencyColor(days))}>{breachLabel(days) || '—'}</span>
                </div>
                {p.basis && <p className="mt-1.5 text-xs text-lumi-subtle line-clamp-2">{p.basis}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
