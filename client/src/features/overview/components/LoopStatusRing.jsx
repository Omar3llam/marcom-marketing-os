// ============================================================
// MARCOM / Lumi — LoopStatusRing (Phase 9 · is the loop closed?)
// ------------------------------------------------------------
// A compact loop-health indicator + the single manual-sweep trigger (this
// REPLACES the old QuickActionsPanel sweep button — there is only one sweep
// control now). Shows the health dot + the backend's own summary line + the
// last-run relative time, and — in the full variant — the six-stage freshness
// strip (PLAN·ALLOCATE·EXECUTE·TEST·MEASURE·LEARN), each tinted by its state.
//
// STALLED → the sweep button is made prominent with an honest nudge. A manual
// sweep only re-scans + re-PROPOSES; it never executes (operator-tier only —
// the route is the arbiter, this just gates the button).
// ============================================================
import { RefreshCw } from 'lucide-react';
import { useRunSweep } from '@/hooks/useRunSweep.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';

const HEALTH = {
  HEALTHY:  { tone: 'scale', label: 'Loop healthy' },
  DEGRADED: { tone: 'hold',  label: 'Loop degraded' },
  STALLED:  { tone: 'kill',  label: 'Loop stalled' },
};

// Per-stage freshness → token tone (stage-state enum: ACTIVE / IDLE / STALE).
const STAGE_TONE = { ACTIVE: 'scale', IDLE: 'hold', STALE: 'kill' };

export function relTime(iso) {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function LoopStatusRing({ loop, summary, canRunSweep = false, compact = false, onSwept }) {
  const { runSweep, sweeping, error } = useRunSweep();
  const health = HEALTH[loop?.loopHealth] ?? HEALTH.STALLED;
  const stalled = loop?.loopHealth === 'STALLED';
  const stages = loop?.stageStatus ?? [];

  const onSweep = async () => {
    const res = await runSweep();
    if (res) await onSwept?.();
  };

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: `var(--c-${health.tone})` }}
            aria-hidden="true"
          />
          <span className="font-display font-bold text-sm text-dark-base">{health.label}</span>
          <HelpTip variant="popover" content={HELP.LOOP_STALLED} iconClassName="text-dark-subtle hover:text-dark-base" />
          {summary && <span className="font-mono text-[11px] text-dark-muted truncate">· {summary}</span>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="font-mono text-[10px] text-dark-subtle">last sweep {relTime(loop?.lastRunAt)}</span>
          {canRunSweep && (
            <button
              onClick={onSweep}
              disabled={sweeping}
              aria-busy={sweeping}
              aria-label={sweeping ? 'Sweeping' : 'Run a sweep now'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-border
                         hover:border-lumi-accent/40 hover:bg-surface-elevated transition-colors text-xs font-display
                         font-semibold text-dark-base disabled:opacity-50 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
            >
              <RefreshCw className={`w-3 h-3 ${sweeping ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              {sweeping ? 'Sweeping…' : 'Run sweep'}
            </button>
          )}
        </div>
      </div>

      {/* Six-stage freshness strip — full variant only. */}
      {!compact && stages.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {stages.map((s) => {
            const tone = STAGE_TONE[s.state] || 'hold';
            return (
              <span
                key={s.stage}
                title={`${s.stage}: ${s.state.toLowerCase()}${s.lastAt ? ` · ${relTime(s.lastAt)}` : ''}`}
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color: `var(--c-${tone}-text)`, background: `var(--c-${tone}-bg)` }}
              >
                {s.stage}
              </span>
            );
          })}
        </div>
      )}

      {stalled && canRunSweep && (
        <p className="mt-2 font-mono text-[10px] text-signal-kill">
          Loop stalled — run a manual sweep to re-scan &amp; re-propose.
        </p>
      )}
      {error && (
        <p className="mt-2 font-mono text-[10px] text-signal-kill">
          {error.message || 'Couldn’t run a sweep right now. Try again shortly.'}
        </p>
      )}
    </div>
  );
}
