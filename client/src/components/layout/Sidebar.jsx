// ============================================================
// MARCOM / Lumi — Sidebar (Enhanced with Figma Design)
// ------------------------------------------------------------
// 268px expanded, 64px collapsed. Features:
// - Lumi star mark + notification bell
// - Live "WATCHING" status + countdown timer
// - Cmd+K search affordance
// - Alert badges on nav items
// - Simplified navigation structure
// All icons stroke-width 1.5.
// ============================================================
import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Layout, BarChart3, Send,
  Settings, PanelLeftClose, Plus, Search, ChevronDown,
  Brain, FlaskConical, Microscope, Megaphone, FileText, Plug,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { usePlan } from '@/hooks/usePlan.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useConnections } from '@/hooks/useConnections.js';
import { usePendingApprovals } from '@/hooks/usePendingApprovals.js';
import { cn } from '@/lib/utils.js';
import NotificationBell from '@/components/ui/NotificationBell.jsx';
import InboxPanel from '@/features/inbox/InboxPanel.jsx';
import RecentDecisions from '@/components/ui/RecentDecisions.jsx';
import CommandPalette from '@/components/ui/CommandPalette.jsx';
import RadarStrip from './RadarStrip.jsx';
import { appRoutes } from '@/app/routeManifest.js';
import LumiStar from '@/components/brand/LumiStar.jsx';

// Simplified navigation structure from Figma. Two orthogonal gates:
//   • `roles` (optional) gates an item to the listed collabRoles; absent =
//     visible to all. CLIENT is a read-only stakeholder — its only operator
//     surface is Reports (+ Settings), so the operator items carry a `roles`
//     constraint and never render for a CLIENT (no wall of locked items).
//   • `plan` gates an item to a workspace entitlement (FREE | GROWTH | PRO). A
//     role-visible item BELOW the workspace's plan renders LOCKED (dimmed +
//     upgrade tooltip) rather than hidden — that's the deliberate upsell.
// Ordered FREE → GROWTH → PRO. Reports is ungated on both axes (every role +
// every plan reads the reasoned narrative; it's the CLIENT seat's home).
// Exported so the nav copy can be asserted without booting the whole shell
// (Sidebar itself needs auth + plan + router context to render).
export const tools = [
  // ── FREE — always unlocked ──────────────────────────────────
  { key: 'overview',     label: 'Home',         sub: 'Your daily pulse',       icon: Layout,       path: appRoutes.overview,     roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
  { key: 'campaigns',    label: 'Campaigns',    sub: 'Decision queue',        icon: BarChart3,    path: appRoutes.campaigns,    roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
  { key: 'content',      label: 'Creative Optimizer', sub: 'Improve creative performance', icon: Send,   path: appRoutes.contentLab,   roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
  { key: 'leadership',   label: 'Reports',      sub: 'Weekly narratives',      icon: FileText,     path: appRoutes.leadership,   plan: 'FREE' },
  // ── GROWTH — locked on FREE ─────────────────────────────────
  { key: 'intelligence', label: 'Intelligence', sub: 'Truth, insights, proof', icon: Brain,        path: appRoutes.intelligence, roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH' },
  { key: 'publishing',   label: 'Publishing',   sub: 'Content approvals',      icon: Megaphone,    path: appRoutes.publishing,   roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH' },
  // ── PRO — locked on FREE / GROWTH ───────────────────────────
  { key: 'testing',      label: 'Testing',      sub: 'A/B experiments',        icon: FlaskConical, path: appRoutes.testing,      roles: ['STRATEGIST', 'BUYER'], plan: 'PRO' },
  { key: 'measure',      label: 'Measurement',  sub: 'Scenarios + holdouts',   icon: Microscope,   path: appRoutes.measure,      roles: ['STRATEGIST', 'BUYER'], plan: 'PRO' },
  // Copilot is demoted from the primary nav while it's a static placeholder — it
  // now lives as a teaser card in Overview. The /app/copilot route stays
  // reachable by direct URL (see App.jsx); restore this line to re-promote it.
];

// ══════════════════════════════════════════════════════════════
// WorkspaceHQ — Enhanced with live status from Figma
// ══════════════════════════════════════════════════════════════
function WorkspaceHQ({ workspace, onNewProject }) {
  const [open, setOpen] = useState(false);

  // Generate 2-letter initials from company name
  const initials = workspace.name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'WS';

  return (
    <div className="px-3">
      {/* HQ Card with corner glow */}
      <div
        className="rounded-xl border border-lumi-border bg-lumi-elevated p-3 relative overflow-hidden"
        style={{
          boxShadow: '0 0 20px rgba(246,201,69,0.08)',
        }}
      >
        {/* Gold corner glow */}
        <div
          className="absolute top-0 right-0 w-16 h-16 opacity-20"
          style={{
            background: 'radial-gradient(circle at top right, var(--c-gold-glow), transparent)',
          }}
        />

        {/* Company header */}
        <div className="flex items-start gap-2.5 mb-3 relative">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-lumi-accent to-lumi-accent/70 flex items-center justify-center flex-shrink-0 shadow-accent-glow">
            <span className="text-sm font-display font-bold text-lumi-bg">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-display font-semibold text-lumi-text truncate">
              {workspace.name}
            </div>
            <div className="text-xs text-lumi-subtle mt-0.5 font-mono">
              Market: <span className="text-lumi-muted">{workspace.market || 'EG'}</span>
            </div>
          </div>
        </div>

        {/* Live WATCHING status */}
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-signal-scale-bg">
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-signal-scale"
              style={{ animation: 'pulse 2s ease-in-out infinite' }}
            />
            <span className="font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-signal-scale">
              WATCHING
            </span>
          </div>
          {workspace.adSetsCount && (
            <span className="font-mono text-[10px] text-dark-soft">
              · {workspace.adSetsCount} ad sets
            </span>
          )}
        </div>

        {/* Actions */}
        <button
          onClick={() => setOpen((p) => !p)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg
                     text-xs text-lumi-muted hover:text-lumi-text hover:bg-lumi-surface
                     transition-colors duration-100"
        >
          <span className="font-display font-medium">Manage</span>
          <ChevronDown
            className={cn('w-3 h-3 transition-transform duration-150', open && 'rotate-180')}
            strokeWidth={1.5}
          />
        </button>

        {open && (
          <div className="mt-2 pt-2 border-t border-lumi-border animate-slide-up">
            <button
              onClick={() => { setOpen(false); onNewProject(); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
                         text-xs text-lumi-muted hover:text-lumi-accent hover:bg-lumi-accent-soft
                         transition-colors duration-100"
            >
              <Plus className="w-3 h-3" strokeWidth={1.5} />
              <span className="font-display font-medium">New Workspace</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({
  collapsed,
  onToggle,
  alertsData = [],
  recentDecisions = [],
  mobileMenuOpen = false,
  onMobileMenuToggle,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentUser } = useAuth();
  const { role: collabRole } = useCollabRole();
  const { canAccess, loading: planLoading } = usePlan();
  const { workspace, hasWorkspace, loading: workspaceLoading } = useWorkspace();
  const { data: connectionsData, loading: connectionsLoading } = useConnections();

  // Role- AND plan-gated navigation. An item hides if the seat's role can't see
  // it OR the workspace's plan doesn't reach it — locked items are hidden
  // completely, never shown with a lock. Plan is only enforced once loaded
  // (planLoading ⇒ show), so a paying operator never sees items flash away
  // mid-load. Filtering here also keeps locked items out of the ⌘K palette,
  // which reads navItems.
  const navItems = tools.filter(
    (t) => roleAllowed(collabRole, t.roles) && (planLoading || canAccess(t.plan)),
  );

  // Publishing approval badge: count of artifacts awaiting approval (the same
  // usePendingApprovals feed the Publishing page uses — NOT plan approvals). Only
  // an operator seat has a Publishing surface, so a CLIENT never fetches. Suppress
  // the badge while already on Publishing (the page shows its own live count, and
  // this sidebar count doesn't refetch after they clear the queue).
  const canPublish = roleAllowed(collabRole, ['STRATEGIST', 'BUYER']);
  const { pending: pendingApprovals } = usePendingApprovals({ enabled: canPublish });
  const onPublishing = pathname.startsWith(appRoutes.publishing);
  const pendingApprovalCount = onPublishing ? 0 : pendingApprovals.length;

  // Discoverability: a highlighted "Connect a channel" entry, shown ONLY until the
  // first channel connects (self-hiding — existing users never see it). Operators
  // only; a read-only CLIENT can't connect. Reads the same real Integration rows
  // the Channels page uses, so it disappears the moment a connection lands.
  const hasConnector = (connectionsData?.connections ?? []).some((c) => c.connected);
  const showConnectCTA = roleAllowed(collabRole, ['STRATEGIST', 'BUYER']) && !connectionsLoading && !hasConnector;

  // UI state
  const [notifOpen, setNotifOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((p) => !p);
      } else if (e.key === 'Escape') {
        setCmdkOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // High-priority alerts for notification bell
  const highAlerts = alertsData.filter((a) => a.priority === 'HIGH');
  const alertCount = highAlerts.length;

  // Alert counts per nav item
  const alertsByKey = { overview: alertCount, publishing: pendingApprovalCount };

  const initial = (currentUser?.displayName?.[0] || currentUser?.email?.[0] || 'L').toUpperCase();
  const userLabel = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User';

  // Workspace display name (fallback for loading/empty states)
  const workspaceName = workspaceLoading
    ? 'Loading...'
    : workspace?.name || 'No Project';

  return (
    <>
    <aside
      className={cn(
        'flex flex-col h-full bg-lumi-surface border-r border-lumi-border',
        'transition-all duration-200 ease-out',
        // Visibility: closed on mobile = hidden; open = flex so the transform
        // below can actually slide the drawer in (display:none defeats translate).
        // lg+ always shows — via lg:flex when closed, base flex when open.
        mobileMenuOpen ? 'flex' : 'hidden lg:flex',
        'flex-shrink-0',
        collapsed ? 'lg:w-[64px]' : 'lg:w-[268px]',
        // Mobile: drawer overlay
        'lg:relative fixed inset-y-0 left-0 z-50',
        'lg:translate-x-0',
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        // Mobile always expanded width
        'w-[268px]',
      )}
    >
      {/* ── HEADER with Lumi star + notifications ─────────── */}
      <div className={cn(
        'flex items-center h-14 border-b border-lumi-border flex-shrink-0 relative',
        collapsed ? 'justify-center px-2' : 'justify-between px-3.5',
      )}>
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : undefined}
          className="flex items-center gap-2 group"
          title={collapsed ? 'Expand sidebar' : undefined}
        >
          <LumiStar
            size="md"
            title="Lumi"
            className={collapsed ? 'h-[30px] w-[30px]' : 'h-[34px] w-[34px]'}
          />
          {!collapsed && (
            <span className="font-display font-bold text-[18px] text-lumi-accent tracking-tight">
              LUMI
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="flex items-center gap-0.5">
            <NotificationBell
              alertCount={alertCount}
              open={notifOpen}
              onToggle={() => setNotifOpen((p) => !p)}
            >
              {/* The bell now opens the role-routed Inbox (radar verdicts +
                  pending approvals + latest report), fetched live on open. */}
              <InboxPanel
                onClose={() => setNotifOpen(false)}
                onNavigate={(path) => { navigate(path); onMobileMenuToggle?.(); }}
              />
            </NotificationBell>

            {/* Desktop: collapse button, Mobile: close button */}
            <button
              onClick={onMobileMenuToggle || onToggle}
              aria-label={onMobileMenuToggle ? 'Close menu' : 'Collapse sidebar'}
              className="p-1.5 rounded-lg text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated transition-colors duration-150"
            >
              <PanelLeftClose className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      {/* ── SCROLL ───────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden py-3 gap-1">

        {/* Cmd+K Search affordance */}
        {!collapsed && (
          <div className="px-3 mb-3">
            <button
              onClick={() => setCmdkOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 bg-lumi-elevated border border-lumi-border rounded-lg
                         text-lumi-muted hover:border-lumi-accent/40 hover:bg-lumi-surface transition-all duration-150"
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.5} />
              <span className="flex-1 text-left text-xs text-lumi-subtle font-body">
                Search decisions…
              </span>
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-lumi-border bg-lumi-surface text-lumi-muted tracking-wider">
                ⌘K
              </span>
            </button>
          </div>
        )}

        {/* WorkspaceHQ (expanded) */}
        {!collapsed && hasWorkspace && workspace && (
          <WorkspaceHQ
            workspace={workspace}
            onNewProject={() => navigate('/onboarding')}
          />
        )}

        {/* Fallback: No workspace (expanded) */}
        {!collapsed && !hasWorkspace && !workspaceLoading && (
          <div className="px-3 mt-2">
            <div className="section-label mb-2 px-1">Workspace</div>
            <button
              onClick={() => navigate('/onboarding')}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                         border border-dashed border-lumi-border hover:border-lumi-accent
                         bg-transparent hover:bg-lumi-accent-soft/30 transition-all duration-150"
            >
              <Plus className="w-4 h-4 text-lumi-muted" strokeWidth={1.5} />
              <span className="text-sm font-display font-medium text-lumi-muted">Create Workspace</span>
            </button>
          </div>
        )}

        {/* Loading state (expanded) */}
        {!collapsed && workspaceLoading && (
          <div className="px-3 mt-2">
            <div className="section-label mb-2 px-1">Workspace</div>
            <div className="px-3 py-2.5 text-xs text-lumi-subtle">Loading...</div>
          </div>
        )}

        {/* Project dot (collapsed) */}
        {collapsed && (
          <div className="flex justify-center px-2 mt-2" title={workspaceName}>
            <span className={cn(
              'w-2 h-2 rounded-full',
              hasWorkspace ? 'bg-signal-scale' : 'bg-lumi-subtle',
            )} />
          </div>
        )}

        {/* Navigation */}
        <div className={cn('mt-3', collapsed ? 'px-2' : 'px-3')}>
          {!collapsed && (
            <div className="section-label px-1 mb-2">Navigation</div>
          )}

          {navItems.map((tool) => {
            const badge = alertsByKey[tool.key];
            return (
              <NavLink
                key={tool.path}
                to={tool.path}
                title={collapsed ? tool.label : undefined}
                onClick={() => onMobileMenuToggle?.()} // Close mobile menu on navigation
                className={({ isActive }) => cn(
                  'flex items-center gap-3 rounded-xl transition-all duration-150 mb-0.5 text-sm group relative',
                  collapsed ? 'justify-center p-3' : 'px-3 py-2.5',
                  isActive
                    ? 'border-l-2 border-lumi-accent bg-lumi-accent/5 text-lumi-accent font-medium'
                    : 'border-l-2 border-transparent text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated/60',
                )}
              >
                {({ isActive }) => (
                  <>
                    <tool.icon
                      className={cn(
                        'flex-shrink-0',
                        collapsed ? 'w-5 h-5' : 'w-4 h-4',
                        isActive && 'text-lumi-accent',
                      )}
                      strokeWidth={1.5}
                    />
                    {!collapsed && (
                      <div className="flex-1 min-w-0 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            'font-display font-medium text-sm leading-tight truncate',
                            isActive && 'font-semibold',
                          )}>
                            {tool.label}
                          </div>
                          <div className="text-xs text-lumi-subtle truncate mt-0.5">{tool.sub}</div>
                        </div>
                        {badge > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded-full bg-signal-kill text-white text-[10px] font-mono font-semibold">
                            {badge > 9 ? '9+' : badge}
                          </span>
                        )}
                      </div>
                    )}
                    {collapsed && badge > 0 && (
                      <span
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-signal-kill"
                        style={{ boxShadow: '0 0 4px var(--c-kill)' }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}

          {/* Connect-a-channel shortcut — solves the "no main-nav entry to
              Integrations" gap for new users; self-hides after the first connect. */}
          {showConnectCTA && (
            <NavLink
              to={appRoutes.settingsIntegrations}
              title={collapsed ? 'Connect a channel' : undefined}
              onClick={() => onMobileMenuToggle?.()}
              className={cn(
                'flex items-center gap-3 rounded-xl transition-all duration-150 mt-1 text-sm',
                'border border-lumi-accent/40 bg-lumi-accent-soft/30 text-lumi-accent hover:bg-lumi-accent-soft/50',
                collapsed ? 'justify-center p-3' : 'px-3 py-2.5',
              )}
            >
              <Plug className={cn('flex-shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} strokeWidth={1.5} />
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold text-sm leading-tight truncate">Connect a channel</div>
                  <div className="text-xs text-lumi-accent/70 truncate mt-0.5">Start here</div>
                </div>
              )}
            </NavLink>
          )}
        </div>

        {/* Recent Decisions with sparkline (expanded only) */}
        {!collapsed && (
          <div className="mt-4">
            <RecentDecisions
              decisions={recentDecisions}
              totalCount={recentDecisions.length}
              onViewAll={() => navigate(appRoutes.overview)}
            />
          </div>
        )}
      </div>

      {/* ── RADAR STRIP (live countdown + alert pulse) ─────── */}
      {!collapsed && (
        <RadarStrip hasHighAlerts={alertCount > 0} />
      )}

      {/* ── FOOTER with online status ──────────────────────── */}
      <div className={cn(
        'flex-shrink-0 border-t border-lumi-border p-3',
        collapsed ? 'flex flex-col items-center gap-2' : 'space-y-1',
      )}>
        <NavLink
          to={appRoutes.settings}
          title={collapsed ? 'Settings' : undefined}
          aria-label="Settings"
          onClick={() => onMobileMenuToggle?.()} // Close mobile menu on navigation
          className={({ isActive }) => cn(
            'flex items-center gap-2.5 rounded-xl transition-all duration-150',
            collapsed ? 'p-2.5' : 'w-full px-3 py-2 text-sm',
            isActive
              ? 'border-l-2 border-lumi-accent bg-lumi-accent/5 text-lumi-accent font-medium'
              : 'border-l-2 border-transparent text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated/60',
          )}
        >
          <Settings className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
          {!collapsed && <span className="font-body text-[13px]">Settings</span>}
        </NavLink>

        <div className={cn('flex items-center gap-2.5', collapsed ? 'mt-1' : 'px-3 py-2 mt-1')}>
          <div className="relative w-7 h-7 rounded-full bg-lumi-accent/20 border border-lumi-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-display font-bold text-lumi-accent">{initial}</span>
            {/* Online dot */}
            <span
              className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-signal-scale border-2 border-lumi-surface"
              style={{ boxShadow: '0 0 4px rgba(16,185,129,0.5)' }}
            />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-display font-medium text-lumi-text truncate">{userLabel}</div>
              <div className="text-[10px] text-lumi-subtle truncate">
                <span className="font-mono">Operator · {workspace?.market || 'EG'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>

    {/* ⌘K / Ctrl+K command palette — rendered outside <aside> so its
        fixed overlay isn't clipped by the sidebar's transform. */}
    <CommandPalette
      open={cmdkOpen}
      onClose={() => setCmdkOpen(false)}
      navItems={navItems}
      decisions={recentDecisions}
      onNavigate={(path) => { navigate(path); onMobileMenuToggle?.(); }}
    />
    </>
  );
}
