// ============================================================
// MARCOM / Lumi — NarrativeCard (Phase 8 · the reasoned report, not a dashboard)
// ------------------------------------------------------------
// Renders ONE stakeholder narrative: headline, report confidence, and the
// engine's sections (What we did / Where it went / What it changed / What we
// proved / Against the goal). The sections arrive pre-ordered and
// audience-filtered from the backend — this just renders what it receives.
//
// WHY THIS ISN'T A DASHBOARD:
//   • Every figure cites a real row. Each claim renders an EVIDENCE CHIP per
//     figure (kind + the backing row id) — the audit trail is visible, not
//     implied. A claim with no figures is prose, never a hidden number.
//   • An unproven claim (proven === false) is visually demoted, never dressed
//     up as a result.
//   • Report confidence is defensible by construction: it shows its component
//     breakdown, never a bare score. When the band is LOW we suppress the number
//     entirely and say "Still building confidence on this account" — a low score
//     is never paraded as if it were authoritative.
// ============================================================
import { useState } from 'react';
import { FileText, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils.js';

// Short, human label for an evidence kind (the chip caption).
const KIND_LABEL = {
  DECISION: 'decision', OUTCOME: 'outcome', ALLOCATION: 'allocation',
  INCREMENTALITY: 'holdout', GOAL: 'goal', BLENDED: 'blended',
};

const CONFIDENCE_TONE = {
  HIGH:     'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  MODERATE: 'text-signal-hold bg-signal-hold-bg border-signal-hold/25',
  LOW:      'text-lumi-subtle bg-lumi-surface border-lumi-border',
};

function EvidenceChip({ figure }) {
  const kind = KIND_LABEL[figure.kind] || 'evidence';
  // The chip's title carries the full provenance: a reader can trace the number
  // home to its row. value+unit shown so the chip is not a bare badge.
  const num = `${figure.value}${figure.unit && figure.unit !== 'count' ? figure.unit : ''}`;
  return (
    <span
      title={`${kind} · ${num} · row ${figure.evidenceRef}`}
      className="inline-flex items-center gap-1 rounded border border-lumi-border bg-lumi-surface px-1.5 py-0.5 font-mono text-[10px] text-lumi-subtle"
    >
      <span className="text-lumi-muted">{num}</span>
      <span className="uppercase tracking-wide">{kind}</span>
    </span>
  );
}

function ClaimRow({ claim }) {
  const unproven = claim.proven === false;
  return (
    <li className={cn('text-sm leading-6', unproven ? 'text-lumi-subtle' : 'text-lumi-text')}>
      <span>{claim.text}</span>
      {unproven && (
        <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-wide text-signal-hold">not yet conclusive</span>
      )}
      {claim.figures?.length > 0 && (
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {claim.figures.map((f, i) => <EvidenceChip key={`${f.evidenceRef}-${i}`} figure={f} />)}
        </span>
      )}
    </li>
  );
}

function ConfidenceBlock({ reportConfidence }) {
  const [open, setOpen] = useState(false);
  if (!reportConfidence) return null;
  const { score, label, components = [] } = reportConfidence;

  // LOW band → suppress the number. A low-confidence report should read as
  // "still learning", not flaunt a weak score as if it meant something.
  if (label === 'LOW') {
    return (
      <p className="font-mono text-[11px] text-lumi-subtle" title="Report confidence is below the moderate band — too little proven signal to publish a score.">
        Still building confidence on this account.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn('inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide', CONFIDENCE_TONE[label] || CONFIDENCE_TONE.LOW)}
      >
        Report confidence {score} · {label}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} strokeWidth={1.5} />
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {components.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-3 font-mono text-[10px] text-lumi-subtle">
              <span>{c.key}</span>
              <span className="text-lumi-muted">{Math.round((c.value ?? 0) * 100)}% × {c.weight}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NarrativeCard({ narrative }) {
  if (!narrative) return null;
  const { headline, sections = [], reportConfidence, period, audience, periodEnd } = narrative;
  const asOf = periodEnd ? new Date(periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  return (
    <article className="rounded-2xl border border-lumi-border bg-lumi-surface p-5">
      <header className="flex flex-wrap items-start gap-3">
        <FileText className="w-4 h-4 mt-0.5 text-lumi-accent" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base text-lumi-text leading-snug">{headline}</h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-lumi-subtle">
            {period} · {audience}{asOf ? ` · as of ${asOf}` : ''}
          </p>
        </div>
        <ConfidenceBlock reportConfidence={reportConfidence} />
      </header>

      <div className="mt-4 space-y-5">
        {sections.map((s) => (
          <section key={s.key}>
            <div className="section-label">{s.title}</div>
            <ul className="mt-2 space-y-1.5">
              {s.claims.map((c, i) => <ClaimRow key={`${s.key}-${i}`} claim={c} />)}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
