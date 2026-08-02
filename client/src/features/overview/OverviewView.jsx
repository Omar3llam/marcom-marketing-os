// ============================================================
// MARCOM — Home Page (Account Pulse)
// ============================================================
// The operational home, ordered by what the user has to DO:
//
//   1. AccountStateHero      — the one-line answer ("what needs my call?")
//   2. Act now               — KILL / REALLOCATE, ranked, capped
//   3. Keep watching         — WATCH / REFRESH, collapsed
//   4. Doing well            — HOLD / SCALE, a count and the spend it protects
//   5. Decision Calibration  — how well-calibrated past calls were (gated)
//   6. Channels              — is data still flowing?
//   ── below the fold: revenue notices, KPI strip, agentic shell, briefing,
//      copilot. Unchanged, just no longer between the question and its answer.
//
// The re-order is the whole point: the decisions used to sit behind seven other
// blocks, so the page asked "what needs a call?" at the top and answered it
// off-screen. Nothing was deleted — the supporting detail moved down.
//
// The hero is a PURE function of counts already computed here (overviewState.js),
// never a second fetch, so the headline cannot disagree with the sections below.
//
// Every claim derived from the health substrate passes through ONE readiness
// gate (`loading`, defined below) — see the comment there for why dropping
// useAccountHealth's own loading flag made the page assert three absences it had
// not yet established.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Target, AlertTriangle, Activity,
  ArrowRight, Plug, Sparkles, ChevronRight,
} from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useHome } from '@/hooks/useHome.js';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';
import { fromMinor } from '@/lib/money';
import StatCard from '@/components/ui/StatCard.jsx';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import AgenticShellView from './AgenticShellView.jsx';
import FirstRunBanner from './components/FirstRunBanner.jsx';
import RevenueOnboardingBanner from './components/RevenueOnboardingBanner.jsx';
import ConnectionHealthStrip from './components/ConnectionHealthStrip.jsx';
import PacingWidget from './components/PacingWidget.jsx';
import CopilotPanel from './components/CopilotPanel.jsx';
import AIInsightCard from './components/AIInsightCard.jsx';
import RevenueNotice from './components/RevenueNotice.jsx';
import WatchSection from './components/WatchSection.jsx';
import ActNowSection from './components/ActNowSection.jsx';
import PerformingWellSection from './components/PerformingWellSection.jsx';
import AccountStateHero from './components/AccountStateHero.jsx';
import CalibrationSection from './components/CalibrationSection.jsx';
import LoopStatusCompact from './components/LoopStatusCompact.jsx';
import { getAccountState, ACCOUNT_STATE } from './overviewState.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { nextActionFor } from '@/features/campaigns/verdictEvidence.js';

// PURE: the decision feed — health rows (verdict + impact + name, the ONLY
// source of impactScore) joined to their connector row for the metrics
// ExecutionContext needs, and to the verdict row for the engine's own rationale.
// Three sources because no single one carries all of it; the join key is
// entityId throughout. A field absent everywhere stays null → the card omits
// that line rather than inventing it.
//
// The join carries EVERY scored campaign; partitionDecisions below owns which
// ones surface where. (It used to pre-filter to KILL + high-impact WATCH — that
// would have starved the calm sections of the only rows they can ever show.)
// Exported for unit testing.
export function decisionFeed({ healthCampaigns = [], connectorCampaigns = [], verdicts = [] }) {
  const metricsById = new Map(connectorCampaigns.map((c) => [c.entityId, c]));
  const rationaleById = new Map(verdicts.map((v) => [v.id, v.rationale ?? null]));

  return healthCampaigns
    .map((c) => {
      const m = metricsById.get(c.entityId) ?? {};
      return {
        entityId: c.entityId,
        name: c.name ?? m.name ?? null,
        verdict: c.verdict,
        impactScore: c.impactScore ?? null,
        rationale: rationaleById.get(c.entityId) ?? null,
        // The next step a KILL/SCALE asks for — the engine-adjacent helper the
        // Campaigns detail panel already uses, never an invented instruction.
        humanAction: nextActionFor(c.verdict),
        ctr: m.ctr ?? null,
        spendMinor: m.spendMinor ?? null,
        currency: m.currency ?? null,
      };
    });
}

// The three bands, exhaustive over the VERDICT enum
// (verdict-engine/verdictTypes.js): KILL/REALLOCATE ask for an intervention now,
// WATCH/REFRESH are worth monitoring, HOLD/SCALE are working. A campaign the
// engine returned no verdict for belongs to none of them and is not counted —
// "unscored" is not "healthy".
const ACT_NOW_VERDICTS  = ['KILL', 'REALLOCATE'];
const WATCH_VERDICTS    = ['WATCH', 'REFRESH'];
const HEALTHY_VERDICTS  = ['HOLD', 'SCALE'];

// How many cards a band shows before deferring to the Campaigns page. The home
// is a triage surface, not a list — the TOTAL is always reported alongside, so
// capping never hides how much is really there.
export const SECTION_CAP = 3;

// Impact first; spend breaks the tie. Without the tie-break, equal-impact rows
// keep whatever order the health route happened to return, so the same account
// can re-order between renders — and "highest impact first" stops being a claim
// the page can back up.
const byImpactThenSpend = (a, b) =>
  (b.impactScore ?? 0) - (a.impactScore ?? 0) || (b.spendMinor ?? 0) - (a.spendMinor ?? 0);

/**
 * PURE: split the feed into the three bands, sorted and capped.
 * Returns the capped rows AND the true total per band, so the "view all N" link
 * quotes the real count rather than the number of cards on screen.
 * Exported for unit testing.
 */
export function partitionDecisions(feed = []) {
  const band = (verdicts) => feed.filter((d) => verdicts.includes(d.verdict)).sort(byImpactThenSpend);
  const actionable = band(ACT_NOW_VERDICTS);
  const watching   = band(WATCH_VERDICTS);
  const healthy    = feed.filter((d) => HEALTHY_VERDICTS.includes(d.verdict));

  // Protected spend stays NULL when not one healthy campaign reported a spend —
  // "nothing measured" is not "zero protected". A row missing its own spend just
  // contributes nothing to the sum.
  let healthySpend = null;
  let healthyCurrency = null;
  for (const d of healthy) {
    if (d.spendMinor != null) healthySpend = (healthySpend ?? 0) + d.spendMinor;
    if (!healthyCurrency && d.currency) healthyCurrency = d.currency;
  }

  return {
    actNow:      actionable.slice(0, SECTION_CAP),
    actNowTotal: actionable.length,
    watchNow:    watching.slice(0, SECTION_CAP),
    watchTotal:  watching.length,
    healthyCount: healthy.length,
    healthySpend,
    healthyCurrency,
  };
}

// PURE: the four Overview KPI values, CONNECTOR-FIRST (mirrors CampaignsView's
// live-XOR-legacy rule) so a synced workspace's headline matches the Campaigns
// page instead of the disjoint legacy CampaignState feed. Every figure is
// null-when-absent → the card renders "—", never a fabricated 0. Spend/CPA come
// from the live connector aggregate; Wasted/Health from the deterministic engine
// (health). The legacy summary is used ONLY when no channel has synced.
// Exported for unit testing.
export function overviewKpis({ connectorCampaigns = [], summary = null, health = null, currency = 'USD' }) {
  let spendMinor = 0, conversions = 0, sawSpend = false, sawConv = false, cur = null;
  for (const c of connectorCampaigns) {
    if (c.spendMinor != null) { spendMinor += c.spendMinor; sawSpend = true; }
    if (c.conversions != null) { conversions += c.conversions; sawConv = true; }
    if (!cur && c.currency) cur = c.currency;
  }
  const live = connectorCampaigns.length > 0;
  const kpiCurrency = cur || currency;
  return {
    live,
    currency: kpiCurrency,
    spend: live ? (sawSpend ? spendMinor / 100 : null) : (summary?.spend > 0 ? summary.spend : null),
    cpa:   live ? (sawConv && conversions > 0 ? spendMinor / conversions / 100 : null) : (summary?.blendedCpa ?? null),
    wasted: health?.wastedSpend?.minor != null
      ? fromMinor(health.wastedSpend.minor, kpiCurrency)
      : (live ? null : (summary?.wasted > 0 ? summary.wasted : null)),
    health: health?.score ?? (live ? null : (summary?.health ?? null)),
  };
}

export default function OverviewView() {
  const { workspace } = useWorkspace();
  const { campaigns, summary, loading: intelligenceLoading } = useIntelligence();
  const { campaigns: connectorCampaigns, loading: connectorLoading } = useConnectorCampaigns();
  const { data: connectionsData } = useConnections(); // channel sync status (lastSyncedAt)
  // `loading` is destructured DELIBERATELY — see the readiness gate at :240.
  const { health, loading: healthLoading } = useAccountHealth(); // connector campaign health + wasted spend + impact scores
  const { home } = useHome(); // agentic loop home (includes aiInsight)
  const { verdicts } = useConnectorVerdicts(); // the engine's own rationale per campaign
  const { surface: proofSurface } = useAccuracy(); // gated proof one-liner (best-effort)
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

  // Account-health label + tone derived from the real score (no hardcoded verdict).
  // A null score has TWO causes and they are different claims: the health fetch
  // has not landed yet, or it landed and scored nothing. "No score yet" asserts
  // the second; saying it during the first is the same false-absence bug as the
  // hero's (see the readiness gate below), on a quieter surface.
  const healthTone  = kpis.health == null ? 'neutral'
                    : kpis.health >= 75 ? 'positive'
                    : kpis.health >= 50 ? 'warn' : 'danger';
  const healthLabel = kpis.health != null
                    ? (kpis.health >= 75 ? 'Healthy'
                      : kpis.health >= 50 ? 'Fair — review soon' : 'Needs attention')
                    : (healthLoading ? 'Scoring…' : 'No score yet');

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

  // Real count of KILL-verdict campaigns — from the connector health engine when
  // synced, else the legacy feed's alerts. No fabricated count.
  const killCount = useMemo(
    () => (kpis.live
      ? (health?.campaigns ?? []).filter((c) => c.verdict === 'KILL').length
      : campaigns.reduce((n, c) => n + (c.alerts || []).filter((a) => a.analysis?.verdict === 'KILL').length, 0)),
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
  // get retracted a moment later. Adding healthLoading here fixes the class; the
  // three sites below are gated on this one value so a fourth health-derived
  // claim cannot be added without passing through it.
  const loading = intelligenceLoading || connectorLoading || healthLoading;
  const hasData = campaigns.length > 0;                       // legacy CampaignState feed
  const hasConnectorData = connectorCampaigns.length > 0;      // connector entity graph
  const hasAnyData = hasData || hasConnectorData;
  const showCopilot = collabRole !== WORKSPACE_ROLE.CLIENT; // CLIENT home stays read-only & minimal
  const [copilotOpen, setCopilotOpen] = useState(false);

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

  // First-run activation nudge. Onboarding sets sessionStorage 'marcom:firstActivation'
  // on completion — a flag that was written but never read until now. Surface a
  // one-time "connect a channel" hero while the account still has no data, then
  // retire the flag the instant data lands, the user acts on the CTA, or dismisses
  // it — so it never resurfaces on a later visit.
  const [firstRun, setFirstRun] = useState(
    () => typeof window !== 'undefined' && window.sessionStorage?.getItem('marcom:firstActivation') === '1',
  );
  const retireFirstRun = useCallback(() => {
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem('marcom:firstActivation');
    setFirstRun(false);
  }, []);
  useEffect(() => {
    if (firstRun && hasAnyData) retireFirstRun(); // data arrived → guided step is done
  }, [firstRun, hasAnyData, retireFirstRun]);
  const showFirstRun = firstRun && !loading && !hasAnyData;

  // Post-first-sync revenue capture — the highest-leverage moment to ask for
  // revenue data. A workspace has synced (real campaigns scored on engagement
  // signals) but tracks NO revenue yet, so ROAS verdicts stay locked. Shown once
  // per session and retired the instant revenue lands or the user dismisses it.
  // STRATEGIST-only: the revenue upload endpoint (and RevenueCsvTab) enforce that
  // role, so no other seat could complete the CTA — showing it would dead-end.
  // Deferred while FirstRunBanner (the PRE-sync "connect a channel" step) is up.
  const hasEverSynced = connectionsData?.connections?.some((c) => c.lastSyncedAt != null) ?? false;
  const hasRevenueData = connectorCampaigns.some((c) => (c.revenueMinor ?? 0) > 0);
  const [revenueDismissed, setRevenueDismissed] = useState(
    () => typeof window !== 'undefined' && window.sessionStorage?.getItem('lumi:revenue-prompt-dismissed') === '1',
  );
  const dismissRevenue = useCallback(() => {
    if (typeof window !== 'undefined') window.sessionStorage?.setItem('lumi:revenue-prompt-dismissed', '1');
    setRevenueDismissed(true);
  }, []);
  const showRevenueOnboarding =
    collabRole === WORKSPACE_ROLE.STRATEGIST &&
    hasEverSynced &&
    hasConnectorData &&   // real campaigns to score → the "scored N campaigns" line stays honest
    !hasRevenueData &&
    !revenueDismissed &&
    !loading &&
    !firstRun;            // the pre-sync FirstRunBanner takes priority

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      {/* Two columns from lg up: decisions on the left, status on the right.
          Below lg it collapses to one column and the rail STACKS UNDER the main
          content — deliberately not `hidden lg:block`. Channel health and
          calibration are the two things that explain why the decisions look the
          way they do; hiding them on a laptop-narrow window would drop content,
          not just re-lay it out. */}
      <div className="lg:grid lg:grid-cols-[1fr_280px] lg:items-start lg:gap-6">
      <div className="min-w-0">
      {/* 1. The hero — the page's only h1, and the one-line answer to "what does
             this account need right now?". Renders nothing while loading. */}
      <AccountStateHero
        state={accountState}
        actNowTotal={bands.actNowTotal}
        watchTotal={bands.watchTotal}
        healthyCount={bands.healthyCount}
        /* MAJOR units already — overviewKpis applied fromMinor at :167 */
        wastedAmount={kpis.wasted}
        /* connector-derived, so the hero and the Wasted-spend card share a unit */
        currency={kpis.currency}
        workspace={workspace}
        /* LEARNING must tell "never synced" from "synced, nothing scorable" */
        hasAnyData={hasAnyData}
      />

      {/* The no-data story, folded INTO the hero's LEARNING state. Both branches
          below are already `!hasAnyData` conditions, so the gate is a tautology
          for them — it groups them with the hero rather than changing when they
          appear. (The revenue banner is deliberately NOT here: it fires AFTER a
          sync, when the account is no longer LEARNING. See below.) */}
      {accountState === ACCOUNT_STATE.LEARNING && (
        <>
          {/* First-run guided step — the one-time "connect a channel" hero for a
              brand-new account (wires the onboarding firstActivation flag). Shown
              INSTEAD of the generic empty state below, so there's a single, stepped
              call-to-action rather than two competing "connect" heroes. */}
          {showFirstRun && (
            <FirstRunBanner
              step={1}
              title="Connect a channel to get started"
              description="Lumi needs your live campaign data to generate verdicts and decisions. Connect Meta or Google and your account starts populating within minutes."
              primaryAction={{ label: 'Connect a channel', href: appRoutes.settingsIntegrations }}
              onCtaClick={retireFirstRun}
              onDismiss={retireFirstRun}
            />
          )}
        </>
      )}

      {/* Post-first-sync revenue capture — once per session, STRATEGIST-only,
          auto-retired when revenue lands.

          NOT gated on the LEARNING state: showRevenueOnboarding REQUIRES
          hasConnectorData, and an account with connector campaigns that scored
          is ACTION_REQUIRED / WATCH_CLOSELY / PERFORMING_WELL — never LEARNING.
          Gating it would hide this banner in exactly the case it was built for
          (synced, scored, no revenue yet). It keeps its own condition and simply
          sits in the hero region. */}
      {showRevenueOnboarding && (
        <RevenueOnboardingBanner
          campaignCount={connectorCampaigns.length}
          onDismiss={dismissRevenue}
        />
      )}

      {/* Empty state: only when BOTH substrates are empty (no legacy feed AND no
          connector data) — a genuinely un-synced account. Suppressed during
          first-run (the stepped banner above takes its place). */}
      {!loading && !hasAnyData && !firstRun && (
        <div className="flex flex-col items-center justify-center min-h-[480px] p-10 bg-surface-card border border-dashed border-surface-border-strong rounded-xl text-center">
          <div className="w-16 h-16 rounded-xl bg-lumi-accent/10 text-lumi-accent flex items-center justify-center mb-4">
            <Plug className="w-7 h-7" strokeWidth={1.5} />
          </div>
          <div className="font-display font-bold text-lg text-dark-base mb-2">
            No campaign data yet
          </div>
          <p className="text-[14px] text-dark-soft max-w-[440px] leading-relaxed mb-6">
            Connect Meta or Google to unlock account pulse, AI insights, and automated recommendations.
          </p>
          {/* Primary path for a new user: the OAuth connection flow. */}
          <Link
            to={appRoutes.settingsIntegrations}
            className="flex items-center gap-2 px-5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
          >
            <Plug className="w-4 h-4" strokeWidth={1.5} />
            Connect a channel
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      )}

      {/* 2–4. The decision feed, in three descending bands of urgency. Each band
             quotes its TRUE total and shows at most SECTION_CAP cards — the home
             triages, the Campaigns page lists. These now sit DIRECTLY under the
             hero: the KPI strip and the agentic shell used to push them below
             seven other blocks, so the page asked a question at the top and
             answered it off-screen. */}
      {hasAnyData && (
        <>
          {/* ── 2. ACT NOW ── */}
          {bands.actNow.length > 0 && (
            <ActNowSection items={bands.actNow} total={bands.actNowTotal} />
          )}

          {/* ── 3. KEEP WATCHING (collapsed) ── */}
          {bands.watchNow.length > 0 && (
            <WatchSection items={bands.watchNow} total={bands.watchTotal} />
          )}

          {/* ── 4. DOING WELL ── */}
          {bands.healthyCount > 0 && (
            <PerformingWellSection
              count={bands.healthyCount}
              spend={bands.healthySpend}
              currency={bands.healthyCurrency || currency}
            />
          )}

          {/* All three bands empty — say so rather than rendering a silent gap.
              Gated on !loading (which now includes the health fetch): the bands
              are derived from health.campaigns, so before it lands they are
              empty for want of an answer, not because there isn't one. A brief
              silent gap is honest; "No scored campaigns" is not. */}
          {!loading && bands.actNow.length === 0 && bands.watchNow.length === 0 && bands.healthyCount === 0 && (
            <p className="mb-6 rounded-xl border border-lumi-border bg-lumi-surface px-4 py-3 text-xs text-lumi-muted">
              No scored campaigns right now.
            </p>
          )}
        </>
      )}

      {/* ── Below the fold: the supporting detail, unchanged ── */}

      {/* The two revenue-data stories. Kept OUT of the feed above: a campaign here
          is not performing badly, its revenue is unmeasurable — and "never
          uploaded" must never be conflated with "uploaded but now stale". */}
      {hasAnyData && (needsRevenue.length > 0 || staleRevenue.length > 0) && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RevenueNotice type="needs" campaigns={needsRevenue} />
          <RevenueNotice type="stale" campaigns={staleRevenue} />
        </div>
      )}

      {/* KPI stat block — connector-first (live sync), legacy feed only as fallback.
          Shown on EITHER substrate so a synced workspace sees real headline
          numbers; each value is "—" when absent, never a fabricated 0. */}
      {hasAnyData && (
        <>
          {/* Budget pacing — honest burn-rate (gated; refuses misleading single-channel pacing). */}
          <PacingWidget />

          {/* 4 stat cards - responsive: 1 col mobile, 2 col tablet, 4 col desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
            <StatCard
              label="Total spend"
              value={kpis.spend != null ? formatCurrencyWhole(kpis.spend, kpis.currency) : '—'}
              sub="last 30 days"
              Icon={BarChart}
              tone="neutral"
            />
            <StatCard
              label="Blended CPA"
              value={kpis.cpa != null ? formatCurrencyWhole(kpis.cpa, kpis.currency) : '—'}
              sub="across active campaigns"
              Icon={Target}
              tone="neutral"
            />
            <StatCard
              label="Wasted spend"
              value={kpis.wasted != null ? `${formatCurrencyWhole(kpis.wasted, kpis.currency)}/mo` : '—'}
              sub={killCount > 0 ? `${killCount} KILL-verdict campaign${killCount === 1 ? '' : 's'}` : 'flagged for review'}
              Icon={AlertTriangle}
              tone="danger"
            />
            <StatCard
              label="Account health"
              value={kpis.health != null ? `${kpis.health}/100` : '—'}
              sub={healthLabel}
              Icon={Activity}
              tone={healthTone}
              gauge={kpis.health ?? undefined}
            />
          </div>
        </>
      )}

      {/* The agentic shell — the real, role-scoped two-band agenda + loop status.
          Renders on EITHER substrate so a live-synced workspace (connector
          verdicts, empty legacy feed) still sees its agenda. Owns its own
          loading/empty states, so it's safe to mount whenever data exists. */}
      {hasAnyData && <AgenticShellView />}

      {/* Lumi's briefing over the account. */}
      {hasAnyData && (
        <div className="mb-6">
          <AIInsightCard
            insight={home?.aiInsight ?? null}
            healthScore={health?.score ?? null}
            healthLabel={health?.label ?? null}
          />
        </div>
      )}

      {/* Lumi Copilot — account-aware Q&A. The trigger opens a right-side
          slide-over chat (not for the read-only CLIENT seat). Cmd/Ctrl+K is
          intentionally NOT bound here — it's already the global CommandPalette. */}
      {showCopilot && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setCopilotOpen(true)}
            className="group flex w-full items-center justify-between card-raised p-4 transition-colors hover:border-lumi-accent/50"
          >
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-lumi-accent" strokeWidth={1.5} />
              <div className="text-left">
                <p className="text-sm font-medium text-lumi-text">Ask Lumi anything</p>
                <p className="text-xs text-lumi-muted">about this account</p>
              </div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-lumi-muted transition-colors group-hover:text-lumi-accent" strokeWidth={1.5} />
          </button>
          <CopilotPanel isOpen={copilotOpen} onClose={() => setCopilotOpen(false)} />
        </div>
      )}
      </div>

      {/* ── RIGHT RAIL — status, not metrics ──────────────────
          Three short read-only strips that answer "why does the page say what
          it says": is data flowing, how well-calibrated are past calls, and is
          the loop still sweeping. Sticky from lg up so they stay visible while
          the decisions scroll. Nothing here mutates — the sweep trigger stays
          with the full ring below the fold, so there is only ever one. */}
      <aside className="mt-6 space-y-4 lg:mt-0 lg:sticky lg:top-6">
        <ConnectionHealthStrip compact />
        <CalibrationSection surface={proofSurface} compact />
        {hasAnyData && <LoopStatusCompact loop={home?.loop} />}
      </aside>
      </div>
    </div>
  );
}
