// ============================================================
// MARCOM / Lumi — useOverviewModel (Home · the ONE data seam)
// ------------------------------------------------------------
// Every substrate the Home page reads, fetched here and composed into one view
// model. The page below it does no fetching and no deriving: it renders what
// this returns.
//
// Why one seam. The page held nine hooks and five inline derivations, so the
// rules about WHAT MAY BE CLAIMED lived in the same file as the markup that
// claims it — and the readiness gate (below) had to be re-reasoned at every
// call site. With the fetches in one place, "which substrates does this claim
// read?" is answerable by reading twenty lines.
//
// Refactor only. Every hook call, memo dependency array and derived value is
// carried over verbatim from OverviewView.jsx; nothing here changes what the
// page renders. The seam is the point, not new behaviour.
//
// Deliberately NOT here: the first-run / revenue banner state. That is UI
// interrupt sequencing (sessionStorage, dismissal, precedence), not a data
// substrate, and it keeps its own home until the interrupt queue replaces it.
// ============================================================
import { useMemo } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useHome } from '@/hooks/useHome.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import { getAccountState } from './overviewState.js';
import {
  decisionFeed,
  partitionDecisions,
  overviewKpis,
  healthPresentation,
  countKillVerdicts,
} from './overviewDerive.js';

export function useOverviewModel() {
  const { workspace } = useWorkspace();
  const { campaigns, summary, loading: intelligenceLoading } = useIntelligence();
  const { campaigns: connectorCampaigns, loading: connectorLoading } = useConnectorCampaigns();
  const { data: connectionsData } = useConnections(); // channel sync status (lastSyncedAt)
  // `loading` is destructured DELIBERATELY — see the readiness gate below.
  const { health, loading: healthLoading } = useAccountHealth(); // connector campaign health + wasted spend + impact scores
  const { home } = useHome();                        // agentic loop home (includes aiInsight)
  const { verdicts } = useConnectorVerdicts();       // the engine's own rationale per campaign
  const { surface: proofSurface } = useAccuracy();   // gated proof one-liner (best-effort)
  const { role: collabRole } = useCollabRole();

  // Currency detection from workspace (defaults to USD)
  const currency = workspace?.currency || 'USD';

  // KPI strip — CONNECTOR-FIRST (same substrate as the Campaigns page), so the
  // Home headline reflects a live sync instead of the disjoint legacy feed. Every
  // value is null-when-absent → the card shows "—", never a fabricated 0.
  const kpis = useMemo(
    () => overviewKpis({ connectorCampaigns, summary, health, currency }),
    [connectorCampaigns, summary, health, currency],
  );

  // The decision feed + the two revenue-data stories, all keyed off the health
  // rows. The revenue stories are NOT decisions — a campaign there is not
  // performing badly, its revenue is unmeasurable — so they sit apart from the
  // feed rather than inside it.
  const decisions = useMemo(
    () => decisionFeed({
      healthCampaigns: health?.campaigns ?? [],
      connectorCampaigns,
      verdicts,
    }),
    [health, connectorCampaigns, verdicts],
  );
  const bands = useMemo(() => partitionDecisions(decisions), [decisions]);
  const needsRevenue = useMemo(
    () => (health?.campaigns ?? []).filter((c) => c.needsRevenue),
    [health],
  );
  const staleRevenue = useMemo(
    () => (health?.campaigns ?? []).filter((c) => c.revenueStale),
    [health],
  );

  const killCount = useMemo(
    () => countKillVerdicts({
      live: kpis.live,
      healthCampaigns: health?.campaigns ?? [],
      legacyCampaigns: campaigns,
    }),
    [kpis.live, health, campaigns],
  );

  // Two DISJOINT substrates: the legacy CampaignState feed (drives the stat
  // cards) and the connector entity graph (drives the agentic agenda — where a
  // live Meta sync's verdicts live). The agentic shell must NOT be hidden just
  // because the legacy feed is empty; a synced workspace has connector data and
  // real PROPOSED verdicts even when CampaignState is empty.
  //
  // THE READINESS GATE. It must name EVERY substrate a rendered claim reads, not
  // just the ones that decide whether data exists. `useAccountHealth` was fetched
  // but its `loading` was dropped, while `health.campaigns` is the sole source of
  // the bands — so on a synced account whose connector resolved first, the page
  // rendered three claims about a substrate still in flight:
  //
  //   · the hero        → all bands 0 → LEARNING → "No campaigns have enough
  //                       data to score yet", then flipping to "3 decisions need
  //                       your attention" once health landed
  //   · the feed        → "No scored campaigns right now."
  //   · Account health  → "No score yet"
  //
  // All three assert an ABSENCE the page had not yet established, and all three
  // get retracted a moment later. healthLoading here fixes the class; every
  // health-derived claim is gated on this one value (or, for the health card's
  // caption, on the same flag passed into healthPresentation) so a fourth cannot
  // be added without passing through it.
  const loading = intelligenceLoading || connectorLoading || healthLoading;
  const hasData = campaigns.length > 0;                        // legacy CampaignState feed
  const hasConnectorData = connectorCampaigns.length > 0;      // connector entity graph
  const hasAnyData = hasData || hasConnectorData;

  // Account-health card tone + caption (pure; see overviewDerive).
  const { tone: healthTone, label: healthLabel } = healthPresentation({
    score: kpis.health,
    loading: healthLoading,
  });

  // The one question the hero answers, derived from the bands already computed
  // above — never from a second fetch, so the headline cannot disagree with the
  // sections under it. null while loading (no flashed claim).
  const accountState = getAccountState({
    actNowTotal:  bands.actNowTotal,
    watchTotal:   bands.watchTotal,
    healthyCount: bands.healthyCount,
    hasAnyData,
    loading,
  });

  return {
    // identity + units
    workspace,
    currency,
    collabRole,
    showCopilot: collabRole !== WORKSPACE_ROLE.CLIENT, // CLIENT home stays read-only & minimal

    // readiness + substrate presence
    loading,
    hasAnyData,
    hasConnectorData,

    // the account's answer
    accountState,
    bands,
    kpis,
    healthTone,
    healthLabel,
    killCount,
    needsRevenue,
    staleRevenue,

    // raw passthroughs the page hands straight to a child
    health,
    home,
    proofSurface,
    connectorCampaigns,
    connectionsData,
  };
}
