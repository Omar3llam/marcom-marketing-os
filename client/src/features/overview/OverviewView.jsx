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
// This file RENDERS. It does not fetch and it does not derive:
//   · useOverviewModel.js  — every substrate, composed into one view model,
//                            including the readiness gate that decides when a
//                            claim may be made at all
//   · overviewDerive.js    — the pure derivations (feed, bands, KPIs, health
//                            caption, kill count)
//   · overviewState.js     — the account state machine + the hero's sentences
//
// What remains here besides markup is the two onboarding interrupts, which are
// UI sequencing (sessionStorage + dismissal + precedence) rather than data.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plug, Sparkles, ChevronRight } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import AgenticShellView from './AgenticShellView.jsx';
import KpiStrip from './components/KpiStrip.jsx';
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
import { ACCOUNT_STATE } from './overviewState.js';
import { useOverviewModel } from './useOverviewModel.js';

export default function OverviewView() {
  const {
    workspace, currency, collabRole, showCopilot,
    loading, hasAnyData, hasConnectorData,
    accountState, bands, kpis, healthTone, healthLabel, killCount,
    needsRevenue, staleRevenue,
    health, home, proofSurface, connectorCampaigns, connectionsData,
  } = useOverviewModel();

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
        /* MAJOR units already — overviewKpis (overviewDerive.js) applied fromMinor */
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
              Gated on !loading (which includes the health fetch): the bands are
              derived from health.campaigns, so before it lands they are empty
              for want of an answer, not because there isn't one. A brief silent
              gap is honest; "No scored campaigns" is not. */}
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

          <KpiStrip
            kpis={kpis}
            killCount={killCount}
            healthLabel={healthLabel}
            healthTone={healthTone}
          />
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
