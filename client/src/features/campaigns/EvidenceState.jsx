// ============================================================
// MARCOM / Lumi — EvidenceState
// ------------------------------------------------------------
// The three non-answers an evidence request can return, rendered once so the
// Campaigns table and the Overview card cannot drift apart on what a refusal
// looks like.
//
// THREE STATES, THREE TREATMENTS — the distinction this component exists for:
//
//   loading  — spinner, subtle. In progress.
//   error    — AlertTriangle, danger. The request failed; retryable, our fault.
//   refusal  — Info, subtle. The request SUCCEEDED and the engine declined to
//              rank. Deliberately NOT the danger colour: "no ad set is
//              measurably behind the others" is a healthy answer, and painting
//              it red would report good news as a fault. Deliberately not the
//              spinner either — nothing is still coming.
//
// Renders null when there is nothing to say, so a caller can drop it inline.
// ============================================================
import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { refusalLabel } from './executionContext.js';

const ROW = 'flex items-center gap-1.5 font-mono text-[11px]';

export function EvidenceState({ loading = false, error = null, reasonKey = null, className = '' }) {
  if (loading) {
    return (
      <p className={`${ROW} text-lumi-subtle ${className}`}>
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> Checking ad set performance…
      </p>
    );
  }

  if (error) {
    return (
      <p className={`${ROW} text-trend-danger ${className}`}>
        <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Couldn&apos;t load evidence — collapse and try again.
      </p>
    );
  }

  if (reasonKey) {
    return (
      <p className={`${ROW} text-lumi-subtle ${className}`}>
        <Info className="h-3 w-3" strokeWidth={2} /> {refusalLabel(reasonKey)}
      </p>
    );
  }

  return null;
}
