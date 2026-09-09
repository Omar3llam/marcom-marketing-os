// ============================================================
// MARCOM / Lumi — UnitEconomicsPanel  (Phase 4-D · STRATEGIST)
// ------------------------------------------------------------
// "Is acquisition sustainable for this account?" Surfaces the backend
// assessment: LTV / payback / LTV:CAC band, computed from the strategist's
// ASSERTED economics (AOV, margin, lifetime orders — user-owned inputs, real
// the way a guardrail rule is real) against the account's CURRENT realized CAC.
//
// HONEST BY CONSTRUCTION (governing law):
//   • reason NOT_CONFIGURED → no number; the assertion form (nothing is
//     surfaced as a measurement until the user owns the inputs).
//   • reason NO_CONVERSIONS → economics set, but no realized CAC yet — say so.
//   • assessment present → the verdict, with its assumptions listed and the
//     CURRENT blended CAC labelled as such (never conflated with a plan's
//     PROJECTED CAC).
// ============================================================
import { useState } from 'react';
import { Calculator, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency, fromMinor, toMinor } from '@/lib/money';

// Currency-aware minor-unit formatter (was an inline /100 that truncated 3-dp
// currencies like KWD and added cents to 0-dp JPY). ccy comes from the economics
// data (assessment/economics/cac), never a hardcoded assumption.
const money = (minor, ccy = 'USD') => formatCurrency(minor, ccy);

// ⚠️ The comment above was written for the READ-ONLY figures below and fixed
// only those. The assertion FORM kept the same literal in both directions, and
// the form is the dangerous half — it is the only write path to
// AccountEconomics. A wrong AOV shown is an operator who "corrects" it to the
// wrong minor value, which LTV, contribution per order and the LTV:CAC band
// then inherit. `fromMinor` / `toMinor` are the canonical crossings.

const bandTone = {
  HEALTHY:    'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  THIN:       'text-signal-hold bg-signal-hold-bg border-signal-hold/25',
  UNDERWATER: 'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
};

function Section({ children }) {
  return (
    <section className="mt-10">
      <div className="section-label">Unit Economics</div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Is acquisition sustainable? Your asserted economics measured against this account’s current realized CAC.
      </p>
      {children}
    </section>
  );
}

// ── The assertion form (AOV / margin / lifetime orders / target) ──
function EconomicsForm({ initial, onSave, saving }) {
  // The denomination of `aovMinor` is the currency stored ALONGSIDE it on the
  // same AccountEconomics row — not the assessment's and not the CAC's.
  const ccy = initial?.currency || 'USD';
  const [aov, setAov] = useState(initial?.aovMinor != null ? String(fromMinor(initial.aovMinor, ccy)) : '');
  const [margin, setMargin] = useState(initial?.grossMarginPct != null ? String(Math.round(initial.grossMarginPct * 100)) : '');
  const [orders, setOrders] = useState(initial?.avgOrdersPerCustomer != null ? String(initial.avgOrdersPerCustomer) : '1');
  const [target, setTarget] = useState(initial?.targetLtvToCac != null ? String(initial.targetLtvToCac) : '3');

  const aovNum = parseFloat(aov);
  const marginNum = parseFloat(margin);
  const valid = Number.isFinite(aovNum) && aovNum > 0 && Number.isFinite(marginNum) && marginNum >= 0 && marginNum <= 100;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onSave({
      // A minor-unit amount without its currency is a guess, not a number. This
      // form is the only writer of AccountEconomics, and the row is CREATED with
      // the column default 'USD' when the payload omits `currency` — so a KWD
      // account saving 50 dinars would read back 500 on the next refetch. The
      // denomination travels with the amount it denominates.
      currency: ccy,
      aovMinor: toMinor(aovNum, ccy),
      grossMarginPct: marginNum / 100,
      avgOrdersPerCustomer: Math.max(1, parseFloat(orders) || 1),
      targetLtvToCac: Math.max(0.1, parseFloat(target) || 3),
    });
  };

  const field = 'w-full rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-sm text-lumi-text focus:border-lumi-accent/50 outline-none';
  return (
    <form onSubmit={submit} className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-lumi-muted">Average order value
        <input className={field} inputMode="decimal" value={aov} onChange={(e) => setAov(e.target.value)} placeholder="e.g. 100" aria-label="Average order value" />
      </label>
      <label className="text-xs text-lumi-muted">Gross margin %
        <input className={field} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="e.g. 60" aria-label="Gross margin percent" />
      </label>
      <label className="text-xs text-lumi-muted">Lifetime orders / customer
        <input className={field} inputMode="decimal" value={orders} onChange={(e) => setOrders(e.target.value)} aria-label="Lifetime orders per customer" />
      </label>
      <label className="text-xs text-lumi-muted">Target LTV:CAC
        <input className={field} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target LTV to CAC" />
      </label>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button type="submit" disabled={!valid || saving}
          className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg hover:bg-lumi-gold disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? 'Saving…' : 'Save economics'}
        </button>
        <span className="text-xs text-lumi-subtle">You own these inputs — Lumi treats them as asserted, not measured.</span>
      </div>
    </form>
  );
}

// ── Pure, prop-driven panel (unit-tested directly) ──────────────
export function UnitEconomicsPanel({ data, loading = false, error = null, onSave, saving = false }) {
  const [editing, setEditing] = useState(false);

  if (loading) {
    return <Section><div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading unit economics…</div></Section>;
  }
  if (error) {
    return (
      <Section>
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load unit economics.
        </div>
      </Section>
    );
  }

  const reason = data?.reason;
  const economics = data?.economics ?? null;
  const assessment = data?.assessment ?? null;
  const cac = data?.currentCac ?? null;
  const ccy = assessment?.currency || economics?.currency || cac?.currency || 'USD';

  // NOT asserted yet → the form only. Nothing is shown as a measurement.
  if (reason === 'NOT_CONFIGURED' || editing) {
    return (
      <Section>
        <EconomicsForm initial={economics} onSave={(inputs) => { onSave?.(inputs); setEditing(false); }} saving={saving} />
      </Section>
    );
  }

  // Asserted, but no realized CAC to measure against.
  if (reason === 'NO_CONVERSIONS' || !assessment) {
    return (
      <Section>
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6">
          <p className="text-sm text-lumi-text">Economics set. No realized CAC yet — connect and sync a channel with conversion data to compute your current CAC and LTV:CAC.</p>
          <button type="button" onClick={() => setEditing(true)} className="mt-3 text-xs font-medium text-lumi-accent hover:underline">Edit economics</button>
        </div>
      </Section>
    );
  }

  // The verdict — every figure traces to an asserted input or a real CAC.
  const ratio = assessment.ltvToCac;
  const band = assessment.sustainabilityBand?.expected;
  return (
    <Section>
      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Calculator className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-display text-sm text-lumi-text">
            LTV:CAC <strong>{ratio?.expected ?? '—'}×</strong>
            {ratio?.low != null && ratio?.high != null && (
              <span className="text-lumi-subtle font-mono text-xs"> ({ratio.low}–{ratio.high}×)</span>
            )}
          </span>
          {band && (
            <span className={cn('font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border', bandTone[band] || bandTone.THIN)}>
              {band}
            </span>
          )}
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-xs font-medium text-lumi-accent hover:underline">Edit</button>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 font-mono text-xs text-lumi-subtle">
          <span>Current CAC <strong className="text-lumi-text">{cac?.currentBlendedCacMinor != null ? money(cac.currentBlendedCacMinor, ccy) : '—'}</strong></span>
          <span>LTV <strong className="text-lumi-text">{money(assessment.ltvMinor, ccy)}</strong></span>
          <span>Contribution/order <strong className="text-lumi-text">{money(assessment.contributionPerOrderMinor, ccy)}</strong></span>
          <span>Payback <strong className="text-lumi-text">{assessment.paybackOrders != null ? `${assessment.paybackOrders} order${assessment.paybackOrders === 1 ? '' : 's'}` : '—'}</strong></span>
        </div>
        <p className="mt-1 text-[11px] text-lumi-subtle">Current blended CAC = trailing spend ÷ platform conversions — the account’s realized CAC, not a plan projection.</p>

        {Array.isArray(assessment.assumptions) && assessment.assumptions.length > 0 && (
          <ul className="mt-3 space-y-0.5">
            {assessment.assumptions.map((a, i) => (
              <li key={i} className="text-[11px] text-lumi-subtle">• {a}</li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
