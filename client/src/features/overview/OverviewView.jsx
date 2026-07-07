// ============================================================
// MARCOM — Home Page (Account Pulse)
// ============================================================
// The operational home: account-health stats + the Phase-9 agentic shell (the
// real two-band agenda from getHome, role-scoped). The old ad-hoc Alerts /
// AI-Insight / Quick-Actions panels — which derived "alerts" from the campaign
// feed — are gone; the agenda IS the prioritized, evidence-backed action list.
// ============================================================
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Target, AlertTriangle, Activity,
  ArrowRight, Plug,
} from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';
import StatCard from '@/components/ui/StatCard.jsx';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import { ProofSummary } from '@/features/intelligence/proof/ProofView.jsx';
import AgenticShellView from './AgenticShellView.jsx';
import ConnectionHealthStrip from './components/ConnectionHealthStrip.jsx';
import PacingWidget from './components/PacingWidget.jsx';
import CopilotTeaser from './components/CopilotTeaser.jsx';

export default function OverviewView() {
  const { currentUser } = useAuth();
  const { workspace } = useWorkspace();
  const { campaigns, summary, loading: intelligenceLoading } = useIntelligence();
  const { campaigns: connectorCampaigns, loading: connectorLoading } = useConnectorCampaigns();
  const { surface: proofSurface } = useAccuracy(); // gated proof one-liner (best-effort)
  const { role: collabRole } = useCollabRole();

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const userName = currentUser?.displayName?.split(' ')[0] || 'there';

  // Currency detection from workspace (defaults to USD)
  const currency = workspace?.currency || 'USD';

  // Extract stats from intelligence summary
  const stats = {
    spend: summary?.spend > 0 ? formatCurrencyWhole(summary.spend, currency) : '—', // no real spend → honest dash, never the onboarding spendTier range

    cpa: summary?.blendedCpa ? formatCurrencyWhole(summary.blendedCpa, currency) : 'No data',
    waste: summary?.wasted > 0 ? `${formatCurrencyWhole(summary.wasted, currency)}/mo` : '$0/mo',
    health: summary?.health || 0,
  };

  // Account-health label + tone derived from the real score (no hardcoded verdict).
  const healthTone  = stats.health >= 75 ? 'positive'
                    : stats.health >= 50 ? 'warn'
                    : stats.health > 0   ? 'danger' : 'neutral';
  const healthLabel = stats.health >= 75 ? 'Healthy'
                    : stats.health >= 50 ? 'Fair — review soon'
                    : stats.health > 0   ? 'Needs attention' : 'No score yet';

  // Real count of KILL-verdict ad sets (traces to campaign alerts — no fabricated count).
  const killCount = useMemo(
    () => campaigns.reduce(
      (n, c) => n + (c.alerts || []).filter((a) => a.analysis?.verdict === 'KILL').length,
      0,
    ),
    [campaigns],
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
  const showCopilotTeaser = collabRole !== WORKSPACE_ROLE.CLIENT; // CLIENT home stays read-only & minimal

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      {/* Header */}
      <header className="mb-6">
        <div className="font-mono text-[11px] tracking-[0.08em] uppercase text-dark-muted mb-2 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          Account Pulse · {workspace?.name || 'Workspace'}
        </div>
        <h1 className="font-display font-bold text-4xl tracking-tight text-dark-base">
          {greeting}, {userName}. Here&apos;s your account pulse.
        </h1>
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

      {/* Empty state: only when BOTH substrates are empty (no legacy feed AND no
          connector data) — a genuinely un-synced account. */}
      {!loading && !hasAnyData && (
        <div className="flex flex-col items-center justify-center min-h-[480px] p-10 bg-surface-card border border-dashed border-surface-border-strong rounded-xl text-center">
          <div className="w-16 h-16 rounded-xl bg-lumi-accent/10 text-lumi-accent flex items-center justify-center mb-4">
            <Plug className="w-7 h-7" strokeWidth={1.5} />
          </div>
          <div className="font-display font-bold text-lg text-dark-base mb-2">
            No campaign data yet
          </div>
          <p className="text-[14px] text-dark-soft max-w-[440px] leading-relaxed mb-6">
            Connect your Meta Ads account to unlock account pulse, AI insights, and automated recommendations.
          </p>
          {/* Primary path for a new user: the OAuth connection flow. */}
          <Link
            to={appRoutes.settingsIntegrations}
            className="flex items-center gap-2 px-5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
          >
            <Plug className="w-4 h-4" strokeWidth={1.5} />
            Connect your Meta account
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      )}

      {/* Legacy stat block — derived from the CampaignState summary. Stays bound
          to the legacy feed; we never fabricate these figures from connector rows
          (the substrates are deliberately disjoint). */}
      {hasData && (
        <>
          {/* Budget pacing — honest burn-rate (gated; refuses misleading single-channel pacing). */}
          <PacingWidget />

          {/* 4 stat cards - responsive: 1 col mobile, 2 col tablet, 4 col desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
            <StatCard
              label="Total spend"
              value={stats.spend}
              sub="last 30 days"
              Icon={BarChart}
              tone="neutral"
            />
            <StatCard
              label="Blended CPA"
              value={stats.cpa}
              sub="across active campaigns"
              Icon={Target}
              tone="neutral"
            />
            <StatCard
              label="Wasted spend"
              value={stats.waste}
              sub={killCount > 0 ? `${killCount} KILL-verdict ad set${killCount === 1 ? '' : 's'}` : 'flagged for review'}
              Icon={AlertTriangle}
              tone="danger"
            />
            <StatCard
              label="Account health"
              value={`${stats.health}/100`}
              sub={healthLabel}
              Icon={Activity}
              tone={healthTone}
              gauge={stats.health}
            />
          </div>
        </>
      )}

      {/* The agentic shell — the real, role-scoped two-band agenda + loop status.
          Renders on EITHER substrate so a live-synced workspace (connector
          verdicts, empty legacy feed) still sees its agenda. Owns its own
          loading/empty states, so it's safe to mount whenever data exists. */}
      {hasAnyData && <AgenticShellView />}

      {/* Lumi Copilot — an honest "coming soon" teaser (not for the read-only
          CLIENT seat). Renders in every data state for operators. */}
      {showCopilotTeaser && (
        <div className="mt-6">
          <CopilotTeaser />
        </div>
      )}
    </div>
  );
}
