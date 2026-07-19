// ============================================================
// MARCOM / Lumi — ScenarioPanel  (Phase 4-E · forward what-if)
// ------------------------------------------------------------
// "What would happen if we moved the budget?" Every projected metric is a
// { low, expected, high } RANGE with a named assumptions[] — never a point
// (the honesty rule, enforced server-side, surfaced faithfully here).
//
// The projected blended CAC is labelled PROJECTED on purpose — it is a
// forward hypothetical, NOT the realized current CAC shown on the unit-
// economics surface. The two answer different questions and are never
// conflated. Nothing is shown until the user runs a projection.
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, AlertCircle, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';
import { appRoutes } from '@/app/routeManifest.js';
import UpgradePrompt from '@/components/plan/UpgradePrompt.jsx';

const money = (minor, ccy = 'USD') => (minor == null ? '—' : formatCurrency(minor, ccy));

const num = (v, digits = 0) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits }));

function RangeRow({ label, range, fmt }) {
  if (!range) return null;
  const { low, expected, high } = range;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-lumi-border/60 last:border-0">
      <span className="text-xs text-lumi-muted">{label}</span>
      <span className="font-mono text-xs text-lumi-text">
        <strong>{fmt(expected)}</strong>
        {low != null && high != null && (
          <span className="text-lumi-subtle"> ({fmt(low)}–{fmt(high)})</span>
        )}
      </span>
    </div>
  );
}

// ── The change controls (signed budget delta → expansion/contraction) ──
function Controls({ onRun, loading }) {
  const [direction, setDirection] = useState('expand');
  const [pct, setPct] = useState('20');

  const magnitude = parseFloat(pct);
  const valid = Number.isFinite(magnitude) && magnitude > 0 && magnitude <= 100;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const deltaPct = (direction === 'expand' ? 1 : -1) * (magnitude / 100);
    onRun({ type: direction === 'expand' ? 'BUDGET_EXPANSION' : 'BUDGET_CONTRACTION', deltaPct });
  };

  const tab = (active) => cn(
    'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
    active ? 'bg-lumi-accent text-lumi-bg border-lumi-accent' : 'bg-lumi-surface text-lumi-muted border-lumi-border hover:border-lumi-border-strong',
  );

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="inline-flex gap-2">
        <button type="button" className={tab(direction === 'expand')} onClick={() => setDirection('expand')}>Expand</button>
        <button type="button" className={tab(direction === 'contract')} onClick={() => setDirection('contract')}>Contract</button>
      </div>
      <label className="text-xs text-lumi-muted">Total budget change %
        <input
          className="mt-1 w-28 rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-sm text-lumi-text focus:border-lumi-accent/50 outline-none"
          inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Budget change percent"
        />
      </label>
      <button type="submit" disabled={!valid || loading}
        className="rounded-lg bg-lumi-accent px-3 py-2 text-xs font-semibold text-lumi-bg hover:bg-lumi-accent-hover disabled:opacity-40 disabled:cursor-not-allowed">
        {loading ? 'Projecting…' : 'Project'}
      </button>
    </form>
  );
}

export function ScenarioPanel({ scenario, message = null, gated = false, loading = false, error = null, onRun, currency }) {
  // Tier gate wins over every other state (mirrors IncrementalityPanel): a 403
  // from requirePlan('PRO') is an honest LOCKED state, not a failure. Checked
  // first so a gated workspace never sees the controls or an error flash.
  if (gated) return <UpgradePrompt feature="Scenario projection" requiredPlan="PRO" />;

  // The scenario's own currency wins (most specific); else the workspace currency
  // threaded from the page; else USD. Never a hardcoded assumption.
  const ccy = scenario?.currency ?? currency ?? 'USD';
  const p = scenario?.projections;
  // When the workspace hasn't asserted its unit economics, the server blanks the
  // AOV/margin-derived projections (volume, CAC, gross profit) to null ranges (→ "—")
  // rather than compute them off a default AOV. Surface the fix, don't hide it.
  const economicsNotConfigured = scenario?.economicsStatus === 'NOT_CONFIGURED';

  return (
    <section className="mb-10">
      <div className="section-label">Scenario Projection</div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        A forward what-if on your real channel mix. Every figure is a range under named assumptions — not a promise.
      </p>

      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <Controls onRun={onRun} loading={loading} />

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-signal-kill">
            <AlertCircle className="w-4 h-4" strokeWidth={1.5} /> Couldn’t project that scenario.
          </div>
        )}

        {!error && !loading && message && !scenario && (
          <p className="mt-4 text-sm text-lumi-subtle">{message}</p>
        )}

        {!error && scenario && p && (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <LineChart className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
                <span className="font-display text-sm text-lumi-text">Projected outcome</span>
                {typeof scenario.confidence === 'number' && (
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-lumi-subtle">
                    {Math.round(scenario.confidence * 100)}% confidence
                  </span>
                )}
              </div>
              <RangeRow label="Projected CAC" range={p.blendedCacMinor} fmt={(v) => money(v, ccy)} />
              <RangeRow label="Volume (orders)" range={p.volume} fmt={(v) => num(v)} />
              <RangeRow label="Revenue" range={p.revenueMinor} fmt={(v) => money(v, ccy)} />
              <RangeRow label="Gross profit" range={p.grossProfitMinor} fmt={(v) => money(v, ccy)} />
              <RangeRow label="MER after" range={p.merAfter} fmt={(v) => `${num(v, 2)}×`} />
              <p className="mt-2 text-[11px] text-lumi-subtle">
                Projected CAC is a forward hypothetical — not the account’s realized current CAC.
              </p>
              {economicsNotConfigured && (
                <p className="mt-2 text-[11px] text-lumi-muted">
                  <Link to={appRoutes.insights} className="text-lumi-accent hover:underline">
                    Configure Unit Economics →
                  </Link>{' '}
                  to unlock Volume, CAC and Gross Profit projections.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <TrendingUp className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
                <span className="font-display text-sm text-lumi-text">Assumptions</span>
              </div>
              <ul className="space-y-1">
                {(scenario.assumptions ?? []).map((a, i) => (
                  <li key={i} className="text-[11px] text-lumi-subtle leading-relaxed">• {a}</li>
                ))}
              </ul>
              {Array.isArray(scenario.memoryBasis) && scenario.memoryBasis.length > 0 && (
                <p className="mt-3 text-[11px] text-lumi-subtle">
                  Powered by {scenario.memoryBasis.length} learned pattern{scenario.memoryBasis.length === 1 ? '' : 's'}.
                </p>
              )}
              {scenario.basis && <p className="mt-2 text-[11px] text-lumi-muted">{scenario.basis}</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
