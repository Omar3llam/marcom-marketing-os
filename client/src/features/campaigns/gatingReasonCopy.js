// ============================================================
// gatingReasonCopy — one sentence per reason, and the next action it implies (C-07)
// ============================================================
// 🔒 C-07. The backend names WHY a campaign has no verdict and WHAT would give
// it one. This module is the only place that turns those two facts into words.
//
// ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
// The wire has carried three distinct reasons for a long time, with the operands
// needed to explain each. The client took `gatedOut`, mapped it to a Set of ids,
// threw the reason away at the door — and printed ONE sentence over all three:
//
//     "N connected campaigns need revenue data before they can be scored"
//
// For a campaign that has never been synced, and for one whose measurement went
// stale, that instruction is simply wrong. Adding revenue changes nothing; the
// fix is a sync. An operator who followed it would work on the wrong problem and
// watch the number not move.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
// The SERVER owns the fact, the CLIENT owns the wording — the same split C-03
// established for the memory timeline. So the strings live here and the reason
// lives in @marcom/runtime-contracts, and an unrecognised reason degrades to a
// neutral label with NO action rather than to a confident wrong one. Silence
// about the fix is honest; the wrong fix is not.
// ============================================================
import { GATING_REASON } from '@marcom/runtime-contracts';

// Every label below is a PARTICIPIAL phrase, never a finite verb: "N campaign(s)
// <label>" has to read correctly at one and at many. The real-row run caught the
// first draft doing neither — "1 campaign have never been measured".

/** What a surface says when the payload names a reason this build has no copy for. */
const UNRECOGNISED = Object.freeze({
  label: 'not scored',
  // NULL, deliberately. Every other absence in Lumi degrades to "we cannot say"
  // rather than to a guess, and a next action is the most expensive thing to
  // guess: it sends a person to do work that will not help.
  action: null,
  rationale: 'Not scored — this build does not recognise the reason given',
});

const COPY = Object.freeze({
  [GATING_REASON.NO_MEASURABLE_DELIVERY]: Object.freeze({
    label: 'with no measurable delivery',
    // The ONLY reason revenue fixes. `revenueGuidance` is the industry-tailored
    // sentence from onboarding; the fallback stays generic rather than naming a
    // source this workspace may not use.
    action: (guidance) => guidance ?? 'connect a revenue source so spend can be scored',
    rationale: () => 'No measured delivery — add a revenue source to unlock a verdict',
  }),
  [GATING_REASON.NO_CANONICAL_WINDOW]: Object.freeze({
    label: 'never measured over the verdict window',
    action: () => 'run a first sync so the measurement lands',
    rationale: () => 'Never measured over the verdict window — awaiting a first sync',
  }),
  [GATING_REASON.CANONICAL_EVIDENCE_STALE]: Object.freeze({
    label: 'measured too long ago to score today',
    action: () => 'sync again so the measurement is current',
    // Uses the operands the backend has always published and the client has
    // always discarded: nothing is recomputed here.
    rationale: ({ measurementAgeDays, maxAgeDays } = {}) => (
      Number.isFinite(measurementAgeDays)
        ? `Last measured ${measurementAgeDays} days ago — past the ${maxAgeDays ?? 3}-day limit; needs a fresh sync`
        : 'Age of the last measurement could not be established — needs a fresh sync'
    ),
  }),
});

/**
 * The label and next action for one reason.
 * @returns {{label:string, action:string|null}} `action` is null when unknown.
 */
export function gatingCopyFor(reason, { revenueGuidance } = {}) {
  const copy = COPY[reason];
  if (!copy) return { label: UNRECOGNISED.label, action: UNRECOGNISED.action };
  return { label: copy.label, action: copy.action(revenueGuidance) };
}

/**
 * Group gated-out campaigns BY REASON — never into one total.
 *
 * A single count is what made three problems look like one. Insertion order is
 * preserved so the reasons appear in the order the backend published them
 * (dataless, never-measured, stale), which is also their order in time.
 *
 * `label` is the short form for a dense sub-line, `sentence` the full form with
 * the next action. Both come from the same declaration — a surface picks a
 * length, never a different meaning.
 *
 * @returns {Array<{reason:string, count:number, label:string, action:string|null,
 *   sentence:string, items:Array}>}
 */
export function summarizeGatedOut(gatedOut, { revenueGuidance } = {}) {
  const groups = new Map();
  for (const item of gatedOut ?? []) {
    const reason = item?.reason ?? null;
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(item);
  }

  return [...groups.entries()].map(([reason, items]) => {
    const { label, action } = gatingCopyFor(reason, { revenueGuidance });
    const noun = `${items.length} campaign${items.length === 1 ? '' : 's'}`;
    return {
      reason,
      count: items.length,
      items,
      label,
      action,
      sentence: action ? `${noun} ${label} — ${action}.` : `${noun} ${label}.`,
    };
  });
}

/**
 * The one-line rationale for a gated campaign in an exported report.
 * Carries the stale row's own age and threshold rather than a generic note.
 */
export function gatedRationale(item) {
  const copy = COPY[item?.reason];
  return copy ? copy.rationale(item) : UNRECOGNISED.rationale;
}
