// ============================================================
// THE HOLDOUT DETAIL — /app/measure/:id (B8-05)
// ------------------------------------------------------------
// `GET /api/lumi/incrementality/:id` has existed since Phase 7C for a
// middleware's benefit — "GET so the tier-gate middleware also has a route to
// attach to" — with no caller and no test of any kind. This is the reader it
// never had.
//
// Sections, in order (R-N4's one grammar, same as /app/testing/:id):
//   1  how it was designed  the power calc that set the arms
//   2  what was observed    R-E3 — status decides, not the counter
//   3  what it concluded    lift WITH its interval, only once concluded
//   4  where it came from   the A/B test it was promoted from, if any
//   5  what came of it      the Decision this produced, by its own id
//
// ── R-E3, THE RULE THIS SURFACE EXISTS TO HOLD ──────────────────────────────
// `exposedUsers` and its three siblings are `Int @default(0)`, NOT NULL. The
// wire ALWAYS sends a number, so the counter can never tell you whether anybody
// recorded anything — "we measured zero" and "nobody has entered results" are
// the same four bytes. `status` can tell you, and already does: `recordCounts`
// is what moves a holdout DESIGNED → RUNNING.
//
// This is B8-04b's law one layer down. When a VALUE cannot decide an absence,
// something else must — and that something must already be measured, not
// invented for the occasion.
// ============================================================
import { useParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader, DetailSection, DetailRefusal, DetailBackLink } from '@/design-system/patterns/index.js';
import { ABSENCE, absenceState } from '@/design-system/states/absence.js';
import { CONFIDENCE, confidenceRung, confidenceText } from '@/design-system/states/confidence.js';
import { appRoutes } from '@/app/routeManifest.js';
import { useHoldoutDetail, knowledgeOfRefusal, DETAIL_REFUSAL } from '@/hooks/useExperimentDetail.js';

const STAMP_FMT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
});
const fmt = (d) => (d ? STAMP_FMT.format(d instanceof Date ? d : new Date(d)) : null);

const num = (n) => (Number.isFinite(n) ? n.toLocaleString() : '—');
const pct = (n) => (Number.isFinite(n) ? `${n}%` : '—');

// Both 403s are NOT_PERMITTED; they are not the same instruction. C-07.
const ENTITLEMENT_COPY = {
  NOT_PERMITTED: {
    heading: 'This holdout cannot be accessed.',
    body: 'Access to this holdout was refused for this request.',
  },
  PLAN_REQUIRED: {
    heading: 'This holdout isn’t open to you.',
    body: 'Measurement is part of the Pro plan. Upgrading unlocks holdout testing for this workspace.',
  },
  NOT_ENTITLED: {
    heading: 'Measurement isn’t enabled for this workspace.',
    body: 'Holdout testing is Agency and Enterprise depth, and it is a separate setting from your plan. Your workspace admin can enable it.',
  },
};

const REFUSAL_COPY = {
  [DETAIL_REFUSAL.NOT_FOUND]: {
    heading: 'Lumi couldn’t find this holdout.',
    body: 'We couldn’t find it in this workspace. It may belong to another account, or the link may be incomplete.',
  },
  [DETAIL_REFUSAL.UNREADABLE]: {
    heading: 'Lumi couldn’t read this holdout.',
    body: 'This is a problem on our side, not a statement about the holdout.',
  },
};

function Readout({ label }) {
  const rung = confidenceRung(label);
  if (rung === CONFIDENCE.UNRECOGNISED) return null;
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-lumi-muted">
      {confidenceText(rung)}
    </span>
  );
}

export default function HoldoutDetailView() {
  const { id } = useParams();
  const { test, refusal, reason, isLoading } = useHoldoutDetail(id);

  if (isLoading) {
    return (
      <div className="max-w-3xl flex items-center gap-2 text-sm text-lumi-muted py-10">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" /> Loading holdout…
      </div>
    );
  }

  if (!test) {
    const copy = refusal === DETAIL_REFUSAL.NOT_PERMITTED
      ? (ENTITLEMENT_COPY[reason] ?? ENTITLEMENT_COPY.NOT_PERMITTED)
      : (REFUSAL_COPY[refusal] ?? REFUSAL_COPY[DETAIL_REFUSAL.UNREADABLE]);
    return (
      <div className="max-w-3xl">
        <DetailRefusal
          state={refusal === DETAIL_REFUSAL.NOT_PERMITTED ? ABSENCE.NOT_PERMITTED
            : absenceState({ knowledge: knowledgeOfRefusal(refusal), reason: reason ?? 'NOT_APPLICABLE' })}
          heading={copy.heading}
          body={copy.body}
          backTo={appRoutes.measure}
          backLabel="Back to measurement"
        />
      </div>
    );
  }

  // R-E3 — the ONE inference this surface makes, and it reads status, not a value.
  const recorded = test.status !== 'DESIGNED';
  const concluded = test.status === 'CONCLUDED';
  const src = test.sourceTest;

  return (
    <div className="max-w-3xl">
      <DetailBackLink to={appRoutes.measure}>Measurement</DetailBackLink>

      <PageHeader
        className="mt-4"
        eyebrow="Holdout"
        title={test.name}
        description={`A holdout on ${test.channel}.`}
        meta={
          <div className="flex flex-wrap items-center gap-3 text-xs text-lumi-muted">
            <span className="font-mono uppercase tracking-[0.08em]">{test.status}</span>
            {test.startedAt && <span>Started {fmt(test.startedAt)}</span>}
            {test.concludedAt && <span>Concluded {fmt(test.concludedAt)}</span>}
          </div>
        }
      />

      {/* 1 — HOW IT WAS DESIGNED. The power calc, stated as it was committed. */}
      <DetailSection title="How it was designed">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-lumi-subtle">Held out</dt><dd className="tabular-nums text-lumi-text">{pct(test.holdoutPct)}</dd></div>
          <div><dt className="text-lumi-subtle">Detectable lift</dt><dd className="tabular-nums text-lumi-text">{pct(test.mde)}</dd></div>
          <div><dt className="text-lumi-subtle">Per arm</dt><dd className="tabular-nums text-lumi-text">{num(test.sampleSizePerArm)}</dd></div>
          <div><dt className="text-lumi-subtle">Duration</dt><dd className="tabular-nums text-lumi-text">{num(test.durationDays)} days</dd></div>
        </dl>
      </DetailSection>

      {/* 2 — WHAT WAS OBSERVED. R-E3: a 0 here is only a measurement once
          somebody has recorded one, and `status` is the only thing that knows. */}
      <DetailSection title="What was observed">
        {recorded ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-lumi-subtle">Exposed</dt><dd className="tabular-nums text-lumi-text">{num(test.exposedUsers)}</dd></div>
            <div><dt className="text-lumi-subtle">Exposed conversions</dt><dd className="tabular-nums text-lumi-text">{num(test.exposedConversions)}</dd></div>
            <div><dt className="text-lumi-subtle">Held out</dt><dd className="tabular-nums text-lumi-text">{num(test.holdoutUsers)}</dd></div>
            <div><dt className="text-lumi-subtle">Held-out conversions</dt><dd className="tabular-nums text-lumi-text">{num(test.holdoutConversions)}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-lumi-muted">
            No results recorded yet — this holdout has been designed but nobody has entered what it observed.
          </p>
        )}
      </DetailSection>

      {/* 3 — WHAT IT CONCLUDED. A lift is never shown without its interval. */}
      <DetailSection title={concluded ? 'What it concluded' : null}>
        {concluded ? (
          <div className="flex flex-wrap items-baseline gap-3">
            {Number.isFinite(test.liftPct) ? (
              <span className="text-sm text-lumi-text">
                <strong className="tabular-nums">{test.liftPct > 0 ? '+' : ''}{test.liftPct}%</strong> incremental lift
                {Number.isFinite(test.ciLow) && Number.isFinite(test.ciHigh) && (
                  <span className="text-lumi-muted tabular-nums"> · interval {test.ciLow}% to {test.ciHigh}%</span>
                )}
              </span>
            ) : (
              <span className="text-sm text-lumi-muted">No lift could be read out.</span>
            )}
            <Readout label={test.confidenceLabel} />
          </div>
        ) : null}
      </DetailSection>

      {/* 4 — WHERE IT CAME FROM. R-E2: the by-id read now carries the same
          provenance the list does, so a promoted holdout stops reading as one
          that was designed from scratch. Silence means there is no source. */}
      <DetailSection title={src ? 'Where it came from' : null}>
        {src ? (
          <Link
            to={`${appRoutes.testing}/${src.id}`}
            className="text-sm text-lumi-accent hover:underline"
          >
            Promoted from the {src.dimension} experiment: {src.hypothesis} →
          </Link>
        ) : null}
      </DetailSection>

      {/* 5 — WHAT CAME OF IT. */}
      <DetailSection title={test.decisionId ? 'What came of it' : null}>
        {test.decisionId ? (
          <Link
            to={`${appRoutes.decisions}/${test.decisionId}`}
            className="text-sm font-medium text-lumi-accent hover:underline"
          >
            Read the decision this holdout produced →
          </Link>
        ) : null}
      </DetailSection>
    </div>
  );
}
