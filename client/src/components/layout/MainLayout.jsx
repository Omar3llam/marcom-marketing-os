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
import { useRecentDecisions } from '@/features/shell';
import { RoleProvider, ROLE_READ } from '@/context/RoleContext.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import RoleUnavailable from '@/components/auth/RoleUnavailable.jsx';
import { FullscreenLoader } from '@/router/ProtectedRoute.jsx';
import LumiStar from '@/components/brand/LumiStar.jsx';

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
  const { status: roleStatus, canRetry, refetch } = useCollabRole();

  // ── THE ROLE BOUNDARY (Phase 5.11) ───────────────────────────
  // Nothing inside this shell renders until the seat is KNOWN.
  //
  // It is one gate here rather than nineteen at the consumers because that is
  // where the rule actually lives: eight surfaces decide operator-vs-client by
  // testing `role === CLIENT`, so a null role would fall into the OPERATOR
  // branch in every one of them — a fail-open dressed as a fix. Holding the
  // shell is the only boundary that makes "do not expose operator navigation
  // while the role is pending" true of the sidebar, the ⌘K palette, the write
  // controls and the pages at once.
  //
  // The cost is honest and deliberate: one loading state before any app
  // content, where before the shell rendered and the seat arrived late.
  if (roleStatus === ROLE_READ.LOADING) {
    return <FullscreenLoader label="Checking your access…" />;
  }
  if (roleStatus !== ROLE_READ.PRESENT) {
    // Not a redirect: routing on an unknown seat is the same guess, one layer
    // down. The route is preserved and the reason is stated.
    return <RoleUnavailable status={roleStatus} canRetry={canRetry} onRetry={refetch} />;
  }

  // FE-03 — `highPriorityAlerts` was built here from
  // campaigns[].alerts[] off the legacy CampaignState feed, and fed the
  // Sidebar's `alertsData` → the notification-bell count and the Attention
  // nav badge. S1-B deleted that array, so the count has been 0 for every
  // workspace on every render.
  //
  // Removed rather than repointed. The badge is a MISSING SIGNAL now, not a
  // false one — a count of nothing is not a claim that there is nothing to do,
  // because the number simply never appears. Rebuilding it over the connector
  // verdicts is a feature (which band counts? whose seat?) and belongs to a
  // slice that rules on it, not to a repoint. Sidebar already defaults
  // `alertsData = []`.

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
            <LumiStar size="sm" title="Lumi" />
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
