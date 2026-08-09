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
//
// `dimension` selects the level's nouns ONLY — the three treatments above are
// identical at every level, which is why this is one component and not two.
// ============================================================
import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { refusalLabel } from './executionContext.js';

const ROW = 'flex items-center gap-1.5 font-mono text-[11px]';

// What is being checked, per level. The refusal sentence gets its nouns from
// refusalLabel; this is the one string this component owns.
const CHECKING = Object.freeze({
  adset: 'Checking ad set performance…',
  ad:    'Checking creative performance…',
});

export function EvidenceState({ loading = false, error = null, reasonKey = null, dimension = 'adset', className = '' }) {
  if (loading) {
    return (
      <p className={`${ROW} text-lumi-subtle ${className}`}>
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> {CHECKING[dimension] ?? CHECKING.adset}
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
        <Info className="h-3 w-3" strokeWidth={2} /> {refusalLabel(reasonKey, dimension)}
      </p>
    );
  }

  return null;
}
