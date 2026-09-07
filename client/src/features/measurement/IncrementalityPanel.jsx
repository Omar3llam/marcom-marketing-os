// ============================================================
// MARCOM / Lumi — IncrementalityPanel  (Phase 4-E · STRATEGIST + tier-gated)
// ------------------------------------------------------------
// Holdout testing — the only causal signal. The honest loop, end to end:
//   design (power calc) → record OBSERVED counts → conclude (lift + CI).
//
// THE PRODUCT SEAM: `gated` (a 403 from the tier middleware) renders an honest
// LOCKED state — measurement is Agency/Enterprise depth, not a failure.
//
// HONEST BY CONSTRUCTION:
//   • A holdout with no recorded counts cannot be concluded (no Conclude button
//     until results are entered) — the readout is never fabricated off empty arms.
//   • A CONCLUDED holdout renders its PERSISTED lift/CI/confidence; an
//     inconclusive result says "no causal lift called", never a hopeful number.
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Microscope, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { appRoutes } from '@/app/routeManifest.js';
import { confidenceRung, confidenceText } from '@/design-system/states/confidence.js';

const statusTone = {
  DESIGNED:  'text-stage-testing bg-stage-testing/10 border-stage-testing/25',
  RUNNING:   'text-signal-hold bg-signal-hold-bg border-signal-hold/25',
  CONCLUDED: 'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  ABANDONED: 'text-lumi-subtle bg-lumi-surface border-lumi-border',
};

const field = 'w-full rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-sm text-lumi-text focus:border-lumi-accent/50 outline-none';

// ── Design a holdout (power calc off asserted inputs) ──────────
function DesignForm({ onDesign, busy }) {
  const [channel, setChannel] = useState('');
  const [cvr, setCvr] = useState('');
  const [mde, setMde] = useState('');
  const [daily, setDaily] = useState('');

  const cvrN = parseFloat(cvr), mdeN = parseFloat(mde);
  const dailyN = /^\d+$/.test(daily.trim()) ? Number(daily) : NaN; // strict int — no silent truncation
  const valid = channel.trim() && cvrN > 0 && cvrN < 100 && mdeN > 0 && mdeN <= 500 && dailyN > 0;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onDesign({ channel: channel.trim().toUpperCase(), baselineCvr: cvrN / 100, mde: mdeN / 100, dailyEligible: dailyN });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5 grid gap-3 sm:grid-cols-4">
      <label className="text-xs text-lumi-muted sm:col-span-1">Channel
        <input className={field} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="META" aria-label="Channel" />
      </label>
      <label className="text-xs text-lumi-muted">Baseline CVR %
        <input className={field} inputMode="decimal" value={cvr} onChange={(e) => setCvr(e.target.value)} placeholder="2" aria-label="Baseline CVR percent" />
      </label>
      <label className="text-xs text-lumi-muted"><span className="inline-flex items-center gap-1">Min. detectable lift % <HelpTip variant="popover" content={HELP.MDE} /></span>
        <input className={field} inputMode="decimal" value={mde} onChange={(e) => setMde(e.target.value)} placeholder="10" aria-label="Minimum detectable lift percent" />
      </label>
      <label className="text-xs text-lumi-muted">Daily eligible users
        <input className={field} inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="5000" aria-label="Daily eligible users" />
      </label>
      <div className="sm:col-span-4 flex items-center gap-3">
        <button type="submit" disabled={!valid || busy}
          className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg hover:bg-lumi-accent-hover disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? 'Designing…' : 'Design holdout'}
        </button>
        <span className="text-xs text-lumi-subtle">Computes the sample size + duration to detect that lift at 95% / 80% power.</span>
      </div>
    </form>
  );
}

// ── Record observed counts (the write organ) ───────────────────
function RecordForm({ test, onRecord, busy }) {
  const [eu, setEu] = useState(test.exposedUsers != null ? String(test.exposedUsers) : '');
  const [ec, setEc] = useState(test.exposedConversions != null ? String(test.exposedConversions) : '');
  const [hu, setHu] = useState(test.holdoutUsers != null ? String(test.holdoutUsers) : '');
  const [hc, setHc] = useState(test.holdoutConversions != null ? String(test.holdoutConversions) : '');

  // Strict integer parse — '1.9' / '12abc' must NOT be silently coerced into a
  // count (a holdout result is a measurement, never a guess).
  const parseStrictInt = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);
  const ints = [eu, ec, hu, hc].map(parseStrictInt);
  const valid = ints.every((n) => Number.isInteger(n) && n >= 0) && ints[1] <= ints[0] && ints[3] <= ints[2];

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onRecord(test.id, { exposedUsers: ints[0], exposedConversions: ints[1], holdoutUsers: ints[2], holdoutConversions: ints[3] });
  };

  const small = 'w-full rounded-md border border-lumi-border bg-lumi-surface px-2 py-1.5 text-xs text-lumi-text focus:border-lumi-accent/50 outline-none';
  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-4">
      <label className="text-[11px] text-lumi-subtle">Exposed users
        <input className={small} inputMode="numeric" value={eu} onChange={(e) => setEu(e.target.value)} aria-label="Exposed users" />
      </label>
      <label className="text-[11px] text-lumi-subtle">Exposed conversions
        <input className={small} inputMode="numeric" value={ec} onChange={(e) => setEc(e.target.value)} aria-label="Exposed conversions" />
      </label>
      <label className="text-[11px] text-lumi-subtle">Holdout users
        <input className={small} inputMode="numeric" value={hu} onChange={(e) => setHu(e.target.value)} aria-label="Holdout users" />
      </label>
      <label className="text-[11px] text-lumi-subtle">Holdout conversions
        <input className={small} inputMode="numeric" value={hc} onChange={(e) => setHc(e.target.value)} aria-label="Holdout conversions" />
      </label>
      <div className="sm:col-span-4">
        <button type="submit" disabled={!valid || busy}
          className="rounded-lg border border-lumi-border bg-lumi-surface px-3 py-1.5 text-xs font-semibold text-lumi-text hover:border-lumi-border-strong disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? 'Saving…' : 'Record observed results'}
        </button>
      </div>
    </form>
  );
}

// ── A single holdout row ────────────────────────────────────────
function HoldoutRow({ test, readout, busy, onRecord, onConclude, ccy = 'USD' }) {
  const concluded = test.status === 'CONCLUDED';
  const conclusive = concluded && test.confidenceLabel != null;

  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Microscope className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
        {/* B8-05 — the holdout is addressable. `GET /incrementality/:id` has
            been served since Phase 7C with no caller at all; this is how a
            person reaches it. The row keeps every operator control. */}
        <Link
          to={`${appRoutes.measure}/${encodeURIComponent(test.id)}`}
          className="font-display text-sm text-lumi-text hover:underline"
        >
          {test.name || `${test.channel} holdout`}
        </Link>
        <span className={cn('font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border', statusTone[test.status] || statusTone.ABANDONED)}>
          {test.status}
        </span>
        <span className="ml-auto font-mono text-[11px] text-lumi-subtle">
          {test.sampleSizePerArm?.toLocaleString()} / arm · {test.durationDays}d
        </span>
      </div>

      {/* Provenance: a holdout promoted from a concluded A/B test (Phase 7C). */}
      {test.sourceTest && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-lumi-subtle">
          From A/B test · {test.sourceTest.dimension}
        </p>
      )}

      {/* CONCLUDED → persisted readout (real backing row, never re-derived) */}
      {concluded && (
        <div className="mt-3">
          {conclusive ? (
            <p className="text-sm text-signal-scale">
              {/* B8-05 · R-E4 — the rung, not the stored word. This half spells
                  the middle band MEDIUM and the A/B half spells it MODERATE;
                  a reader should not have to learn which engine wrote the row. */}
              {Number(test.liftPct) > 0 ? '+' : ''}{test.liftPct}% incremental lift · {confidenceText(confidenceRung(test.confidenceLabel))}
              {test.incrementalRevenueMinor != null && <span className="text-lumi-subtle"> · {formatCurrency(test.incrementalRevenueMinor, ccy)} incremental revenue</span>}
            </p>
          ) : (
            // The A/B half stores the word INCONCLUSIVE where this half stores
            // null. Same finding, and now the same sentence.
            <p className="text-sm text-lumi-muted">No causal lift called — no call could be made.</p>
          )}
          {readout?.rationale && <p className="mt-1 text-[11px] text-lumi-subtle">{readout.rationale}</p>}
        </div>
      )}

      {/* NOT concluded → record results; conclude only once counts exist (RUNNING) */}
      {!concluded && test.status !== 'ABANDONED' && (
        <>
          <RecordForm test={test} onRecord={onRecord} busy={busy} />
          {test.status === 'RUNNING' ? (
            <button type="button" onClick={() => onConclude(test.id)} disabled={busy}
              className="mt-3 rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg hover:bg-lumi-accent-hover disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? 'Reading out…' : 'Conclude holdout'}
            </button>
          ) : (
            <p className="mt-2 text-[11px] text-lumi-subtle">Awaiting observed results — record the holdout’s counts to enable a readout.</p>
          )}
        </>
      )}
    </div>
  );
}

export function IncrementalityPanel({ tests = [], readouts = {}, gated = false, loading = false, error = null, busyId = null, onDesign, onRecord, onConclude, currency }) {
  const ccy = currency ?? 'USD';
  return (
    <section className="mb-10">
      <div className="section-label inline-flex items-center gap-1">
        Incrementality (Holdout Testing)
        <HelpTip variant="popover" content={HELP.INCREMENTALITY} />
        <HelpTip variant="popover" content={HELP.HOLDOUT} label="Holdout" />
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        The only causal signal — measure the lift a channel actually drives by holding it out from a randomized group.
      </p>

      {gated ? (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface/60 p-8 text-center">
          <Lock className="w-8 h-8 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">Measurement is an Agency/Enterprise capability.</p>
          <p className="mt-1 text-lumi-muted text-sm">Incrementality holdouts aren’t enabled for this workspace.</p>
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading holdouts…</div>
      ) : error ? (
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} />
          <p>We couldn’t load incrementality right now.</p>
          <p className="mt-1 text-dark-soft">Holdout testing needs a connected channel with live campaigns.</p>
          <Link to={appRoutes.settingsIntegrations} className="mt-3 inline-flex items-center gap-1 font-medium text-lumi-accent hover:underline">
            Connect Meta →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <DesignForm onDesign={onDesign} busy={busyId === 'new'} />
          {tests.length === 0 ? (
            <p className="text-sm text-lumi-subtle">No holdouts yet — design one above to measure a channel’s true causal lift.</p>
          ) : (
            tests.map((t) => (
              <HoldoutRow key={t.id} test={t} readout={readouts[t.id]} busy={busyId === t.id} onRecord={onRecord} onConclude={onConclude} ccy={ccy} />
            ))
          )}
        </div>
      )}
    </section>
  );
}
