// ============================================================
// MARCOM / Lumi — AccountBriefing  ("What Lumi knows about this account")
// ------------------------------------------------------------
// Surfaces GET /api/lumi/briefing (Phase 5 Memory Moat) — the workspace's
// learned, truth-weighted AccountPatterns. Every field traces to an
// AccountPattern row: statement, status (EMERGING/ESTABLISHED/…), accuracy
// ("was Lumi right?", null until outcomes are known → "—"), confidence.
// Validated against BriefingSchema in useAccountBriefing; nothing inferred.
// ============================================================
import { useState } from 'react';
import { Brain, AlertCircle, Network } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const statusTone = {
  ESTABLISHED: 'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  EMERGING:    'text-stage-testing bg-stage-testing/10 border-stage-testing/25',
  CONFLICTED:  'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
  SUPERSEDED:  'text-lumi-subtle bg-lumi-elevated border-lumi-border',
};

export function AccountBriefing({
  briefing, loading = false, error = null,
  onConsent, consentBusy = false, canManageConsent = false,
  onPromote, promotingId = null, promoteError = null, canPromote = false,
}) {
  const patterns = briefing?.patterns ?? [];
  const conflicts = briefing?.conflicts ?? [];
  const promotable = briefing?.promotableCount ?? 0;

  return (
    <section className="mt-10">
      <div className="section-label">What Lumi Knows About This Account</div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Truth-weighted patterns learned from this workspace — confidence reflects how often Lumi was right, not how often it guessed.
      </p>

      {loading ? (
        <div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading learnings…</div>
      ) : error ? (
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load account learnings.
        </div>
      ) : patterns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-8 text-center">
          <Brain className="w-10 h-10 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">No established patterns yet.</p>
          <p className="mt-1 text-lumi-muted text-sm">Lumi promotes a learning here once it has enough confirmed outcomes to trust it.</p>
        </div>
      ) : (
        <>
          {(promotable > 0 || conflicts.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-3 font-mono text-xs">
              {promotable > 0 && <span className="px-2 py-0.5 rounded bg-signal-scale-bg text-signal-scale border border-signal-scale/25">{promotable} promotable to a rule</span>}
              {conflicts.length > 0 && <span className="px-2 py-0.5 rounded bg-signal-kill-bg text-signal-kill border border-signal-kill/25">{conflicts.length} need review</span>}
            </div>
          )}
          {promoteError && (
            <p className="mb-3 text-xs text-signal-kill">
              {promoteError.message || 'Couldn’t promote that pattern to a rule right now. Try again shortly.'}
            </p>
          )}
          <ul className="grid gap-3">
            {patterns.map((p) => {
              const acc = Number.isFinite(p.accuracy) ? Math.round(p.accuracy * 100) : null;
              const conf = Number.isFinite(p.confidence) ? Math.round(p.confidence * 100) : null;
              return (
                <li key={p.id} className="bg-lumi-surface border border-lumi-border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-body text-sm text-lumi-text leading-relaxed flex-1">{p.statement}</p>
                    <span className={cn('font-mono text-xs uppercase tracking-wide px-2 py-0.5 rounded border flex-shrink-0', statusTone[p.status] || statusTone.SUPERSEDED)}>
                      {p.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-lumi-subtle">
                    {p.kind && <span>{p.kind.replace(/_/g, ' ')}</span>}
                    <span>right {acc == null ? '—' : `${acc}%`}</span>
                    {conf != null && <span>confidence {conf}%</span>}
                  </div>

                  {/* Promote → GuardrailRule. STRATEGIST-only, and only on a
                      pattern the engine marks promotable that isn't already a
                      rule. The new rule rides the existing confirm→execute
                      governance (never auto-executes). */}
                  {canPromote && p.promotable && !p.promotedRuleId && (
                    <div className="mt-2.5">
                      <button
                        type="button"
                        disabled={promotingId === p.id}
                        onClick={() => onPromote?.(p.id)}
                        className="font-mono text-xs uppercase tracking-wide px-3 py-1 rounded border border-signal-scale/30 bg-signal-scale-bg text-signal-scale disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {promotingId === p.id ? 'Promoting…' : 'Make it a rule'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <NetworkPanel
        network={briefing?.network}
        canManage={canManageConsent}
        onConsent={onConsent}
        busy={consentBusy}
      />
    </section>
  );
}

// ── Network Intelligence (Phase 4-F · gated cross-account layer) ──────────
// Renders the k-anonymity-gated cohort insights honestly: below the gate it
// says so (N of K accounts), never a fabricated "across the market…" claim.
// The opt-in CONTROL is STRATEGIST-only (canManage) — the consent write is
// the cross-tenant boundary; the read is safe by construction.
function NetworkPanel({ network, canManage = false, onConsent, busy = false }) {
  const [cohort, setCohort] = useState('');
  if (!network) return null;

  const consented = network.status === 'OK';
  const insights  = consented ? (network.insights ?? []) : [];
  const ok        = insights.filter((i) => i.status === 'OK' && i.statement);
  const pending   = insights.filter((i) => i.status === 'INSUFFICIENT_DATA');

  return (
    <section className="mt-8">
      <div className="section-label flex items-center gap-1.5">
        <Network className="w-3.5 h-3.5" strokeWidth={1.5} /> Network Intelligence
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Anonymized, k-anonymity-gated patterns across consenting accounts in your cohort — a pattern is shown only once enough distinct accounts share it, so none is ever identifiable.
      </p>

      {!consented ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6">
          <p className="font-body text-sm text-lumi-text">This account isn’t contributing to the anonymized network.</p>
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="Cohort tag"
                placeholder="cohort — e.g. EG-apparel"
                value={cohort}
                onChange={(e) => setCohort(e.target.value)}
                className="font-mono text-xs bg-lumi-elevated border border-lumi-border rounded px-2 py-1 text-lumi-text placeholder:text-lumi-subtle"
              />
              <button
                type="button"
                disabled={busy || cohort.trim() === ''}
                onClick={() => onConsent?.(true, cohort.trim())}
                className="font-mono text-xs uppercase tracking-wide px-3 py-1 rounded border border-signal-scale/30 bg-signal-scale-bg text-signal-scale disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Joining…' : 'Join network'}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-lumi-subtle text-xs">Only a strategist can opt this workspace into the network.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="font-mono text-xs text-lumi-subtle">
              Sharing as <span className="text-lumi-text">{network.cohortTag || '—'}</span>
            </span>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onConsent?.(false)}
                className="font-mono text-xs uppercase tracking-wide px-3 py-1 rounded border border-lumi-border text-lumi-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Leaving…' : 'Leave network'}
              </button>
            )}
          </div>

          {ok.length === 0 && pending.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6 text-center text-sm text-lumi-subtle">
              Network active — not enough of the cohort yet to surface a pattern.
            </div>
          ) : (
            <ul className="grid gap-2">
              {ok.map((i) => (
                <li key={`ok-${i.kind}-${i.metric}`} className="bg-lumi-surface border border-lumi-border rounded-xl p-4">
                  <p className="font-body text-sm text-lumi-text leading-relaxed">{i.statement}</p>
                </li>
              ))}
              {pending.map((i) => (
                <li key={`pend-${i.kind}-${i.metric}`} className="rounded-xl border border-dashed border-lumi-border p-3 font-mono text-xs text-lumi-subtle">
                  {i.kind ? `${i.kind.replace(/_/g, ' ').toLowerCase()}: ` : ''}
                  not enough of the network yet — {i.contributingWorkspaces ?? 0} of {i.needed ?? '?'} accounts.
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
