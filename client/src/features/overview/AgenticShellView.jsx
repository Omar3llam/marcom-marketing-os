// ============================================================
// MARCOM / Lumi — AgenticShellView (Phase 9 · the two-band home)
// ------------------------------------------------------------
// The agentic OS shell: the real, role-scoped two-band agenda from getHome —
// replacing Overview's old ad-hoc AlertsPanel/AIInsightPanel feed. Read +
// navigate + propose; it holds ZERO write paths (the manual sweep inside the
// ring re-proposes, never executes).
//
// Role-aware (mirrors the backend's own scoping in AgentHomeService):
//   BUYER      → loop ring (compact) + buyer band ("Today's decisions")
//   STRATEGIST → loop ring (full)    + buyer band + strategist band ("Portfolio health")
//   CLIENT     → strategist band only — no loop ring (a CLIENT seat is read-only,
//                so the sweep is irrelevant), no buyer band (the API returns null)
//
// Honest states: loading skeleton, user-facing error, and per-band empty states
// (an empty band is shown, never hidden). A stale picture still renders with a
// quiet flag — the cron / on-read sweep refreshes it.
// ============================================================
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useHome } from '@/hooks/useHome.js';
import AgendaBand from './components/AgendaBand.jsx';
import LoopStatusRing from './components/LoopStatusRing.jsx';

export default function AgenticShellView() {
  const { role } = useCollabRole();
  const { home, isStale, isLoading, error, refetch } = useHome();

  const isClient = role === WORKSPACE_ROLE.CLIENT;
  const canRunSweep = role === WORKSPACE_ROLE.BUYER || role === WORKSPACE_ROLE.STRATEGIST;
  // Strategist + Client see portfolio health; only the strategist also leads with
  // the buyer band. (A CLIENT never receives a buyer band from the API.)
  const showStrategistBand = role === WORKSPACE_ROLE.STRATEGIST || isClient;

  if (isLoading) {
    return (
      <div className="space-y-3 mb-6" aria-busy="true">
        <div className="h-[60px] rounded-xl border border-surface-border bg-surface-card animate-pulse" />
        <div className="h-[160px] rounded-xl border border-surface-border bg-surface-card animate-pulse" />
      </div>
    );
  }

  if (error || !home) {
    return (
      <div className="mb-6 rounded-xl border border-surface-border bg-surface-card px-4 py-3 font-mono text-xs text-dark-soft">
        Couldn&apos;t load your agenda right now. The loop keeps running — refresh shortly.
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-6">
      {isStale && (
        <p className="font-mono text-[10px] text-dark-subtle">
          Showing the last sweep — refreshing in the background.
        </p>
      )}

      {!isClient && (
        <LoopStatusRing
          loop={home.loop}
          summary={home.summary}
          canRunSweep={canRunSweep}
          compact={role === WORKSPACE_ROLE.BUYER}
          onSwept={refetch}
        />
      )}

      {!isClient && home.buyerBand && <AgendaBand band="BUYER" data={home.buyerBand} />}

      {showStrategistBand && <AgendaBand band="STRATEGIST" data={home.strategistBand} />}
    </div>
  );
}
