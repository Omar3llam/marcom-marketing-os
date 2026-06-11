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
import { useState } from 'react';
import { Outlet }   from 'react-router-dom';
import Sidebar      from './Sidebar.jsx';
import ContextBar   from './ContextBar.jsx';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { useRecentDecisions } from '@/features/shell';
import { RoleProvider } from '@/context/RoleContext.jsx';
import MarcomAIMark, { MarcomAIWordmark } from '@/components/brand/MarcomAIMark.jsx';

export default function MainLayout() {
  return (
    <RoleProvider>
      <MainLayoutShell />
    </RoleProvider>
  );
}

function MainLayoutShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: recentDecisions = [] } = useRecentDecisions();

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
            <MarcomAIMark size="sm" title="MarcomAI" />
            <MarcomAIWordmark className="text-lg" />
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
