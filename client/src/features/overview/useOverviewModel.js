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
// The seam also classifies completeness: required failures withhold account
// claims; optional failures keep surviving evidence and mark the page PARTIAL.
//
// Deliberately NOT here: the first-run / revenue banner state. That is UI
// interrupt sequencing (sessionStorage, dismissal, precedence), not a data
// substrate, and it keeps its own home until the interrupt queue replaces it.
// ============================================================
import { isRetryableReadError } from '@/design-system/states/readStatus.js';
import { useMemo } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useHome } from '@/hooks/useHome.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import { useAccountAggregate } from '@/hooks/useAccountAggregate.js';
import { accountAggregateReading } from '@/lib/accountAggregate.js';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';
import { getAccountState, getOverviewStatus } from './overviewState.js';
import { buildSurfacePlan } from './overviewPlan.js';
import { pickInterrupt } from './overviewInterrupts.js';
import { useDismissals } from './useDismissals.js';
import {
  decisionFeed,
  partitionDecisions,
  overviewKpis,
  healthPresentation,
  countKillVerdicts,
} from './overviewDerive.js';

export function useOverviewModel() {
  const { workspace, loading: workspaceLoading, error: workspaceError, refetch: workspaceRetry, status: workspaceStatus, canRetry: workspaceCanRetry } = useWorkspace();
  // B8-02 — `error` is destructured from every substrate that decides whether
  // data EXISTS. Before this the word did not appear in this file at all, from
  // seven hooks, so a failed read arrived as `hasAnyData: false` and the hero
  // said "Connect a channel to get your first verdict" — an outage reported as
  // an empty account. Same discipline as the readiness gate below: name every
  // substrate a rendered claim reads, not just the ones that carry data.
  //
  // FE-03 — and the rule has a converse this file was breaking. `useIntelligence`
  // (GET /lumi/feed) stood here, and its `error` fed `readFailed` below. Since
  // S1-B deleted that response's `campaigns` array, the page read NOTHING from
  // it — yet a 500 there made Attention announce, on an account whose
  // /entities/campaigns read had succeeded:
  //
  //     "Lumi couldn't read this account just now."
  //
  // and, because the first-run interrupt is `!hasAnyData && !unreadable`,
  // withhold the connect-a-channel instruction that would have helped.
  // NAME EVERY SUBSTRATE A CLAIM READS — and no others.
  const { campaigns: connectorCampaigns, loading: connectorLoading, error: connectorError, refetch: connectorRetry } = useConnectorCampaigns();
  const { data: connectionsData, loading: connectionsLoading, error: connectionsError, refetch: connectionsRetry } = useConnections(); // channel sync status (lastSyncedAt)
  // `loading` is destructured DELIBERATELY — see the readiness gate below.
  const { health, loading: healthLoading, error: healthError, refetch: healthRetry, forbidden: healthForbidden } = useAccountHealth(); // connector campaign health + wasted spend + impact scores
  const { home, isStale: homeStale, error: homeError, refetch: homeRetry } = useHome(); // agentic loop home (includes aiInsight)
  const { verdicts, loading: verdictLoading, error: verdictError, refetch: verdictRetry } = useConnectorVerdicts(); // engine rationale
  const { surface: proofSurface, loading: accuracyLoading, error: accuracyError, refetch: accuracyRetry } = useAccuracy();
  const { role: collabRole } = useCollabRole();
  // PARITY-01 — the CANONICAL account aggregate. Attention used to sum the
  // connector rows itself; so did Campaigns, with a different divisor. This is
  // the one answer both surfaces now read.
  const {
    response: aggregateResponse,
    loading: aggregateLoading,
    error: aggregateError,
    refetch: aggregateRetry,
    forbidden: aggregateForbidden,
  } = useAccountAggregate();

  const briefingUnavailable = home?.aiInsightStatus === 'UNAVAILABLE';
  const retryableReads = [
    [workspaceCanRetry, workspaceRetry],
    [briefingUnavailable && !homeError, homeRetry],
    ...[[connectorError, connectorRetry], [connectionsError, connectionsRetry],
      [healthError, healthRetry], [homeError, homeRetry], [verdictError, verdictRetry],
      [accuracyError, accuracyRetry], [aggregateError, aggregateRetry]]
      .map(([error, retry]) => [isRetryableReadError(error), retry]),
  ].filter(([retryable, retry]) => retryable && typeof retry === 'function');

  const requiredError = Boolean(connectorError || healthError);
  // The server publishes a health object even when it scored nothing. A null
  // health beside known campaigns is not evidence that they are merely learning.
  const healthUnresolved = !healthLoading && !healthError && !healthForbidden
    && connectorCampaigns.length > 0 && health == null;
  const requiredUnavailable = Boolean(healthForbidden || healthUnresolved);
  const coreLoading = Boolean(connectorLoading || healthLoading);
  const coreAvailable = !requiredError
    && (!requiredUnavailable || collabRole === WORKSPACE_ROLE.CLIENT);
  const coreUsable = !coreLoading && coreAvailable;
  const optionalError = Boolean(verdictError || aggregateError || connectionsError || accuracyError || homeError || briefingUnavailable
    || (aggregateForbidden && collabRole !== WORKSPACE_ROLE.CLIENT));
  const overviewStatus = getOverviewStatus({
    loading: coreLoading,
    optionalLoading: Boolean(verdictLoading || aggregateLoading || connectionsLoading || accuracyLoading),
    requiredError,
    requiredUnavailable,
    optionalError,
    hasCampaigns: !connectorError && connectorCampaigns.length > 0,
  });
  const effectiveHealth = coreAvailable ? health : null;

  const currency = !workspaceLoading && !workspaceError && workspaceStatus !== 'NOT_REACHABLE'
    && isKnownCurrency(workspace?.currency) ? workspace.currency : null;
  const currencyError = Boolean(workspaceError || workspaceStatus === 'NOT_REACHABLE');

  // KPI strip — read from GET /lumi/account/aggregate, the SAME answer the
  // Campaigns page reads, so the two axes cannot state different totals for the
  // same account. Every value is null-when-absent → the card shows "—", never a
  // fabricated 0.
  //
  // Deliberately NOT added to `readFailed` below. That names the substrates
  // that decide whether data EXISTS, and this one does not: it decides what the
  // KPI cards say, and each card states its own absence with its own reason. A
  // failed aggregate read must not blank the hero and the agenda too.
  // The aggregate's own read state travels WITH it: a KPI card must be able to
  // say "we could not read this" rather than print an absence that reads as a
  // fact about the account.
  const aggregate = useMemo(
    () => accountAggregateReading({
      response: aggregateResponse,
      loading: aggregateLoading,
      error: aggregateError,
      forbidden: aggregateForbidden,
    }),
    [aggregateResponse, aggregateLoading, aggregateError, aggregateForbidden],
  );
  const kpis = useMemo(
    () => overviewKpis({ aggregate, health: effectiveHealth, currency, currencyError, currencyLoading: workspaceLoading }),
    [aggregate, effectiveHealth, currency, currencyError, workspaceLoading],
  );

  // The decision feed + the two revenue-data stories, all keyed off the health
  // rows. The revenue stories are NOT decisions — a campaign there is not
  // performing badly, its revenue is unmeasurable — so they sit apart from the
  // feed rather than inside it.
  // Health rows establish the decision bands. The separate verdict response
  // enriches them with rationale and persisted decision identity; its failure
  // makes the page PARTIAL, never a confirmed zero-verdict response.
  const decisions = useMemo(
    () => coreUsable ? decisionFeed({
      healthCampaigns: effectiveHealth?.campaigns ?? [],
      connectorCampaigns,
      verdicts: verdictError ? [] : verdicts,
    }) : null,
    [coreUsable, effectiveHealth, connectorCampaigns, verdicts, verdictError],
  );
  // A required failure has no decision count at all. Zero is reserved for a
  // successful health read that actually returned no scored decisions.
  const bands = useMemo(() => decisions === null ? null : partitionDecisions(decisions), [decisions]);
  const needsRevenue = useMemo(
    () => (effectiveHealth?.campaigns ?? []).filter((c) => c.needsRevenue),
    [effectiveHealth],
  );
  const staleRevenue = useMemo(
    () => (effectiveHealth?.campaigns ?? []).filter((c) => c.revenueStale),
    [effectiveHealth],
  );

  const killCount = useMemo(
    () => coreAvailable ? countKillVerdicts({ healthCampaigns: effectiveHealth?.campaigns ?? [] }) : null,
    [coreAvailable, effectiveHealth],
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
  const loading = coreLoading;
  const hasConnectorData = !connectorError && connectorCampaigns.length > 0;
  // FE-03 — this was `hasData || hasConnectorData`, where `hasData` read the
  // legacy CampaignState feed. The two were already equal in FACT, since that
  // feed could not be non-empty; they are equal by CONSTRUCTION now, so nothing
  // downstream can be gated on a substrate that no longer answers.
  const hasAnyData = hasConnectorData;

  // The scoring engine reads the CONNECTOR graph and nothing else
  // (/entities/health runs over getConnectorCampaigns), so "has data" and "can
  // be scored" are NOT the same fact. A workspace holding only legacy
  // CampaignState rows will never receive a verdict, however long it waits.
  const hasScorableData = hasConnectorData;

  // /entities/health is gated to BUYER|STRATEGIST while /entities/campaigns is
  // ungated, so a CLIENT sees campaigns and receives health: null — zero bands
  // from AUTHORIZATION, not from absent data. Derived from the role rather than
  // sniffed from a 403 so it is true before the request resolves, and so it
  // cannot be confused with a genuine fetch failure.
  const scoringHidden = collabRole === WORKSPACE_ROLE.CLIENT && hasAnyData;

  // B8-02 — THE CAUSE OF ABSENCE. `hasAnyData: false` has two causes that look
  // identical from here: the account genuinely has nothing, or we could not
  // read it. Only the second is a statement about Lumi, and it is the one the
  // page was getting wrong.
  //
  // Every substrate that feeds `hasAnyData` is named, for the same reason the
  // readiness gate names them: a substrate whose failure is dropped becomes an
  // absence the page asserts without having established it. `health` is
  // included because it is the sole source of the bands.
  //
  // Distinct from `scoringHidden` by construction — that one is derived from
  // the ROLE, never sniffed from a failed request, precisely so the two can
  // never be confused.
  //
  // FE-03 — `intelligenceError` was a third disjunct here. It has gone with the
  // fetch behind it: a substrate that feeds no claim cannot make a claim
  // unreadable. The two that remain are the two Attention actually reads, and
  // `useIntelligenceData.error.test.jsx` — B8-02's guard that "an exported
  // `error` state is not an error path" — is retired with its hook, so this
  // slice owns the replacement: useOverviewModel.substrates.test.jsx pins that
  // a failure of EITHER remaining substrate still reaches the operator.
  const readFailed = requiredError || (requiredUnavailable && collabRole !== WORKSPACE_ROLE.CLIENT);

  // Account-health card tone + caption (pure; see overviewDerive).
  // The band is the ENGINE's, read off the same payload the score came from —
  // Campaigns already renders `health.label`, and this axis re-derived its own
  // from the score, so the two disagreed about one account. One published
  // vocabulary, no reclassification here. See overviewDerive.healthPresentation.
  const { tone: healthTone, label: healthLabel } = healthPresentation({
    score: kpis.health,
    label: effectiveHealth?.label ?? null,
    loading: healthLoading,
  });

  // The one question the hero answers, derived from the bands already computed
  // above — never from a second fetch, so the headline cannot disagree with the
  // sections under it. null while loading (no flashed claim).
  const accountState = getAccountState({
    actNowTotal:  bands?.actNowTotal,
    watchTotal:   bands?.watchTotal,
    healthyCount: bands?.healthyCount,
    hasAnyData,
    loading,
    scoringHidden,
    unreadable: readFailed,
  });

  // ── Lumi's briefing, folded into the hero ───────────────────
  // LoopRun.aiInsight: prose the sweep generated by narrating the verdicts the
  // deterministic engine had already produced (PortfolioAnalysisService —
  // ADVISE, NEVER OVERRIDE). It cannot introduce a verdict the hero does not
  // know about, but it IS a snapshot of the last sweep while the hero is live,
  // so the two can drift apart in TIME. Two gates:
  //
  //   · !homeStale     — the sweep is older than its own interval, so the
  //                      briefing may describe an account that has since moved.
  //                      A stale second opinion next to a live headline is the
  //                      disagreement itself; dropped rather than caveated.
  //   · !scoringHidden — this prose narrates verdicts, and SCORING_HIDDEN is the
  //                      page saying those verdicts are not shown to this seat.
  //                      Rendering it there would contradict the line above it.
  //                      (The API returns aiInsight to a CLIENT regardless —
  //                      see the PR notes; gating it here is the frontend half.)
  const insight = (!homeError && home?.aiInsightStatus === 'PRESENT' && !homeStale && !scoringHidden && coreUsable)
    ? (home.aiInsight ?? null) : null;

  // ── The one interrupt, and the plan that orders everything ──
  const hasEverSynced = connectionsData?.connections?.some((c) => c.lastSyncedAt != null) ?? false;
  const hasRevenueData = hasConnectorData && connectorCampaigns.some((c) => (c.revenueMinor ?? 0) > 0);
  const { firstRunFlag, dismissed, dismiss } = useDismissals({ hasAnyData });

  const interrupt = connectionsError ? null : pickInterrupt({
    loading: loading || Boolean(connectionsLoading),
    firstRunFlag,
    hasAnyData,
    hasConnectorData,
    hasEverSynced,
    hasRevenueData,
    isStrategist: collabRole === WORKSPACE_ROLE.STRATEGIST,
    dismissed,
    unreadable: readFailed,
  });

  const showCopilot = collabRole !== WORKSPACE_ROLE.CLIENT; // CLIENT home stays read-only & minimal
  const plan = buildSurfacePlan({ accountState, hasAnyData, showCopilot, interrupt });

  return {
    // identity + units
    workspace,
    currency,
    collabRole,
    showCopilot,

    // readiness + substrate presence
    loading,
    overviewStatus,
    canRetry: retryableReads.length > 0,
    retryFailedReads: () => retryableReads.forEach(([, retry]) => retry()),
    coreAvailable,
    coreUsable,
    hasAnyData,
    hasConnectorData,
    hasScorableData,
    scoringHidden,

    // what shows, in what order (+ the single interrupt)
    plan,
    dismiss,

    // the account's answer
    accountState,
    insight,
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
    proofSurface: accuracyError ? null : proofSurface,
    connectorCampaigns,
    connectionsData,
    connectionsLoading,
    connectionsError,
  };
}
