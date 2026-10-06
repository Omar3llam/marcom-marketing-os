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
import { toMinor } from '@/lib/money';
import { allocationPresentation } from './allocationPresentation.js';

export function AllocationPanel({
  currency = null, monetaryReason = null,
  onPreview, onCommit,
  plan = null, previewNote = null, previewing = false, previewError = null,
  committed = null, committing = false, commitError = null,
  canCommit = false,
  // Allocation reconciles budget against BLENDED truth, so it needs a blended
  // revenue signal. Default true (ungated) preserves the standalone panel; the
  // Blended Truth page passes false when blended efficiency is unavailable.
  canAllocate = true,
}) {
  const [budget, setBudget] = useState('');
  const budgetMajor = Number(budget);
  const validBudget = Boolean(currency) && Number.isFinite(budgetMajor) && budgetMajor > 0;
  const totalBudgetMinor = validBudget ? toMinor(budgetMajor, currency) : null;

  // The server sizes no move when governed spend or efficiency evidence is unavailable.
  const monetaryValid = plan?.monetaryStatus === 'MONETARY_VALID' && plan.currency === currency;
  const unavailable = plan && (!monetaryValid || plan.efficiencyStatus !== 'VALID');
  const unmeasured = plan?.spendPeriod?.status === 'NOT_MEASURABLE';
  const readout = plan ? allocationPresentation(plan, monetaryValid ? plan.currency : null) : null;
  const refusal = (error) => error?.context?.reason ?? error?.response?.data?.reason ?? error?.message;

  return (
    <section className="mt-8">
      <div className="text-sm font-medium text-lumi-text flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" strokeWidth={1.5} /> Reallocate capital
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Distribute a monthly budget across your channels on blended truth. Each move is a proposal you confirm in Decisions — Lumi never moves money on its own.
      </p>

      {/* Budget input + preview */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-lumi-muted">{currency ?? '—'}</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            aria-label="Total budget"
            placeholder="Monthly budget"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="font-mono text-sm bg-lumi-elevated border border-lumi-border rounded-lg pl-12 pr-3 py-2 text-lumi-text placeholder:text-lumi-muted w-48"
          />
        </div>
        <button
          type="button"
          disabled={!validBudget || previewing || !canAllocate}
          title={!canAllocate ? 'Allocation requires available blended revenue efficiency and currency' : undefined}
          onClick={() => onPreview?.({ totalBudgetMinor, totalBudgetCurrency: currency })}
          className="rounded-lg border border-lumi-border bg-lumi-elevated px-3 py-2 text-sm font-semibold text-lumi-text transition-colors hover:bg-lumi-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          {previewing ? 'Previewing…' : 'Preview allocation'}
        </button>
      </div>

      {/* Honest reason the control is inert — no blended revenue to allocate against. */}
      {!canAllocate && (
        <p className="text-sm text-lumi-muted mb-2">
          Allocation unavailable{monetaryReason ? `: ${monetaryReason}` : ' until blended revenue and its currency are proven.'}
        </p>
      )}

      {previewError && (
        <p className="text-sm text-signal-kill">
          {refusal(previewError) || 'Couldn’t preview an allocation right now. Try again shortly.'}
        </p>
      )}
      {!previewError && previewNote && (
        <p className="text-sm text-lumi-muted">{previewNote}</p>
      )}

      {/* Proposed plan */}
      {plan && (
        <div className="mt-2 rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-lumi-border space-y-1 text-sm text-lumi-text break-words">
            <p>Allocation basis: {readout.basis}</p>
            <p>Budget period: {readout.period}</p>
            <p>Proposed budget: <span className="font-mono">{readout.totalBudget}</span></p>
            <p className="text-lumi-muted">Budget change = recommended budget − measured spend.</p>
          </div>
          {unavailable && (
            <p className="px-4 py-3 border-b border-lumi-border text-sm text-lumi-muted">
              Allocation unavailable{plan.efficiencyReason || plan.monetaryReason ? `: ${!monetaryValid ? plan.monetaryReason : plan.efficiencyReason}` : '.'} No move is sized.
            </p>
          )}
          {unmeasured && (
            <p className="px-4 py-3 border-b border-lumi-border text-sm text-lumi-muted">
              No move is sized. Lumi hasn’t measured spend over {plan.spendPeriod.period.start} – {plan.spendPeriod.period.end},
              the period this budget governs, so it won’t compare the two. Reason: {plan.spendPeriod.reason}.
            </p>
          )}
          {plan.projected && monetaryValid && plan.efficiencyStatus === 'VALID' && !unmeasured && (
            <div className="px-4 py-3 border-b border-lumi-border font-mono text-sm text-lumi-muted">
              <p className="font-medium text-lumi-text">Projected blended efficiency</p>
              <p className="mt-1">Measured basis: <span className="text-lumi-text">{readout.projection.before}</span> → Projected plan: <span className="text-lumi-text">{readout.projection.after}</span></p>
              {plan.projected.projectedCpaMinor != null && (
                <p className="mt-1">Projected CPA: <span className="text-lumi-text">{readout.projection.cpa}</span></p>
              )}
            </div>
          )}
          <section aria-label="Allocation budget records" className="sm:hidden divide-y divide-lumi-border text-sm">
            {readout.rows.map(row => <article key={row.id} aria-label={row.channel + ' allocation'} className="p-4 text-lumi-text break-words">
              <h3 className="font-medium">{row.channel}</h3>
              <dl className="mt-3 space-y-3">
                {[['Measured spend', row.measuredSpend], ['Recommended budget', row.recommendedBudget], ['Budget change', row.budgetChange], ['Blended efficiency', row.efficiency], ['Why', row.rationale]].map(([label, value]) => <div key={label}><dt className="text-lumi-muted">{label}</dt><dd className="mt-1">{value}</dd></div>)}
              </dl>
            </article>)}
          </section>
          <table className="hidden sm:table w-full text-sm">
            <caption className="sr-only">Proposed channel budget allocation</caption>
            <thead>
              <tr className="text-left text-lumi-muted border-b border-lumi-border">
                <th scope="col" className="px-4 py-2.5 font-medium">Channel</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Measured spend</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Recommended budget</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Budget change</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Blended efficiency</th>
              </tr>
            </thead>
            <tbody>
              {readout.rows.map((row) => (
                <tr key={row.id} className="border-b border-lumi-border/60">
                  <th scope="row" className="px-4 py-2.5 text-lumi-text font-medium text-left"><span>{row.channel}</span><p className="mt-1 text-sm font-normal text-lumi-muted break-words">{row.rationale}</p></th>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">{row.measuredSpend}</td>
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{row.recommendedBudget}</td>
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{row.budgetChange}</td>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">{row.efficiency}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Commit — STRATEGIST only. Persists the plan + PROPOSED moves. */}
          {canCommit && !unavailable && !unmeasured && (
            <div className="px-4 py-3 border-t border-lumi-border">
              <button
                type="button"
                disabled={committing || !validBudget}
                onClick={() => onCommit?.({ totalBudgetMinor, totalBudgetCurrency: currency })}
                className="rounded-lg bg-lumi-accent px-3 py-1.5 text-sm font-semibold text-lumi-bg transition-colors hover:bg-lumi-gold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {committing ? 'Committing…' : 'Commit allocation'}
              </button>
              {commitError && (
                <p className="mt-1.5 text-sm text-signal-kill">
                  {refusal(commitError) || 'Couldn’t commit the allocation right now. Try again shortly.'}
                </p>
              )}
              {committed && committed.decisionsCreated > 0 && (
                <p className="mt-1.5 text-sm text-signal-scale">
                  Committed — {committed.decisionsCreated} proposed move{committed.decisionsCreated === 1 ? '' : 's'}. Confirm {committed.decisionsCreated === 1 ? 'it' : 'them'} in Decisions to execute.
                </p>
              )}
              {/* Zero moves is not "0 proposed moves — confirm them": there is
                  nothing in Decisions to confirm. The budget itself was recorded. */}
              {committed && !(committed.decisionsCreated > 0) && (
                <p className="mt-1.5 text-sm text-signal-scale">
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
