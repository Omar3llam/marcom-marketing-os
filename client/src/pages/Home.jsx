// ============================================================
// MARCOM — Home Page (Account Pulse)
// ============================================================
// Replaces/enhances Command Hub with operational dashboard.
// Shows: account health stats, alerts, AI insights, quick actions
// ============================================================
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Target, AlertTriangle, Activity,
  Brain, Zap, ArrowRight, Upload, Play,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import StatCard from '@/components/ui/StatCard.jsx';
import Panel from '@/components/ui/Panel.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';

export default function HomePage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { workspace } = useWorkspace();
  const { campaigns, summary, loading: intelligenceLoading } = useIntelligence();

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const userName = currentUser?.displayName?.split(' ')[0] || 'there';

  // Currency formatter
  const currency = workspace?.currency || 'USD';
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Extract stats from intelligence summary
  const stats = {
    spend: summary?.spend > 0 ? formatCurrency(summary.spend) : workspace?.spendTier?.split(' ').slice(0, 2).join(' ') || '$0',
    cpa: summary?.blendedCpa ? formatCurrency(summary.blendedCpa) : 'No data',
    waste: summary?.wasted > 0 ? `${formatCurrency(summary.wasted)}/mo` : '$0/mo',
    health: summary?.health || 0,
  };

  // Extract high-priority alerts (KILL and HIGH-IMPACT HOLD verdicts)
  const highAlerts = useMemo(() => {
    const alerts = [];
    for (const campaign of campaigns) {
      for (const alert of campaign.alerts || []) {
        const verdict = alert.analysis?.verdict;
        const rootCause = alert.analysis?.root_cause || 'No diagnosis';
        const metrics = alert.metrics || [];

        // Extract key metrics for signal text
        const spend = metrics.find(m => m.metric?.toLowerCase() === 'spend');
        const roas = metrics.find(m => m.metric?.toLowerCase() === 'roas');
        const ctr = metrics.find(m => m.metric?.toLowerCase() === 'ctr');

        const signalParts = [];
        if (roas?.trend) signalParts.push(`ROAS ${roas.trend} ${roas.value}`);
        if (ctr?.trend) signalParts.push(`CTR ${ctr.trend} ${ctr.value}`);
        const signal = signalParts.length > 0 ? signalParts.join(' · ') : rootCause;

        if (verdict === 'KILL' || (verdict === 'HOLD' && alert.priority === 'HIGH')) {
          alerts.push({
            id: alert.action_id || `${campaign.campaign_id}-${alerts.length}`,
            campaign: campaign.campaign_name || 'Unknown Campaign',
            signal,
            verdict: verdict || 'HOLD',
            alertData: alert,
          });
        }
      }
    }
    return alerts.slice(0, 3); // Top 3 alerts
  }, [campaigns]);

  // Extract recent activity (placeholder - will need decision/execution history API)
  const recentActivity = useMemo(() => {
    const activity = [];
    // For now, create activity from campaign alerts
    for (const campaign of campaigns.slice(0, 3)) {
      const alert = campaign.alerts?.[0];
      if (alert) {
        activity.push({
          id: alert.action_id || campaign.campaign_id,
          type: alert.analysis?.verdict === 'KILL' ? 'EXECUTION' : 'VERDICT',
          campaign: campaign.campaign_name || 'Unknown Campaign',
          action: alert.analysis?.verdict === 'KILL' ? 'Recommended pause' : `Recommended ${alert.analysis?.verdict}`,
          time: 'Recent', // TODO: Add timestamp from alert
          verdict: alert.analysis?.verdict,
        });
      }
    }
    return activity;
  }, [campaigns]);

  const loading = intelligenceLoading;
  const hasData = campaigns.length > 0;

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

      {/* Empty state: no campaigns uploaded yet */}
      {!loading && !hasData && (
        <div className="flex flex-col items-center justify-center min-h-[480px] p-10 bg-surface-card border border-dashed border-surface-border-strong rounded-xl text-center">
          <div className="w-16 h-16 rounded-xl bg-lumi-accent/10 text-lumi-accent flex items-center justify-center mb-4">
            <Upload className="w-7 h-7" strokeWidth={1.5} />
          </div>
          <div className="font-display font-bold text-lg text-dark-base mb-2">
            No campaign data yet
          </div>
          <p className="text-[14px] text-dark-soft max-w-[440px] leading-relaxed mb-6">
            Upload your first Meta Ads Manager CSV to unlock account pulse, AI insights, and automated recommendations.
          </p>
          <button
            onClick={() => navigate('/app/campaigns')}
            className="flex items-center gap-2 px-5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
          >
            <Upload className="w-4 h-4" strokeWidth={1.5} />
            Upload campaign data
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Dashboard content: only show when data exists */}
      {hasData && (
        <>
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
          sub="↓ 8% vs prev"
          Icon={Target}
          tone="positive"
        />
        <StatCard
          label="Wasted spend"
          value={stats.waste}
          sub="2 bleeding ad sets"
          Icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          label="Account health"
          value={`${stats.health}/100`}
          sub="Fair — needs review"
          Icon={Activity}
          tone="warn"
          gauge={stats.health}
        />
      </div>

      {/* 3-column row - responsive: 1 col mobile, 2 col tablet, 3 col desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6">
        <AlertsPanel
          alerts={highAlerts}
          onReviewAlert={(alert) => navigate('/app/campaigns')}
        />
        <AIInsightPanel
          workspace={workspace}
          topAlert={highAlerts[0]}
          onAct={() => navigate('/app/campaigns')}
        />
        <QuickActionsPanel
          onUploadCSV={() => navigate('/app/campaigns')}
          onStartFlow={() => navigate('/app/campaigns')}
        />
      </div>

          {/* Recent activity */}
          <ActivityFeed activity={recentActivity} loading={loading} />
        </>
      )}
    </div>
  );
}

// ── Alerts Panel ─────────────────────────────────────────────
function AlertsPanel({ alerts, onReviewAlert }) {
  return (
    <Panel
      title="Alerts"
      Icon={AlertTriangle}
      iconTone="kill"
      meta={`${alerts.length} high priority`}
    >
      {alerts.length === 0 ? (
        <EmptyPanel text="Nothing burning right now." Icon={AlertTriangle} />
      ) : (
        <div className="space-y-2">
          {alerts.slice(0, 3).map((alert) => (
            <button
              key={alert.id}
              onClick={() => onReviewAlert(alert)}
              aria-label={`Review alert for ${alert.campaign}: ${alert.signal}`}
              className="w-full flex items-center gap-2.5 p-3 bg-surface-elevated border border-surface-border hover:bg-surface-card
                         rounded-lg transition-colors text-left focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
              style={{ borderLeft: `3px solid var(--c-${alert.verdict.toLowerCase()})` }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-display font-semibold text-xs text-dark-base truncate">
                  {alert.campaign}
                </div>
                <div className="font-mono text-[10px] text-dark-muted mt-1">
                  {alert.signal}
                </div>
              </div>
              <VerdictPill verdict={alert.verdict} size="sm" showIcon={false} />
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── AI Insight Panel ─────────────────────────────────────────
function AIInsightPanel({ workspace, topAlert, onAct }) {
  if (!topAlert || !topAlert.alertData) {
    return (
      <Panel
        title="AI Insight"
        Icon={Brain}
        iconTone="gold"
        meta="no alerts"
      >
        <EmptyPanel text="No actionable insights right now. All campaigns look healthy!" Icon={Brain} />
      </Panel>
    );
  }

  const { campaign, alertData } = topAlert;
  const rootCause = alertData.analysis?.root_cause || 'Performance degradation detected';
  const actionPlan = alertData.action_plan || 'Review campaign metrics and consider adjustments.';

  return (
    <Panel
      title="AI Insight"
      Icon={Brain}
      iconTone="gold"
      meta="updated recently"
    >
      <div className="font-mono text-[10px] tracking-[0.08em] uppercase text-lumi-accent mb-2">
        Top recommendation
      </div>
      <p className="text-[13px] text-dark-soft leading-relaxed mb-3.5">
        Your <strong className="text-dark-base">{campaign}</strong> campaign: {rootCause}.
        {' '}{actionPlan}
      </p>
      <button
        onClick={onAct}
        aria-label="Review AI recommendation verdict"
        className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90
                   text-white rounded-lg transition-all duration-150 font-display font-semibold text-[13px] shadow-accent-glow
                   focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
      >
        <Zap className="w-3.5 h-3.5" strokeWidth={1.5} />
        Review verdict
        <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
    </Panel>
  );
}

// ── Quick Actions Panel ──────────────────────────────────────
function QuickActionsPanel({ onUploadCSV, onStartFlow }) {
  const actions = [
    { key: 'upload', label: 'Upload new data', icon: Upload, variant: 'primary' },
    { key: 'run', label: 'Run intelligence scan', icon: Play, variant: 'secondary' },
  ];

  return (
    <Panel
      title="Quick Actions"
      Icon={Zap}
      iconTone="gold"
      meta="shortcuts"
    >
      <div className="space-y-2">
        {actions.map((action) => (
          <button
            key={action.key}
            onClick={action.key === 'upload' ? onUploadCSV : onStartFlow}
            aria-label={action.label}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-150 font-display font-medium text-sm
              focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark ${
              action.variant === 'primary'
                ? 'bg-lumi-accent hover:bg-lumi-accent/90 text-white shadow-accent-glow'
                : 'bg-surface-elevated hover:bg-surface-card text-dark-base border border-surface-border'
            }`}
          >
            <action.icon className="w-4 h-4" strokeWidth={1.5} />
            {action.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ── Activity Feed ────────────────────────────────────────────
function ActivityFeed({ activity, loading }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-card">
      <h3 className="font-display font-semibold text-[15px] text-dark-base mb-4">
        Recent Activity
      </h3>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 pb-3 border-b border-surface-border last:border-0 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-surface-elevated flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-4 bg-surface-elevated rounded w-3/4" />
                <div className="h-3 bg-surface-elevated rounded w-1/2" />
              </div>
              <div className="h-4 w-16 bg-surface-elevated rounded" />
            </div>
          ))}
        </div>
      ) : activity.length === 0 ? (
        <EmptyPanel text="No recent activity yet." Icon={Activity} />
      ) : (
        <div className="space-y-3">
          {activity.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 pb-3 border-b border-surface-border last:border-0 last:pb-0"
          >
            <div
              className="w-8 h-8 rounded-lg bg-lumi-accent/10 flex items-center justify-center flex-shrink-0 text-lumi-accent"
            >
              {item.type === 'EXECUTION' ? (
                <Play className="w-4 h-4" strokeWidth={1.5} />
              ) : item.type === 'VERDICT' ? (
                <Brain className="w-4 h-4" strokeWidth={1.5} />
              ) : (
                <Upload className="w-4 h-4" strokeWidth={1.5} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-medium text-sm text-dark-base">
                {item.campaign}
              </div>
              <div className="text-xs text-dark-muted mt-0.5">{item.action}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-dark-subtle">{item.time}</span>
              {item.verdict && <VerdictPill verdict={item.verdict} size="sm" showIcon={false} />}
            </div>
          </div>
        ))}
        </div>
      )}
    </div>
  );
}
