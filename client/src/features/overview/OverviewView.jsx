// ============================================================
// MARCOM — Home Page (Account Pulse)
// ============================================================
// The operational home: account-health stats + the Phase-9 agentic shell (the
// real two-band agenda from getHome, role-scoped). The old ad-hoc Alerts /
// AI-Insight / Quick-Actions panels — which derived "alerts" from the campaign
// feed — are gone; the agenda IS the prioritized, evidence-backed action list.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Target, AlertTriangle, Activity,
  ArrowRight, Plug, Sparkles, ChevronRight,
} from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useAuth } from '@/context/AuthContext.jsx';
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
import { ProofSummary } from '@/features/intelligence/proof/ProofView.jsx';
import AgenticShellView from './AgenticShellView.jsx';
import FirstRunBanner from './components/FirstRunBanner.jsx';
import RevenueOnboardingBanner from './components/RevenueOnboardingBanner.jsx';
import ConnectionHealthStrip from './components/ConnectionHealthStrip.jsx';
import PacingWidget from './components/PacingWidget.jsx';
import CopilotPanel from './components/CopilotPanel.jsx';
import AIInsightCard from './components/AIInsightCard.jsx';
import DecisionCard from './components/DecisionCard.jsx';
import RevenueNotice from './components/RevenueNotice.jsx';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { nextActionFor } from '@/features/campaigns/verdictEvidence.js';

// The severity rule the old AlertsPanel used, kept verbatim so the page surfaces
// the same population it always has — only the presentation changed.
const isActionable = (c) => c.verdict === 'KILL' || (c.verdict === 'WATCH' && c.impactScore >= 7);

// PURE: the decision feed — health rows (verdict + impact + name, the ONLY
// source of impactScore) joined to their connector row for the metrics
// ExecutionContext needs, and to the verdict row for the engine's own rationale.
// Three sources because no single one carries all of it; the join key is
// entityId throughout. A field absent everywhere stays null → the card omits
// that line rather than inventing it. Exported for unit testing.
export function decisionFeed({ healthCampaigns = [], connectorCampaigns = [], verdicts = [] }) {
  const metricsById = new Map(connectorCampaigns.map((c) => [c.entityId, c]));
  const rationaleById = new Map(verdicts.map((v) => [v.id, v.rationale ?? null]));

  return healthCampaigns
    .filter(isActionable)
    .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
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
  const { currentUser } = useAuth();
  const { workspace } = useWorkspace();
  const { campaigns, summary, loading: intelligenceLoading } = useIntelligence();
  const { campaigns: connectorCampaigns, loading: connectorLoading } = useConnectorCampaigns();
  const { data: connectionsData } = useConnections(); // channel sync status (lastSyncedAt)
  const { health } = useAccountHealth(); // connector campaign health + wasted spend + impact scores
  const { home } = useHome(); // agentic loop home (includes aiInsight)
  const { verdicts } = useConnectorVerdicts(); // the engine's own rationale per campaign
  const { surface: proofSurface } = useAccuracy(); // gated proof one-liner (best-effort)
  const { role: collabRole } = useCollabRole();

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const userName = currentUser?.displayName?.split(' ')[0] || 'there';

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
  const healthTone  = kpis.health == null ? 'neutral'
                    : kpis.health >= 75 ? 'positive'
                    : kpis.health >= 50 ? 'warn' : 'danger';
  const healthLabel = kpis.health == null ? 'No score yet'
                    : kpis.health >= 75 ? 'Healthy'
                    : kpis.health >= 50 ? 'Fair — review soon' : 'Needs attention';

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
  const loading = intelligenceLoading || connectorLoading;
  const hasData = campaigns.length > 0;                       // legacy CampaignState feed
  const hasConnectorData = connectorCampaigns.length > 0;      // connector entity graph
  const hasAnyData = hasData || hasConnectorData;
  const showCopilot = collabRole !== WORKSPACE_ROLE.CLIENT; // CLIENT home stays read-only & minimal
  const [copilotOpen, setCopilotOpen] = useState(false);

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
      {/* Header */}
      <header className="mb-6">
        <div className="font-mono text-[11px] tracking-[0.08em] uppercase text-dark-muted mb-2 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          Account Pulse · {workspace?.name || 'Workspace'}
        </div>
        <h1 className="font-display font-bold text-4xl tracking-tight text-dark-base">
          Today&apos;s Decisions
        </h1>
        <p className="mt-1 text-sm text-dark-soft">
          {greeting}, {userName}. Here&apos;s what needs a call.
        </p>
      </header>

      {/* Proof of learning — the gated one-liner (RELIABLE only, else "still learning"). */}
      {proofSurface && (
        <div className="mb-6 rounded-xl border border-lumi-border bg-lumi-elevated px-4 py-3">
          <ProofSummary surface={proofSurface} />
        </div>
      )}

      {/* Channel health — honest "is data flowing?" signal from the real
          connections contract. Shown regardless of campaign data, since a
          disconnected channel is often *why* there's no data. */}
      <ConnectionHealthStrip />

      {/* Post-first-sync revenue capture — once per session, STRATEGIST-only,
          auto-retired when revenue lands. Sits below channel health (the "is
          data flowing?" signal) so the ask reads as the natural next step. */}
      {showRevenueOnboarding && (
        <RevenueOnboardingBanner
          campaignCount={connectorCampaigns.length}
          onDismiss={dismissRevenue}
        />
      )}

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

      {/* The decision feed — the campaigns the engine says need a call, each with
          its evidence and (for KILL/REALLOCATE) the ad set to open first. Every
          row traces to a health row; an empty feed says so rather than hiding. */}
      {hasAnyData && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="section-label">Needs your call</h2>
            <span className="font-mono text-[11px] text-lumi-subtle">
              {decisions.length === 0 ? 'clear' : `${decisions.length} decision${decisions.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {decisions.length === 0 ? (
            <p className="rounded-xl border border-lumi-border bg-lumi-surface px-4 py-3 text-xs text-lumi-muted">
              No critical campaigns right now.
            </p>
          ) : (
            <div className="space-y-3">
              {decisions.map((d) => <DecisionCard key={d.entityId} {...d} />)}
            </div>
          )}
        </section>
      )}

      {/* The two revenue-data stories. Kept OUT of the feed above: a campaign here
          is not performing badly, its revenue is unmeasurable — and "never
          uploaded" must never be conflated with "uploaded but now stale". */}
      {hasAnyData && (needsRevenue.length > 0 || staleRevenue.length > 0) && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RevenueNotice type="needs" campaigns={needsRevenue} />
          <RevenueNotice type="stale" campaigns={staleRevenue} />
        </div>
      )}

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
  );
}
