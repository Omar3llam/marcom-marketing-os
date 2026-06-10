// ============================================================
// MARCOM / Lumi — Sidebar (Enhanced with Figma Design)
// ------------------------------------------------------------
// 268px expanded, 64px collapsed. Features:
// - Lumi mascot image + notification bell
// - Live "WATCHING" status + countdown timer
// - Cmd+K search affordance
// - Alert badges on nav items
// - Simplified navigation structure
// All icons stroke-width 1.5.
// ============================================================
import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Layout, BarChart3, Target, Send, CalendarDays, Activity,
  Settings, PanelLeftClose, Plus, Search, ChevronDown, Radar,
  Scale, Gauge, Plug,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { cn } from '@/lib/utils.js';
import NotificationBell from '@/components/ui/NotificationBell.jsx';
import NotificationPopover from '@/components/ui/NotificationPopover.jsx';
import RecentDecisions from '@/components/ui/RecentDecisions.jsx';
import CommandPalette from '@/components/ui/CommandPalette.jsx';
import RadarStrip from './RadarStrip.jsx';

// Simplified navigation structure from Figma. `roles` (optional) gates an item
// to the listed collabRoles; absent = visible to all (backwards-compatible).
const tools = [
  { key: 'home',       label: 'Home',         sub: 'Account pulse',                icon: Layout,        path: '/app/home'             },
  { key: 'campaigns',  label: 'Campaigns',    sub: 'Verdicts + diagnosis',         icon: BarChart3,     path: '/app/campaigns'        },
  { key: 'truth',      label: 'Blended Truth',sub: 'Platform claims vs reality',   icon: Scale,         path: '/app/truth',           roles: ['STRATEGIST', 'BUYER'] },
  { key: 'proof',      label: 'Proof',        sub: 'Is Lumi getting sharper?',     icon: Gauge,         path: '/app/proof'            },
  { key: 'content',    label: 'Content Lab',  sub: 'Copy + visual generation',     icon: Send,          path: '/app/content'          },
  { key: 'growth',     label: 'Growth',       sub: 'Memory layer + opportunities', icon: Target,        path: '/app/growth'           },
  { key: 'calendar',   label: 'Calendar',     sub: '4-week content plan',          icon: CalendarDays,  path: '/app/tools/calendar'   },
  { key: 'connections',label: 'Channels',     sub: 'Connected data sources',       icon: Plug,          path: '/app/connections',     roles: ['STRATEGIST', 'BUYER'] },
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
  const { currentUser } = useAuth();
  const { role: collabRole } = useCollabRole();
  const { workspace, hasWorkspace, loading: workspaceLoading } = useWorkspace();

  // Role-gated navigation — items with a `roles` constraint hide for other roles.
  const navItems = tools.filter((t) => roleAllowed(collabRole, t.roles));

  // UI state
  const [notifOpen, setNotifOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Live countdown timer (60 seconds loop)
  const [countdown, setCountdown] = useState(47);
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((s) => (s <= 1 ? 60 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
  const alertsByKey = { home: alertCount };

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
        // Desktop: normal sidebar behavior
        'hidden lg:flex flex-shrink-0',
        collapsed ? 'lg:w-[64px]' : 'lg:w-[268px]',
        // Mobile: drawer overlay
        'lg:relative fixed inset-y-0 left-0 z-50',
        'lg:translate-x-0',
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        // Mobile always expanded width
        'w-[268px]',
      )}
    >
      {/* ── HEADER with Lumi mascot + notifications ─────────── */}
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
          <img
            src="/assets/lumi-mascot.png"
            alt="Lumi"
            className={cn(
              'object-contain',
              collapsed ? 'w-[30px] h-[30px]' : 'w-[34px] h-[34px]',
            )}
            style={{ filter: 'drop-shadow(0 2px 6px rgba(246,201,69,0.4))' }}
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
              <NotificationPopover
                alerts={highAlerts}
                onClose={() => setNotifOpen(false)}
                onSelectAlert={(alert) => {
                  console.log('Selected alert:', alert);
                  navigate('/app/home');
                  onMobileMenuToggle?.(); // Close mobile menu on navigation
                }}
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
                    ? 'bg-lumi-elevated border border-lumi-border text-lumi-text shadow-card'
                    : 'text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated/60',
                )}
              >
                {({ isActive }) => (
                  <>
                    {isActive && !collapsed && (
                      <div
                        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r-full bg-lumi-accent"
                        style={{ boxShadow: '0 0 8px rgba(246,201,69,0.6)' }}
                      />
                    )}
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
                            {badge}
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
        </div>

        {/* Recent Decisions with sparkline (expanded only) */}
        {!collapsed && (
          <div className="mt-4">
            <RecentDecisions
              decisions={recentDecisions}
              totalCount={recentDecisions.length}
              onViewAll={() => navigate('/app/decisions')}
            />
          </div>
        )}
      </div>

      {/* ── RADAR STRIP (live countdown + alert pulse) ─────── */}
      {!collapsed && (
        <RadarStrip countdown={countdown} hasHighAlerts={alertCount > 0} />
      )}

      {/* ── FOOTER with online status ──────────────────────── */}
      <div className={cn(
        'flex-shrink-0 border-t border-lumi-border p-3',
        collapsed ? 'flex flex-col items-center gap-2' : 'space-y-1',
      )}>
        <NavLink
          to="/app/settings"
          title={collapsed ? 'Settings' : undefined}
          aria-label="Settings"
          onClick={() => onMobileMenuToggle?.()} // Close mobile menu on navigation
          className={({ isActive }) => cn(
            'flex items-center gap-2.5 rounded-xl text-lumi-muted',
            'hover:text-lumi-text hover:bg-lumi-elevated transition-all duration-150',
            collapsed ? 'p-2.5' : 'w-full px-3 py-2 text-sm',
            isActive && 'text-lumi-text bg-lumi-elevated',
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
