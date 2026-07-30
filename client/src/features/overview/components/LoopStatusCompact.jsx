// ============================================================
// MARCOM / Lumi — LoopStatusCompact (Home right rail · is the loop running?)
// ------------------------------------------------------------
// Read-only loop health for the 280px rail: the health label and when the last
// sweep finished. Nothing else.
//
// ── Why not just reuse LoopStatusRing compact ────────────────
// It already has a `compact` prop, but that variant is still a bordered card
// with a HelpTip and — for operator tiers — a "Run sweep" MUTATION button. The
// rail is a status column; putting the only sweep trigger in it would give the
// page two of them (the full ring stays mounted below the fold in
// AgenticShellView), and two buttons firing the same job is how a user
// double-sweeps. This variant deliberately cannot act.
//
// It reads the loop contract's real fields — loopHealth and lastRunAt
// (loop.schema.ts). There is no `label` or `finishedAt` on the wire: the label
// is derived here, from the same map the full ring uses.
// ============================================================
import { relTime } from './LoopStatusRing.jsx';

// Mirrors LoopStatusRing's HEALTH map. Kept as its own object rather than
// exported/shared because the rail deliberately drops the tone — a coloured dot
// at this size reads as decoration, and the words already say it.
const HEALTH_LABEL = {
  HEALTHY:  'Loop healthy',
  DEGRADED: 'Loop degraded',
  STALLED:  'Loop stalled',
};

const HEALTH_TONE = {
  HEALTHY:  'text-signal-scale',
  DEGRADED: 'text-signal-hold',
  STALLED:  'text-signal-kill',
};

export default function LoopStatusCompact({ loop }) {
  // No loop payload means the agenda has not loaded or the workspace has never
  // swept. Either way there is nothing true to say, so say nothing — an
  // "unknown" row in a status rail reads as a fault that isn't there.
  if (!loop?.loopHealth) return null;

  const label = HEALTH_LABEL[loop.loopHealth];
  // An unrecognised health value must not be printed raw — the backend enum
  // could grow, and "Loop FOO" is worse than the honest fallback.
  if (!label) return null;

  return (
    <div className="space-y-1">
      <p className="section-label text-lumi-muted">Last sweep</p>
      <p className="text-xs text-lumi-text">
        <span className={HEALTH_TONE[loop.loopHealth]}>{label}</span>
        {' · '}
        {relTime(loop.lastRunAt)}
      </p>
    </div>
  );
}
