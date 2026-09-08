// ============================================================
// MARCOM / Lumi — AccountBriefing  ("What Lumi knows about this account")
// ------------------------------------------------------------
// Surfaces GET /api/lumi/briefing (Phase 5 Memory Moat) — the workspace's
// learned, truth-weighted AccountPatterns. Every field traces to an
// AccountPattern row: statement, status (EMERGING/ESTABLISHED/…), accuracy
// ("was Lumi right?", null until outcomes are known → "—"), confidence.
// Validated against BriefingSchema in useAccountBriefing; nothing inferred.
// ============================================================
import { Brain, AlertCircle, Network } from 'lucide-react';
import { KNOWLEDGE_VALUES } from '@marcom/runtime-contracts';
import { cn } from '@/lib/utils.js';
import { ABSENCE, absenceState } from '@/design-system/states/absence.js';

/**
 * B8-04b — a belief's dates at MONTH resolution.
 *
 * A pattern is observed over months, so a to-the-minute timestamp would imply a
 * precision the belief does not have. Returns null for anything unparseable
 * rather than a fabricated date.
 */
/**
 * B8-04b — the STATE of a field that ships a C-06 knowledge token beside its
 * value, or null when no token arrived.
 *
 * The token decides, never the shape of the value. Measured on the writer
 * (`patternHistory.js`), the shape genuinely cannot decide:
 *
 *   checks  NOTHING_THERE  { made: 0,    held: 0    }   ← isFinite(0) is TRUE
 *           COULD_NOT_LOOK { made: null, held: null }
 *
 * so a `Number.isFinite` guard renders "held 0 of 0" for a belief that was
 * never checked — the exact claim the schema comment forbids. And for
 * `replacedBy` both absences carry `value: null`, so a shape check collapses
 * "we could not look" into "nothing replaced it".
 *
 * Returns null — not a state — when the field is absent or its token is
 * unrecognised. That is contract drift, and inventing a state for it would be
 * the presentation layer originating an absence, which B8-02 forbids.
 */
function stateOfField(field) {
  const token = field?.knowledge;
  return KNOWLEDGE_VALUES.includes(token) ? absenceState({ knowledge: token }) : null;
}

// Built ONCE. `Intl.DateTimeFormat` is expensive to construct and this runs per
// belief, per render.
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

function monthYear(d) {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : MONTH_FMT.format(date);
}

const statusTone = {
  ESTABLISHED: 'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  EMERGING:    'text-stage-testing bg-stage-testing/10 border-stage-testing/25',
  CONFLICTED:  'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
  SUPERSEDED:  'text-lumi-subtle bg-lumi-elevated border-lumi-border',
};

export function AccountBriefing({
  briefing, loading = false, error = null,
  onConsent, consentBusy = false, canManageConsent = false,
  // C-05 · promotion is an authorization with two ends and a way back.
  // `pendingRequestId` maps a pattern id to the authorization filed for it in
  // this session — the grant is a second, deliberate act, never a side effect
  // of the first click.
  onRequestPromotion, onGrantPromotion, onRevokePromotion,
  pendingRequestId = {}, promotingId = null, promoteError = null, canPromote = false,
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
              {promoteError.response?.data?.message
                || promoteError.message
                || 'Couldn’t change this rule’s authority right now. Try again shortly.'}
            </p>
          )}
          <ul className="grid gap-3">
            {patterns.map((p) => {
              const acc = Number.isFinite(p.accuracy) ? Math.round(p.accuracy * 100) : null;
              const conf = Number.isFinite(p.confidence) ? Math.round(p.confidence * 100) : null;
              // B8-04b — the token decides, not the value's shape. See stateOfField.
              const checksState = stateOfField(p.checks);
              const replacedState = stateOfField(p.replacedBy);
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
                    {/* B8-04b · HOW OFTEN TESTED — C-14's denominator, stated
                        BESIDE accuracy and never as its derivation. Accuracy is
                        recency-weighted, so "85%" and "held 3 of 5" are two true
                        facts about one belief, not an arithmetic error. They are
                        deliberately separate items, with no connective between
                        them that would imply one is the working of the other.

                        The TOKEN decides which of the three answers this is —
                        the counts cannot, because NOTHING_THERE ships 0 and 0. */}
                    {checksState === ABSENCE.PRESENT && (
                      <span>held {p.checks.held} of {p.checks.made}</span>
                    )}
                    {/* A FINDING: the belief exists and no outcome has met it
                        yet. Stated, because "held 0 of 0" would read as "we
                        checked five times and it never held". */}
                    {checksState === ABSENCE.NOTHING_FOUND && (
                      <span>not yet checked against an outcome</span>
                    )}
                    {/* We could not read the count. A different fact from the
                        one above, and the only one where a retry is honest. */}
                    {checksState === ABSENCE.NOT_REACHABLE && (
                      <span>check count unavailable</span>
                    )}
                    {conf != null && <span>confidence {conf}%</span>}
                    {/* B8-04b · SINCE WHEN, and WHEN LAST TESTED. Omitted rather
                        than invented when the row does not carry them. */}
                    {p.firstObservedAt && <span>since {monthYear(p.firstObservedAt)}</span>}
                    {p.lastObservedAt && <span>last tested {monthYear(p.lastObservedAt)}</span>}
                  </div>

                  {/* B8-04b · WHAT IT REPLACED — C-14's FORWARD edge. The row
                      carrying `supersededById` is the SUPERSEDED one and points
                      at the winner, so this reads "replaced by", never
                      "supersedes". Resolved to a statement because an id is not
                      readable, and shown only when something actually replaced
                      it: `NOTHING_THERE` is a finding, and printing "replaced by
                      nothing" would turn an answer into a blank. */}
                  {replacedState === ABSENCE.PRESENT && p.replacedBy.value?.statement && (
                    <p className="mt-2 text-xs text-lumi-muted">
                      Replaced by: <span className="text-lumi-text">{p.replacedBy.value.statement}</span>
                    </p>
                  )}
                  {/* THE ASYMMETRY, and it is deliberate. For NOTHING_FOUND
                      silence IS the answer: most beliefs were never superseded,
                      and printing "nothing replaced this" on every row is noise.
                      Silence may NOT stand for NOT_REACHABLE, because there it
                      would assert the very finding we failed to establish. */}
                  {replacedState === ABSENCE.NOT_REACHABLE && (
                    <p className="mt-2 text-xs text-lumi-subtle">
                      Couldn’t check whether anything replaced this.
                    </p>
                  )}

                  {/* C-05 · granting Lumi standing authority takes two acts.
                      The first files the authorization; the second grants it,
                      and only that one creates the rule. Both are STRATEGIST-
                      only, and the rule that results still writes PROPOSED
                      decisions — it judges and raises, it never acts. */}
                  {canPromote && p.promotable && !p.promotedRuleId && !pendingRequestId[p.id] && (
                    <div className="mt-2.5">
                      <button
                        type="button"
                        disabled={promotingId === p.id}
                        onClick={() => onRequestPromotion?.(p.id)}
                        className="font-mono text-xs uppercase tracking-wide px-3 py-1 rounded border border-signal-scale/30 bg-signal-scale-bg text-signal-scale disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {promotingId === p.id ? 'Requesting…' : 'Propose as a rule'}
                      </button>
                    </div>
                  )}

                  {canPromote && !p.promotedRuleId && pendingRequestId[p.id] && (
                    <div className="mt-2.5">
                      <p className="mb-1.5 text-xs text-lumi-muted">
                        Granting this lets Lumi judge the account on it from now on and raise
                        proposals without being asked again. It never acts on its own.
                      </p>
                      <button
                        type="button"
                        disabled={promotingId === pendingRequestId[p.id]}
                        onClick={() => onGrantPromotion?.(p.id, pendingRequestId[p.id])}
                        className="font-mono text-xs uppercase tracking-wide px-3 py-1 rounded border border-signal-scale/30 bg-signal-scale-bg text-signal-scale disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {promotingId === pendingRequestId[p.id] ? 'Granting…' : 'Grant this authority'}
                      </button>
                    </div>
                  )}

                  {/* R-14 · the way back. Revoking stops future evaluation; it
                      does not claim the breaches it was holding were resolved,
                      and it does not erase the grant. */}
                  {canPromote && p.promotedRuleId && (
                    <div className="mt-2.5">
                      <button
                        type="button"
                        disabled={promotingId === p.promotedRuleId}
                        onClick={() => onRevokePromotion?.(p.promotedRuleId)}
                        className="font-mono text-xs uppercase tracking-wide px-3 py-1 rounded border border-lumi-border bg-lumi-elevated text-lumi-muted disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {promotingId === p.promotedRuleId ? 'Revoking…' : 'Revoke this authority'}
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
  if (!network) return null;

  // ACROSS Tier 1 — THREE states, not a boolean. This was
  //
  //     const consented = network.status === 'OK';
  //
  // which sent UNAVAILABLE down the NOT_CONSENTED branch: an account that HAD
  // opted in was told it had not, and offered a button to do what it already
  // did. The server refuses to make exactly that collapse — NetworkService.js:
  // "reporting NOT_CONSENTED here would tell an account that opted in that it
  // had not" — and publishes UNAVAILABLE, plus a C-06 token, so the client need
  // not guess. The client guessed anyway, from an enum missing the value.
  //
  // Only one of the three is the operator's to act on, so only one has a
  // button. UNAVAILABLE is ours to fix, and we do not know the standing we
  // failed to read — offering "Join" would repeat the original lie and "Leave"
  // would be its mirror.
  const consented   = network.status === 'OK';
  const unreadable  = network.status === 'UNAVAILABLE';
  const insights    = consented ? (network.insights ?? []) : [];
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

      {unreadable ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6">
          <p className="font-body text-sm text-lumi-text">Lumi couldn’t read the network for this account.</p>
          <p className="mt-1 text-lumi-subtle text-xs">
            This isn’t a consent setting, and your participation is unchanged — it’s ours to fix.
          </p>
        </div>
      ) : !consented ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6">
          <p className="font-body text-sm text-lumi-text">This account isn’t contributing to the anonymized network.</p>
          <p className="mt-1 text-lumi-subtle text-xs">Your cohort is assigned automatically from your connected account — it isn’t something you pick.</p>
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onConsent?.(true)}
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
