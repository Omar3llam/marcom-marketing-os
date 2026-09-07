// ============================================================
// THE A/B EXPERIMENT DETAIL — /app/testing/:id (B8-05)
// ------------------------------------------------------------
// `GET /api/lumi/tests/:id` shipped ahead of its consumer and said so in
// writing. This is the consumer. It buys ADDRESSABILITY, not new data — the
// list already includes the arms — and that is the whole point: one experiment
// a person can link to, return to, and open from outside a 100-row window.
//
// Sections, in order (R-N4's one grammar, same as /app/decisions/:id):
//   1  what was tested   the hypothesis, and the signal it expected
//   2  the arms          the evidence; an Experiment's evidence is its own
//                        row, never the Decision's (B7-04)
//   3  what it concluded only when it HAS concluded — no empty headings
//   4  what came of it   the Decision this produced, by its own id
//
// ── WHAT THIS SURFACE MAY NOT DO ────────────────────────────────────────────
// · No action controls. Start / conclude / promote are operator acts and they
//   live on the list, behind the role gate that governs them. A destination for
//   READING must not quietly become a second place to act.
// · No re-derived readout. A CONCLUDED test carries its persisted winner, lift
//   and label; recomputing any of them here would let this page and the list
//   disagree about the same experiment.
// · No confidence where none was measured (L-4) — see `confidenceRung`.
// ============================================================
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader, DetailSection, DetailRefusal, DetailBackLink } from '@/design-system/patterns/index.js';
import { absenceState } from '@/design-system/states/absence.js';
import { CONFIDENCE, confidenceRung, confidenceText } from '@/design-system/states/confidence.js';
import { appRoutes } from '@/app/routeManifest.js';
import { useTestDetail, knowledgeOfRefusal, DETAIL_REFUSAL } from '@/hooks/useExperimentDetail.js';

const STAMP_FMT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
});
const fmt = (d) => (d ? STAMP_FMT.format(d instanceof Date ? d : new Date(d)) : null);

// An unrecorded count is "—", never a coerced 0 that reads as a real zero-sample
// arm. The same rule TestingView holds itself to; one grammar means it is not
// re-litigated per surface.
const count = (n) => (Number.isFinite(n) ? n.toLocaleString() : '—');

const REFUSAL_COPY = {
  [DETAIL_REFUSAL.NOT_FOUND]: {
    heading: 'Lumi couldn’t find this experiment.',
    body: 'We couldn’t find it in this workspace. It may belong to another account, or the link may be incomplete.',
  },
  [DETAIL_REFUSAL.NOT_PERMITTED]: {
    heading: 'This experiment isn’t open to you.',
    body: 'Testing is part of the Pro plan. Upgrading unlocks the experiment log for this workspace.',
  },
  [DETAIL_REFUSAL.UNREADABLE]: {
    heading: 'Lumi couldn’t read this experiment.',
    body: 'This is a problem on our side, not a statement about the experiment.',
  },
};

/** The readout line. A band names itself; a finding says what it found. */
function Readout({ label }) {
  const rung = confidenceRung(label);
  // UNRECOGNISED claims nothing at all: contract drift is a fact about us, and
  // dressing it as a finding is what B8-04b removed one layer up.
  if (rung === CONFIDENCE.UNRECOGNISED) return null;
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-lumi-muted">
      {confidenceText(rung)}
    </span>
  );
}

export default function TestDetailView() {
  const { id } = useParams();
  const { test, refusal, isLoading } = useTestDetail(id);

  if (isLoading) {
    return (
      <div className="max-w-3xl flex items-center gap-2 text-sm text-lumi-muted py-10">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" /> Loading experiment…
      </div>
    );
  }

  if (!test) {
    const copy = REFUSAL_COPY[refusal] ?? REFUSAL_COPY[DETAIL_REFUSAL.UNREADABLE];
    return (
      <div className="max-w-3xl">
        <DetailRefusal
          state={absenceState({ knowledge: knowledgeOfRefusal(refusal), reason: 'PLAN_REQUIRED' })}
          heading={copy.heading}
          body={copy.body}
          backTo={appRoutes.testing}
          backLabel="Back to testing"
        />
      </div>
    );
  }

  const concluded = test.status === 'CONCLUDED';
  const variants = Array.isArray(test.variants) ? test.variants : [];

  return (
    <div className="max-w-3xl">
      <DetailBackLink to={appRoutes.testing}>Testing</DetailBackLink>

      {/* 1 — WHAT WAS TESTED. Opens with the claim, not with an instrument. */}
      <PageHeader
        className="mt-4"
        eyebrow="Experiment"
        title={test.hypothesis}
        description={test.expectedSignal}
        meta={
          <div className="flex flex-wrap items-center gap-3 text-xs text-lumi-muted">
            <span className="font-mono uppercase tracking-[0.08em]">{test.dimension} · {test.metric}</span>
            <span className="font-mono uppercase tracking-[0.08em]">{test.status}</span>
            {test.startedAt && <span>Started {fmt(test.startedAt)}</span>}
            {test.concludedAt && <span>Concluded {fmt(test.concludedAt)}</span>}
          </div>
        }
      />

      {/* 2 — THE ARMS. The evidence lives here, on the experiment's own row. */}
      <DetailSection title="How the arms performed">
        {variants.length > 0 ? (
          <ul className="divide-y divide-lumi-border rounded-xl border border-lumi-border">
            {variants.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-3 p-4">
                <span className="text-sm text-lumi-text">
                  {v.label}
                  {v.isControl && <span className="text-lumi-subtle"> (control)</span>}
                  {v.isWinner && <span className="text-signal-scale"> · winner</span>}
                </span>
                <span className="font-mono text-xs tabular-nums text-lumi-muted">
                  {count(v.impressions)} impressions · {count(v.clicks)} clicks · {count(v.conversions)} conversions
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </DetailSection>

      {/* 3 — WHAT IT CONCLUDED. Absent entirely until there is a conclusion. */}
      <DetailSection title={concluded ? 'What it concluded' : null}>
        {concluded ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
              {test.winnerLabel
                ? <span className="text-sm text-lumi-text">Winner: <strong>{test.winnerLabel}</strong></span>
                : <span className="text-sm text-lumi-muted">No winner was called.</span>}
              {Number.isFinite(test.lift) && (
                <span className="font-mono text-sm text-signal-scale">+{test.lift}% {test.metric}</span>
              )}
              <Readout label={test.confidenceLabel} />
            </div>
            {test.sampleNote && <p className="font-mono text-xs text-lumi-subtle">{test.sampleNote}</p>}
          </div>
        ) : null}
      </DetailSection>

      {/* 4 — WHAT CAME OF IT. The id is in hand, so it names the decision
          itself — never a page that may or may not still be holding it. */}
      <DetailSection title={test.decisionId ? 'What came of it' : null}>
        {test.decisionId ? (
          <Link
            to={`${appRoutes.decisions}/${test.decisionId}`}
            className="text-sm font-medium text-lumi-accent hover:underline"
          >
            Read the decision this experiment produced →
          </Link>
        ) : null}
      </DetailSection>
    </div>
  );
}
