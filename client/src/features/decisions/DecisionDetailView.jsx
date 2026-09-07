// ============================================================
// THE DECISION DETAIL — /app/decisions/:id (C-11, B8-03, B8-04)
// ------------------------------------------------------------
// > The destination COMPLETES a loop and never pretends it is more complete
// > than the rows prove. Sequence is fixed; sections are not a visual
// > obligation — a section with no fact does not appear under an empty heading.
//
// Sections, in order:
//   1  the call            what Lumi decided, and how sure it was
//   2  why it was credible CLASS-FILLED: Signal reasons, Guardrail names a rule
//   3  what memory said    the measurement taken AT COMMITMENT (R-6, C-16)
//   4  did a human look    explainedAt / intentAt — adoption is not action
//   5  how it closed       the closure axes, and the human's own judgment
//
// ── WHAT THIS SURFACE MAY NOT DO ────────────────────────────────────────────
// · No confidence figure on a GUARDRAIL (L-4) — 0.9 is a constant, and a
//   constant rendered as a percentage is a measurement Lumi never made.
// · No action controls. Five transitions are modelled and only ONE changes the
//   world (`POST /api/execute/meta`, META + KILL only); the rest are a human
//   RECORDING a claim. A generic Execute button here would imply Lumi acts.
// · No live recomputation. This page's spine is the COMMITTED row (R-1); a
//   "what is true now" block belongs to the campaign lens, in its own tense.
// · No empty headings. A section whose facts are all CANNOT_ASK does not appear
//   — the class genuinely has no such evidence, and an empty box would imply a
//   gap where there is none.
// ============================================================
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader, DetailSection, DetailRefusal, DetailBackLink } from '@/design-system/patterns/index.js';
import { ABSENCE, absenceState } from '@/design-system/states/absence.js';
import { appRoutes } from '@/app/routeManifest.js';
import { useDecisionDetail, knowledgeOfRefusal, DETAIL_REFUSAL } from '@/hooks/useDecisionDetail.js';

// Built ONCE — constructing an Intl formatter per timestamp, per render, is
// pure waste on a page that prints eight of them.
const STAMP_FMT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const fmt = (d) => (d ? STAMP_FMT.format(d instanceof Date ? d : new Date(d)) : null);

const CLASS_LABEL = { SIGNAL: 'Signal', GUARDRAIL: 'Guardrail', EXPERIMENT: 'Experiment' };

/** PURE: is this committed field worth rendering at all? */
const stated = (f) => f && f.knowledge === 'KNOWN';

// B8-05 — `Section` and the refusal block moved to design-system/patterns as
// `DetailSection` / `DetailRefusal` when the experiment surfaces became the
// second and third by-id destination. R-N4 says ONE detail grammar; two copies
// of a grammar is how two halves of one class drift apart (C-13). The words
// stay here, because only this surface knows what it failed to open.
function Refused({ refusal }) {
  const state = absenceState({
    knowledge: knowledgeOfRefusal(refusal),
    // NOT_DESTINATION is "the question does not apply", never "you are not
    // entitled" — R-3 is a fact about the row, not about the reader.
    reason: 'NOT_APPLICABLE',
  });
  const notADestination = state === ABSENCE.NOT_SUPPORTED;

  return (
    <DetailRefusal
      state={state}
      heading={notADestination
        ? 'This row isn’t a decision you can open.'
        : 'Lumi couldn’t read this decision.'}
      body={notADestination
        ? 'It’s a plan artifact rather than a decision — budget moves live with the plan that proposed them, not in decision history.'
        : refusal === DETAIL_REFUSAL.NOT_FOUND
          ? 'We couldn’t find it in this workspace. It may have been from another account, or the link may be incomplete.'
          : 'This is a problem on our side, not a statement about the decision.'}
      backTo={appRoutes.decisions}
      backLabel="Back to decisions"
    />
  );
}

export default function DecisionDetailView() {
  const { id } = useParams();
  const { decision, refusal, isLoading } = useDecisionDetail(id);

  if (isLoading) {
    return (
      <div className="max-w-3xl flex items-center gap-2 text-sm text-lumi-muted py-10">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> Loading decision…
      </div>
    );
  }
  if (!decision) return <div className="max-w-3xl"><Refused refusal={refusal} /></div>;

  const d = decision;
  const isSignal = d.decisionClass === 'SIGNAL';
  // L-4 — a measurement only where it IS one.
  const showsConfidence = isSignal && Number.isFinite(d.confidence);
  const hypotheses = stated(d.committed.hypotheses) ? d.committed.hypotheses.value : null;
  const counterfactuals = stated(d.committed.counterfactuals) ? d.committed.counterfactuals.value : null;

  return (
    <div className="max-w-3xl">
      <DetailBackLink to={appRoutes.decisions}>Decisions</DetailBackLink>

      {/* 1 — THE CALL. Opens with the verdict, not with an instrument (B8-01). */}
      <PageHeader
        className="mt-4"
        eyebrow={CLASS_LABEL[d.decisionClass] ?? 'Decision'}
        title={d.verdict}
        description={d.diagnosis}
        meta={
          <div className="flex flex-wrap items-center gap-3 text-xs text-lumi-muted">
            <span>Decided {fmt(d.decidedAt)}</span>
            {showsConfidence && (
              <span className="tabular-nums">{Math.round(d.confidence * 100)}% confidence</span>
            )}
          </div>
        }
      />

      {/* 2 — WHY IT WAS CREDIBLE. One slot, filled differently by each class. */}
      <DetailSection title="Why Lumi believed it">
        {isSignal && (hypotheses?.length || counterfactuals?.length) ? (
          <div className="space-y-4">
            {hypotheses?.length > 0 && (
              <div>
                <p className="text-xs text-lumi-subtle mb-1">What it considered</p>
                <ul className="list-disc pl-5 text-sm text-lumi-muted space-y-1">
                  {hypotheses.map((h, i) => (
                    <li key={h?.id ?? h?.statement ?? i}>{h?.statement ?? String(h)}</li>
                  ))}
                </ul>
              </div>
            )}
            {counterfactuals?.length > 0 && (
              <div>
                {/* The best asset in the product, unread until now: how strong
                    the thing SET ASIDE was is the whole question. */}
                <p className="text-xs text-lumi-subtle mb-1">What it set aside</p>
                <ul className="list-disc pl-5 text-sm text-lumi-muted space-y-1">
                  {counterfactuals.map((c, i) => (
                    <li key={c?.id ?? c?.statement ?? i}>
                      {c?.statement ?? String(c)}
                      {c?.preferredBecause && <span className="text-lumi-subtle"> — {c.preferredBecause}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : d.decisionClass === 'GUARDRAIL' && d.guardrailRuleId ? (
          // No percentage here, deliberately: the sweep records WHAT IT JUDGED
          // and reaches no verdict of its own.
          <p className="text-sm text-lumi-muted">
            A guardrail rule was breached. This is a rule firing, not a scored judgement.
          </p>
        ) : null}
      </DetailSection>

      {/* 3 — WHAT MEMORY SAID, measured at commitment (R-6, C-16, B8-01). */}
      <DetailSection title="What Lumi knew at the time">
        {d.memoryStatus === 'NOT_CONSULTED' ? (
          <p className="text-sm text-lumi-muted">
            Memory wasn’t consulted for this call.
          </p>
        ) : d.memoryProvenance ? (
          <div className="space-y-2">
            {Number.isFinite(d.baseConfidence) && Number.isFinite(d.confidence) && (
              <p className="text-sm text-lumi-muted tabular-nums">
                Past patterns moved this call from {Math.round(d.baseConfidence * 100)}%
                {' '}to {Math.round(d.confidence * 100)}% confidence.
              </p>
            )}
            {d.memoryProvenance.patterns?.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-lumi-muted space-y-1">
                {d.memoryProvenance.patterns.map((p, i) => (
                  <li key={p?.patternId ?? i}>
                    {p?.statement}
                    {Number.isFinite(p?.accuracy) && (
                      <span className="text-lumi-subtle tabular-nums">
                        {' '}— right {Math.round(p.accuracy * 100)}% of the time
                        {Number.isFinite(p?.effectiveSupport) && ` across ${p.effectiveSupport} cases`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {/* R-5 — this is what memory said THEN. It is not what Memory says
                now, and the two are never reconciled. */}
            <p className="text-xs text-lumi-subtle">
              Recorded when the decision was made. Memory may say something different today.
            </p>
          </div>
        ) : null}
      </DetailSection>

      {/* 4 — DID A HUMAN LOOK. Adoption is NOT action; the gap between them is
          how long the operator took to not act, which is a fact worth seeing. */}
      <DetailSection title="Did anyone look">
        {d.explainedAt || d.intentAt ? (
          <ul className="text-sm text-lumi-muted space-y-1">
            {d.explainedAt && <li>Reviewed {fmt(d.explainedAt)}</li>}
            {d.intentAt && <li>Carried into a plan {fmt(d.intentAt)}</li>}
          </ul>
        ) : (
          <p className="text-sm text-lumi-muted">Nobody has opened this decision yet.</p>
        )}
      </DetailSection>

      {/* 5 — HOW IT CLOSED. "Lumi did this" and "I did this" must be
          unmistakable (invariant 9), so they are separate lines with separate
          subjects, never one merged "executed". */}
      <DetailSection title="How it closed">
        {d.platformExecutedAt || d.humanExecutedAt || d.dismissedAt || d.resolvedAt || d.humanResponse ? (
          <ul className="text-sm text-lumi-muted space-y-1">
            {d.platformExecutedAt && <li>Lumi carried it out on the platform — {fmt(d.platformExecutedAt)}</li>}
            {d.humanExecutedAt && <li>You recorded that you did it — {fmt(d.humanExecutedAt)}</li>}
            {d.dismissedAt && <li>You dismissed it — {fmt(d.dismissedAt)}</li>}
            {d.resolvedAt && <li>The condition ended on its own — {fmt(d.resolvedAt)}</li>}
            {d.humanResponse && (
              <li>
                Your judgement: {d.humanResponse}
                {d.humanReasonCode && ` (${d.humanReasonCode})`}
                {d.humanReasonNote && <span className="text-lumi-subtle"> — {d.humanReasonNote}</span>}
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-lumi-muted">Still open.</p>
        )}
      </DetailSection>
    </div>
  );
}
