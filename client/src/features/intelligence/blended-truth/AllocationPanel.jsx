// ============================================================
// MARCOM / Lumi — AllocationPanel  (Phase 3 · capital allocation)
// ------------------------------------------------------------
// The preview-then-commit control for cross-channel budget allocation, sitting
// on the Blended Truth page because allocation acts on exactly those blended-
// truth channels. Enter a budget → Preview the proposed per-channel moves
// (projection only) → Commit, which persists the plan and mints PROPOSED
// REALLOCATE Decisions you confirm through the existing execute path. Lumi
// never moves money on its own.
//
// Honesty: a null preview (no connected channels) renders the real message, not
// a fabricated split; the real preview/commit errors are surfaced verbatim.
// Commit is STRATEGIST-only — the panel is gated to that role by its parent.
// ============================================================
import { useState } from 'react';
import { Scale } from 'lucide-react';
import { formatCurrency, toMinor } from '@/lib/money';

// Null/non-finite ROAS → "—" (honest empty), never a fabricated 0.0× that reads
// as a real (terrible) return. A genuine finite 0 still formats as 0.0×.
const fx = (n) => (n == null || !Number.isFinite(Number(n))) ? '—' : `${Number(n).toFixed(1)}×`;

export function AllocationPanel({
  currency = 'USD',
  onPreview, onCommit,
  plan = null, previewNote = null, previewing = false, previewError = null,
  committed = null, committing = false, commitError = null,
  canCommit = false,
  // Allocation reconciles budget against BLENDED truth, so it needs a blended
  // revenue signal. Default true (ungated) preserves the standalone panel; the
  // Blended Truth page passes false when there's no blended ROAS yet.
  canAllocate = true,
}) {
  const [budget, setBudget] = useState('');
  const budgetMajor = Number(budget);
  const validBudget = Number.isFinite(budgetMajor) && budgetMajor > 0;
  const totalBudgetMinor = validBudget ? toMinor(budgetMajor, currency) : 0;

  const allocations = plan?.allocations ?? [];
  const projected = plan?.projected ?? null;
  // The server sized no move: spend over the period this budget governs is not
  // measured. Every figure below would have been computed from that spend.
  const unmeasured = plan?.spendPeriod?.status === 'NOT_MEASURABLE';
  const money = (minor) => (minor == null ? '—' : formatCurrency(minor, currency));

  return (
    <section className="mt-8">
      <div className="section-label flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" strokeWidth={1.5} /> Reallocate capital
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Distribute a monthly budget across your channels on blended truth. Each move is a proposal you confirm in Decisions — Lumi never moves money on its own.
      </p>

      {/* Budget input + preview */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-lumi-subtle">{currency}</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            aria-label="Total budget"
            placeholder="Monthly budget"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="font-mono text-sm bg-lumi-elevated border border-lumi-border rounded-lg pl-12 pr-3 py-2 text-lumi-text placeholder:text-lumi-subtle w-48"
          />
        </div>
        <button
          type="button"
          disabled={!validBudget || previewing || !canAllocate}
          title={!canAllocate ? 'Reconcile revenue across your channels to enable allocation' : undefined}
          onClick={() => onPreview?.({ totalBudgetMinor })}
          className="rounded-lg border border-lumi-border bg-lumi-elevated px-3 py-2 text-xs font-semibold text-lumi-text transition-colors hover:bg-lumi-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          {previewing ? 'Previewing…' : 'Preview allocation'}
        </button>
      </div>

      {/* Honest reason the control is inert — no blended revenue to allocate against. */}
      {!canAllocate && (
        <p className="text-xs text-lumi-subtle mb-2">
          Allocation needs blended revenue across your channels. Connect a revenue source (and a second channel) to enable it.
        </p>
      )}

      {previewError && (
        <p className="text-xs text-signal-kill">
          {previewError.message || 'Couldn’t preview an allocation right now. Try again shortly.'}
        </p>
      )}
      {!previewError && previewNote && (
        <p className="text-xs text-lumi-subtle">{previewNote}</p>
      )}

      {/* Proposed plan */}
      {plan && (
        <div className="mt-2 rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          {unmeasured && (
            <p className="px-4 py-3 border-b border-lumi-border text-xs text-lumi-subtle">
              No move is sized. Lumi hasn’t measured spend over {plan.spendPeriod.period.start} – {plan.spendPeriod.period.end},
              the period this budget governs, so it won’t compare the two.
            </p>
          )}
          {projected && !unmeasured && (
            <div className="px-4 py-3 border-b border-lumi-border font-mono text-xs text-lumi-subtle">
              Projected MER <span className="text-lumi-muted">{fx(projected.merBefore)}</span> →{' '}
              <span className="text-signal-scale">{fx(projected.merAfter)}</span>
              {projected.projectedCpaMinor != null && (
                <> · projected CPA <span className="text-lumi-text">{formatCurrency(projected.projectedCpaMinor, currency)}</span></>
              )}
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-lumi-subtle border-b border-lumi-border">
                <th className="px-4 py-2.5 font-medium">Channel</th>
                <th className="px-4 py-2.5 font-medium">Now</th>
                <th className="px-4 py-2.5 font-medium">Recommended</th>
                <th className="px-4 py-2.5 font-medium">Δ</th>
                <th className="px-4 py-2.5 font-medium">Blended ROAS</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.channelId} className="border-b border-lumi-border/60" title={a.rationale}>
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{a.channel ?? a.channelId}</td>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">{money(a.currentSpendMinor)}</td>
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{money(a.recommendedSpendMinor)}</td>
                  <td className={`px-4 py-2.5 font-mono ${a.deltaMinor > 0 ? 'text-signal-scale' : a.deltaMinor < 0 ? 'text-signal-kill' : 'text-lumi-subtle'}`}>
                    {a.deltaMinor > 0 ? '+' : ''}{money(a.deltaMinor)}
                  </td>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">{fx(a.blendedRoas)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Commit — STRATEGIST only. Persists the plan + PROPOSED moves. */}
          {canCommit && (
            <div className="px-4 py-3 border-t border-lumi-border">
              <button
                type="button"
                disabled={committing || !validBudget}
                onClick={() => onCommit?.({ totalBudgetMinor })}
                className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-gold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {committing ? 'Committing…' : 'Commit allocation'}
              </button>
              {commitError && (
                <p className="mt-1.5 text-xs text-signal-kill">
                  {commitError.message || 'Couldn’t commit the allocation right now. Try again shortly.'}
                </p>
              )}
              {committed && committed.decisionsCreated > 0 && (
                <p className="mt-1.5 text-xs text-signal-scale">
                  Committed — {committed.decisionsCreated} proposed move{committed.decisionsCreated === 1 ? '' : 's'}. Confirm {committed.decisionsCreated === 1 ? 'it' : 'them'} in Decisions to execute.
                </p>
              )}
              {/* Zero moves is not "0 proposed moves — confirm them": there is
                  nothing in Decisions to confirm. The budget itself was recorded. */}
              {committed && !(committed.decisionsCreated > 0) && (
                <p className="mt-1.5 text-xs text-signal-scale">
                  {unmeasured
                    ? 'Committed — budget recorded. No moves were proposed, because spend over this period isn’t measured.'
                    : 'Committed — budget recorded. The mix asked for no moves.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
