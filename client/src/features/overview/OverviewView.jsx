// ============================================================
// MARCOM — Home Page (Account Pulse)
// ============================================================
// The operational home. It answers "what does this account need from me right
// now?" and hands off — a triage surface, not a dashboard.
//
// This file RENDERS A PLAN. It does not fetch, derive, or decide order:
//   · useOverviewModel.js    — every substrate + the readiness gate
//   · overviewDerive.js      — the pure derivations
//   · overviewState.js       — the account state machine + its sentences
//   · overviewPlan.js        — WHICH slots show, in WHAT order, per state
//   · overviewInterrupts.js  — which single nudge (if any) is due
//
// The slot registry below maps a plan id to its markup and nothing else. The
// previous version expressed the same thing as twelve nested `&&` chains in a
// fixed order, so every state rendered the same furniture — a LEARNING account
// got four "—" stat cards and a pacing widget under a hero that had just said it
// had nothing to score.
//
// A state may REORDER and DEFER, never DELETE: everything not promoted appears
// below the fold, so no state can make content unreachable.
// ============================================================
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plug, Sparkles, ChevronRight } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import AgenticShellView from './AgenticShellView.jsx';
import KpiStrip from './components/KpiStrip.jsx';
import FirstRunBanner from './components/FirstRunBanner.jsx';
import RevenueOnboardingBanner from './components/RevenueOnboardingBanner.jsx';
import ConnectionHealthStrip from './components/ConnectionHealthStrip.jsx';
import PacingWidget from './components/PacingWidget.jsx';
import CopilotPanel from './components/CopilotPanel.jsx';
import RevenueNotice from './components/RevenueNotice.jsx';
import WatchSection from './components/WatchSection.jsx';
import ActNowSection from './components/ActNowSection.jsx';
import PerformingWellSection from './components/PerformingWellSection.jsx';
import AccountStateHero from './components/AccountStateHero.jsx';
import CalibrationSection from './components/CalibrationSection.jsx';
import { SLOT } from './overviewPlan.js';
import { INTERRUPT } from './overviewInterrupts.js';
import { useOverviewModel } from './useOverviewModel.js';
import { OVERVIEW_STATUS } from './overviewState.js';

export default function OverviewView() {
  const {
    workspace, plan, dismiss,
    hasAnyData, hasScorableData, overviewStatus, coreAvailable, coreUsable,
    accountState, insight, bands, kpis, healthTone, healthLabel, killCount,
    needsRevenue, staleRevenue,
    proofSurface, connectorCampaigns,
    connectionsData, connectionsLoading, connectionsError,
  } = useOverviewModel();

  const [copilotOpen, setCopilotOpen] = useState(false);

  // ── The interrupt: at most one, always directly under the hero ──
  // Under, not above: the hero is the page's answer, and a nudge that pre-empted
  // it would make an onboarding step outrank a KILL verdict.
  const interrupts = {
    [INTERRUPT.FIRST_RUN]: (
      <FirstRunBanner
        step={1}
        title="Connect a channel to get started"
        description="Lumi needs your live campaign data to generate verdicts and decisions. Connect Meta or Google and your account starts populating within minutes."
        primaryAction={{ label: 'Connect a channel', href: appRoutes.connections }}
        onCtaClick={() => dismiss(INTERRUPT.FIRST_RUN)}
        onDismiss={() => dismiss(INTERRUPT.FIRST_RUN)}
      />
    ),
    [INTERRUPT.REVENUE]: (
      <RevenueOnboardingBanner
        campaignCount={connectorCampaigns.length}
        onDismiss={() => dismiss(INTERRUPT.REVENUE)}
      />
    ),
    // The genuinely un-synced account. Not a nudge beside content — it IS the
    // content, so it takes the full column.
    [INTERRUPT.CONNECT]: (
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
        <Link
          to={appRoutes.connections}
          className="flex items-center gap-2 px-5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
        >
          <Plug className="w-4 h-4" strokeWidth={1.5} />
          Connect a channel
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
        </Link>
      </div>
    ),
  };

  // ── The slot registry ──────────────────────────────────────
  // id → markup. No conditions about ORDER live here; a slot that has nothing to
  // show returns null and the plan is none the wiser.
  const slots = {
    [SLOT.HERO]: (
      <AccountStateHero
        state={accountState}
        actNowTotal={bands?.actNowTotal}
        watchTotal={bands?.watchTotal}
        healthyCount={bands?.healthyCount}
        /* MAJOR units already — overviewKpis (overviewDerive.js) applied fromMinor */
        wastedAmount={kpis.wasted}
        /* connector-derived, so the hero and the Wasted-spend card share a unit */
        currency={kpis.currency}
        workspace={workspace}
        /* LEARNING must tell "never synced" from "synced, nothing scorable" */
        hasAnyData={hasAnyData}
        /* …and BOTH of those from "has legacy rows the engine cannot read" */
        hasScorableData={hasScorableData}
        /* Lumi's briefing — folded in from the deleted standalone card */
        insight={insight}
        partial={overviewStatus === OVERVIEW_STATUS.PARTIAL}
      />
    ),

    [SLOT.ACT_NOW]: coreUsable && bands.actNow.length > 0
      ? <ActNowSection items={bands.actNow} total={bands.actNowTotal} />
      : null,

    // Open by default in WATCH_CLOSELY, where the watch band is the entire
    // answer the page has; collapsed elsewhere, where a KILL sits above it and
    // the engine has explicitly said "not yet" about these.
    [SLOT.WATCH]: coreUsable && bands.watchNow.length > 0
      ? <WatchSection items={bands.watchNow} total={bands.watchTotal} defaultOpen={accountState === 'WATCH_CLOSELY'} />
      : null,

    [SLOT.DOING_WELL]: coreUsable && bands.healthyCount > 0
      ? (
        <PerformingWellSection
          count={bands.healthyCount}
          spend={bands.healthySpend}
          currency={bands.healthyCurrency}
          spendStatus={bands.healthySpendStatus}
        />
      )
      : null,

    // NOT decisions: a campaign here is not performing badly, its revenue is
    // unmeasurable — and "never uploaded" is not "uploaded but now stale".
    [SLOT.REVENUE_NOTICES]: (coreUsable && hasAnyData && (needsRevenue.length > 0 || staleRevenue.length > 0))
      ? (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RevenueNotice type="needs" campaigns={needsRevenue} />
          <RevenueNotice type="stale" campaigns={staleRevenue} />
        </div>
      )
      : null,

    // Honest burn-rate (gated; refuses misleading single-channel pacing).
    [SLOT.PACING]: coreAvailable && hasAnyData ? <PacingWidget /> : null,

    [SLOT.KPIS]: coreAvailable && hasAnyData
      ? <KpiStrip kpis={kpis} killCount={killCount} healthLabel={healthLabel} healthTone={healthTone} />
      : null,

    // The role-scoped agenda + the ONE loop-status surface (the full ring, with
    // its stage strip and the single sweep trigger). Owns its own loading and
    // empty states.
    [SLOT.AGENDA]: coreAvailable && hasAnyData ? <AgenticShellView /> : null,

    // Account-aware Q&A. Cmd/Ctrl+K is intentionally NOT bound here — it is
    // already the global CommandPalette.
    [SLOT.COPILOT]: (
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
    ),

    [SLOT.CHANNELS]: <ConnectionHealthStrip compact state={{ data: connectionsData, loading: connectionsLoading, error: connectionsError }} />,
    [SLOT.CALIBRATION]: <CalibrationSection surface={proofSurface} compact />,
  };

  const render = (ids) => ids.map((id) => <Fragment key={id}>{slots[id]}</Fragment>);

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
          {/* The hero is always first, then the interrupt, then the rest of the
              plan — so a nudge never outranks the account's own answer. */}
          {render(plan.main.slice(0, 1))}
          {overviewStatus === OVERVIEW_STATUS.PARTIAL && (
            <p role="status" className="mb-4 text-sm text-lumi-muted">
              Some Overview information couldn’t be loaded. Available results are shown below.
            </p>
          )}
          {plan.interrupt && interrupts[plan.interrupt]}
          {render(plan.main.slice(1))}

          {/* ── Below the fold: the supporting detail this state did not promote.
                 Nothing is removed by state; it is only ranked lower. ── */}
          {render(plan.deferred)}
        </div>

        {/* ── RIGHT RAIL — status, not metrics ──────────────────
            Short read-only strips answering "why does the page say what it
            says": is data still flowing, and how well-calibrated are past
            calls. Sticky from lg up so they stay visible while the decisions
            scroll. Nothing here mutates. */}
        <aside className="mt-6 space-y-4 lg:mt-0 lg:sticky lg:top-6">
          {render(plan.rail)}
        </aside>
      </div>
    </div>
  );
}
