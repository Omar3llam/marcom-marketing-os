// ============================================================
// MARCOM / Lumi — MainLayout
// ------------------------------------------------------------
// Three-region shell:
//   ┌──────┬─────────────────────────────────┐
//   │      │                                 │
//   │ Side │   <Outlet />                    │
//   │ bar  │                                 │
//   │      ├─────────────────────────────────┤
//   │      │   ContextBar (44px)             │
//   └──────┴─────────────────────────────────┘
// ============================================================
import { useState, useEffect } from 'react';
import { Outlet }   from 'react-router-dom';
import Sidebar      from './Sidebar.jsx';
import ContextBar   from './ContextBar.jsx';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { api } from '@/lib/api.js';

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recentDecisions, setRecentDecisions] = useState([]);

  // Fetch campaign feed for high-priority alerts
  const { campaigns } = useCampaignFeed();

  // Extract high-priority alerts from campaigns feed
  const highPriorityAlerts = campaigns.flatMap((campaign) =>
    (campaign.alerts || [])
      .filter((alert) => alert.priority === 'HIGH')
      .map((alert) => ({
        id: alert.action_id,
        campaign: campaign.campaign_name || campaign.campaign_id,
        signal: alert.analysis?.diagnosis || 'No diagnosis available',
        verdict: alert.analysis?.verdict || 'HOLD',
        priority: alert.priority,
        timestamp: alert.created_at || 'recent',
      }))
  );

  // Fetch recent decisions from memory API
  useEffect(() => {
    let cancelled = false;
    const fetchDecisions = async () => {
      try {
        const response = await api.get('/api/memory/patterns');
        if (cancelled) return;

        const narratives = response.data?.narratives || [];
        const decisions = narratives.map((n) => ({
          id: n.id,
          campaign: n.line.split('—')[0]?.trim() || 'Unknown',
          verdict: n.line.includes('KILL') ? 'KILL'
                 : n.line.includes('SCALE') ? 'SCALE'
                 : n.line.includes('HOLD') ? 'HOLD'
                 : 'TEST',
          timestamp: formatTimestamp(n.recorded),
        }));
        setRecentDecisions(decisions);
      } catch (err) {
        console.error('[MainLayout] Failed to fetch recent decisions:', err);
        // Silent fail - empty state will be shown
      }
    };
    fetchDecisions();
    return () => { cancelled = true; };
  }, []);

  // Format timestamp as relative time
  const formatTimestamp = (date) => {
    if (!date) return 'recent';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-lumi-bg">
      {/* Skip to main content link - accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-lumi-accent focus:text-white focus:rounded-lg focus:shadow-accent-glow font-display font-semibold text-sm"
      >
        Skip to main content
      </a>

      {/* Mobile menu backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-dark-base/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        alertsData={highPriorityAlerts}
        recentDecisions={recentDecisions}
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuToggle={() => setMobileMenuOpen((m) => !m)}
        aria-label="Main navigation"
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile header with hamburger */}
        <header className="lg:hidden h-14 border-b border-lumi-border bg-lumi-surface flex items-center justify-between px-4 flex-shrink-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 text-lumi-muted hover:text-lumi-text"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <img
              src="/assets/lumi-mascot.png"
              alt="Lumi"
              className="w-7 h-7"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(246,201,69,0.3))' }}
            />
            <span className="font-display font-bold text-lg text-lumi-accent tracking-tight">
              LUMI
            </span>
          </div>
          <div className="w-9" /> {/* Spacer for centering */}
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          role="main"
          aria-label="Main content"
          className="flex-1 overflow-y-auto overflow-x-hidden focus:outline-none"
        >
          <Outlet />
        </main>
        <ContextBar />
      </div>
    </div>
  );
}
