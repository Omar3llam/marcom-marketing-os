// ============================================================
// The DETAIL grammar — one shape for every by-id destination (B7 R-N4)
// ------------------------------------------------------------
// B7's navigation lock says it in four words: ONE detail grammar, list per
// substrate. A Decision, an A/B experiment and a holdout are read in three
// different places and are three different things, but "open one of them and
// read it" is a single act, and it should feel like one.
//
// This module is that act, extracted from `DecisionDetailView` when B8-05 added
// the second and third destination — extracted rather than copied, because two
// copies of a grammar is how two halves of one class drift apart (C-13), which
// is the defect B8-05 exists to stop repeating.
//
// Two rules travel with it:
//
//  · NO EMPTY HEADINGS. A section with no fact does not appear. An empty box
//    under a promising title implies a gap where there is often none — the
//    class genuinely has no such evidence.
//
//  · A REFUSAL IS A STATE, NOT A BLANK. Every destination can be unreachable,
//    forbidden or unreadable, and B8-02's adapter already distinguishes them.
//    The icon follows the ABSENCE state; the words are the caller's, because
//    only the caller knows what it failed to open.
// ============================================================
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Ban, Lock } from 'lucide-react';
import { ABSENCE } from '@/design-system/states/absence.js';

/** A section renders only when it has a fact. B8-03. */
export function DetailSection({ title, children }) {
  if (!children) return null;
  return (
    <section className="mt-8">
      <h2 className="section-label mb-2">{title}</h2>
      {children}
    </section>
  );
}

// NOT_PERMITTED gets its own mark. A lock and a warning triangle say different
// things: one is "this is not yours to see", the other is "something went
// wrong", and rendering an entitlement as a fault would invite a pointless
// retry — the same reason C-07 refuses to let a token stand in for a reason.
const MARK = {
  [ABSENCE.NOT_PERMITTED]: Lock,
  [ABSENCE.NOT_SUPPORTED]: Ban,
};

/**
 * The refusal block. `state` is an ABSENCE from `absenceState()` — measured,
 * never chosen here; `heading` and `body` are the caller's words for what it
 * could not open.
 */
export function DetailRefusal({ state, heading, body, backTo, backLabel }) {
  const Icon = MARK[state] ?? AlertTriangle;
  const muted = Icon !== AlertTriangle;

  return (
    <section className="rounded-xl border border-lumi-border bg-lumi-surface p-6">
      <div className="flex items-center gap-2">
        <Icon
          className={`h-5 w-5 ${muted ? 'text-lumi-muted' : 'text-signal-hold'}`}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <h2 className="font-display text-sm font-semibold text-lumi-text">{heading}</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-lumi-muted">{body}</p>
      <Link to={backTo} className="mt-4 inline-flex items-center gap-1 text-sm underline">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" /> {backLabel}
      </Link>
    </section>
  );
}

/** The return path, in the header position every detail surface uses. */
export function DetailBackLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-lumi-muted underline">
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" /> {children}
    </Link>
  );
}
