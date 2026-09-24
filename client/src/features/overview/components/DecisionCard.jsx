// ============================================================
// MARCOM / Lumi — DecisionCard (Home · one decision in the feed)
// ------------------------------------------------------------
// One campaign that needs a call, with its evidence and — for the verdicts that
// ask for an intervention — the ad set to open first, fetched on demand.
//
// Explicit props rather than one `item` blob, deliberately. The agenda item
// (`agenticTypes.agendaItem`) carries { id, band, type, title, severity,
// rationale, humanAction, entityId, impactScore } and NO verdict, name, ctr,
// spendMinor or currency. A card that read `item.verdict` would silently render
// nothing forever. Naming what it needs makes the join the caller's job, and a
// missing field a visible one.
//
// Read + navigate only. Nothing here executes; the deep link hands off to the
// Campaigns page that owns the full context.
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';
import { isKnownCurrency, isKnownMinorAmount } from '@/lib/monetaryCurrency.js';
import { appRoutes } from '@/app/routeManifest.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { useEvidence, evidenceKey } from '@/hooks/useEvidence.js';
import { ExecutionContext } from '@/features/campaigns/ExecutionContext.jsx';
import { EvidenceState } from '@/features/campaigns/EvidenceState.jsx';
import { ACTIONABLE_VERDICTS } from '@/features/campaigns/executionContext.js';
import { useDecisionAction } from '@/features/campaigns/useDecisionAction.js';
import { useDecisionJudgment, judgmentFrom } from '@/features/campaigns/useDecisionJudgment.js';
import { DecisionJudgment } from '@/features/campaigns/DecisionJudgment.jsx';

export default function DecisionCard({
  entityId, name, verdict,
  rationale = null, impactScore = null, humanAction = null,
  ctr = null, spendMinor = null, currency = null,
  // R13-b — the STORED decision behind this card, threaded from the verdict
  // payload through decisionFeed. Explicit props like everything else here: an
  // agenda item carries none of these, and a card that read them off an `item`
  // blob would silently render nothing forever.
  //
  // decisionId null ⇒ no judgement UI. Deliberately NOT resolved from entityId:
  // "the newest decision for this campaign" is a query, and attaching an
  // operator's reasoning to whatever it resolves to would credit them with
  // judging a call they never saw.
  decisionId = null,
  humanResponse = null, humanReasonCode = null,
  humanReasonNote = null, humanRespondedAt = null,
}) {
  // ONE fetch behind the expansion. useEntityDrillDown used to run beside this
  // one to feed ExecutionContext's ad-set rows; now that the ranking is the
  // server's, its result was displayed nowhere — and its "Loading ad sets…" and
  // "Couldn't load ad sets" messages narrated a request that no longer decides
  // anything on this card. A spinner for work the user never sees, and a failure
  // banner over a panel that rendered fine.
  const {
    byId: evidenceById, loading: evidenceLoading, errors: evidenceErrors, load: loadEvidence,
  } = useEvidence();
  const { states: actionStates, execute, dismiss } = useDecisionAction();
  // One instance per card here, unlike the campaigns table: each card is its own
  // decision and there is no shared list to key across. The hook is still keyed
  // by decisionId internally, so the shape is identical on both surfaces.
  const {
    states: judgmentStates, recorded: judgmentRecorded,
    messages: judgmentMessages, submit: submitJudgment,
  } = useDecisionJudgment();
  const [expanded, setExpanded] = useState(false);

  // The same verdicts ExecutionContext itself acts on — imported rather than
  // re-listed, so the button and the panel can never disagree about which
  // decisions have somewhere to drill into.
  const canDrill = ACTIONABLE_VERDICTS.includes(verdict);

  // The server's answer to "is one ad set measurably dragging" — and, since it
  // carries the ranking itself, the panel's only substrate. A request failure
  // and an engine refusal stay in separate slots: one is retryable and ours,
  // the other is a real answer about a campaign whose ad sets perform alike.
  const evKey = evidenceKey(entityId);
  const ev = evidenceById[evKey];
  const evLoading = evidenceLoading[evKey];
  const evError = evidenceErrors[evKey];

  const toggle = () => {
    if (!expanded) loadEvidence(entityId); // idempotent + cached inside the hook
    setExpanded((e) => !e);
  };

  // ExecutionContext reads a campaign row, not an agenda item. Only the four
  // fields it actually uses are passed; each is null-when-absent, and it renders
  // nothing at all without a real campaign CTR to measure against.
  const campaign = { entityId, ctr, spendMinor, currency };

  return (
    <div className="rounded-xl border border-lumi-border bg-lumi-surface p-4">
      {/* Verdict + impact */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <VerdictPill verdict={verdict} size="md" />
        {impactScore != null && (
          <span
            className="section-label flex-shrink-0 text-lumi-muted"
            title={`Impact ${impactScore}/10 — priority to act`}
          >
            Impact {impactScore}/10
          </span>
        )}
      </div>

      {/* Campaign + what it has cost. The spend was already being passed in for
          ExecutionContext but never shown, so the card asked for a decision
          without saying how much was riding on it. spendMinor is MINOR units —
          formatCurrency (money.ts) is the matching formatter; the hero's
          formatCurrencyWhole takes MAJOR and would be 100x wrong here. */}
      <div className="mb-2">
        <p className="font-display text-sm font-semibold text-lumi-text">{name || 'Unnamed campaign'}</p>
        {isKnownMinorAmount(spendMinor) && isKnownCurrency(currency) && (
          <p className="section-label mt-0.5 text-lumi-muted">
            {formatCurrency(spendMinor, currency)} spent
          </p>
        )}
      </div>

      {/* Why */}
      {rationale && <p className="mb-3 text-xs leading-relaxed text-lumi-muted">{rationale}</p>}

      {/* What to do about it */}
      {humanAction && (
        <div className="mb-3">
          <p className="section-label mb-0.5 text-lumi-muted">Do this</p>
          <p className="text-xs text-lumi-text">{humanAction}</p>
        </div>
      )}

      {canDrill && (
        <div className="mt-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="flex items-center gap-1 font-mono text-[11px] text-lumi-muted transition-colors hover:text-lumi-text"
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform duration-200', expanded && 'rotate-90 text-lumi-accent')}
            />
            {expanded ? 'Hide execution context' : 'Show execution context'}
          </button>

          {/* Honest intermediate states: the panel itself renders nothing when
              the data cannot support a pick, which is indistinguishable from
              "still loading" unless we say so. */}
          {expanded && evLoading && (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> Loading execution context…
            </p>
          )}
          {/* The request failed (red, retryable) vs the engine declined to rank
              (subtle, and a real answer) — EvidenceState keeps those apart, and
              renders nothing at all once a ranking came back. */}
          {expanded && !evLoading && (
            <EvidenceState
              loading={false}
              error={evError}
              reasonKey={ev?.insufficientData ? ev.reasonKey : null}
              className="mt-2"
            />
          )}
          {expanded && ev?.evidence && (
            <ExecutionContext
              campaign={campaign}
              evidence={ev.evidence}
              verdict={verdict}
              onExecute={() => execute(entityId)}
              onDismiss={() => dismiss(entityId)}
              executionState={actionStates[entityId] ?? null}
            />
          )}
        </div>
      )}

      {/* ── R13-b · what the HUMAN decided ────────────────────────────────
          Below the verdict, the spend, the rationale and the suggested step —
          so the question follows the case for it. Outside the `canDrill`
          expansion on purpose: the execution context is an ad-set ranking the
          server may decline to produce, and gating the judgement on it would
          remove the question from a verdict that was perfectly answerable. The
          Campaigns page already made exactly that mistake once. */}
      <DecisionJudgment
        decisionId={decisionId}
        judgment={
          judgmentRecorded[decisionId]
          ?? judgmentFrom({ humanResponse, humanReasonCode, humanReasonNote, humanRespondedAt })
        }
        state={judgmentStates[decisionId] ?? null}
        message={judgmentMessages[decisionId] ?? null}
        onSubmit={(j) => submitJudgment(decisionId, j)}
      />

      <Link
        to={`${appRoutes.campaigns}?entity=${encodeURIComponent(entityId)}`}
        className="section-label mt-3 inline-block text-lumi-muted underline transition-colors hover:text-lumi-text"
      >
        View in Decision Queue →
      </Link>
    </div>
  );
}
