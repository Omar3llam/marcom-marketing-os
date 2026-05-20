// ============================================================
// MARCOM / Lumi — Sidebar
// ------------------------------------------------------------
// 260px expanded, 64px collapsed. Holds: logo, project switcher,
// New Chat CTA, tools nav, recent chats, footer (CSV upload +
// Settings + user pill). All icons stroke-width 1.5.
// ============================================================
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Sparkles, ChevronDown, ChevronRight, Plus,
  LayoutDashboard, BarChart3, Target, ScanSearch, CalendarDays,
  Settings, PanelLeftClose, Activity,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { cn } from '@/lib/utils.js';

const tools = [
  { label: 'Command Hub',       sub: 'Your OS launchpad',            icon: LayoutDashboard, path: '/app/feed'             },
  { label: 'Campaign Analysis', sub: 'SCALE / HOLD / KILL verdicts',  icon: BarChart3,       path: '/app/campaigns'        },
  { label: 'Operations',        sub: 'Runtime monitor + audit trail', icon: Activity,        path: '/app/demo/operations'  },
  { label: 'Growth Strategy',   sub: 'CMO memory layer',              icon: Target,          path: '/app/growth'           },
  { label: 'Score Content',     sub: '10-step MARCOM framework',      icon: ScanSearch,      path: '/app/tools/score'      },
  { label: 'Social Calendar',   sub: '4-week content plan',           icon: CalendarDays,    path: '/app/tools/calendar'   },
];

// ══════════════════════════════════════════════════════════════
// WorkspaceHQ — Operational header showing company identity
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
    <div className="px-3 mt-2">
      <div className="section-label mb-2 px-1">Workspace</div>

      {/* HQ Card */}
      <div className="rounded-xl border border-lumi-border bg-lumi-elevated p-3">
        {/* Company header */}
        <div className="flex items-start gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-lumi-accent to-lumi-accent/70 flex items-center justify-center flex-shrink-0 shadow-accent-glow">
            <span className="text-sm font-display font-bold text-lumi-bg">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-display font-semibold text-lumi-text truncate">
              {workspace.name}
            </div>
            <div className="text-xs text-lumi-subtle mt-0.5 font-mono">
              Market: <span className="text-lumi-muted">—</span>
            </div>
          </div>
        </div>

        {/* Spend tier */}
        <div className="text-xs text-lumi-subtle mb-2 font-mono">
          Spend tier: <span className="text-lumi-muted">—</span>
        </div>

        {/* Connected channels (placeholder) */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-xs text-lumi-subtle font-mono">Channels:</span>
          <span className="text-xs text-lumi-muted font-mono">—</span>
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

export default function Sidebar({ collapsed, onToggle }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { workspace, hasWorkspace, loading: workspaceLoading } = useWorkspace();
  const [projectOpen, setProjectOpen] = useState(false);
  const [toolsOpen,   setToolsOpen]   = useState(true);

  const initial = (currentUser?.displayName?.[0] || currentUser?.email?.[0] || 'L').toUpperCase();
  const userLabel = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User';

  // Workspace display name (fallback for loading/empty states)
  const workspaceName = workspaceLoading
    ? 'Loading...'
    : workspace?.name || 'No Project';

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-lumi-surface border-r border-lumi-border',
        'transition-all duration-200 ease-out flex-shrink-0',
        collapsed ? 'w-[64px]' : 'w-[260px]',
      )}
    >
      {/* ── HEADER ───────────────────────────────────────────── */}
      <div className={cn(
        'flex items-center h-14 px-4 border-b border-lumi-border flex-shrink-0',
        collapsed ? 'justify-center' : 'justify-between',
      )}>
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center gap-2 group"
          title={collapsed ? 'Expand sidebar' : undefined}
        >
          <Sparkles className="w-5 h-5 text-lumi-accent" strokeWidth={1.5} />
          {!collapsed && (
            <span className="font-display font-bold text-lg text-lumi-accent tracking-tight">
              LUMI
            </span>
          )}
        </button>
        {!collapsed && (
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="p-1.5 rounded-lg text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated transition-colors duration-150"
          >
            <PanelLeftClose className="w-4 h-4" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* ── SCROLL ───────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden py-3 gap-1">

        {/* WorkspaceHQ (expanded) */}
        {!collapsed && hasWorkspace && workspace && (
          <WorkspaceHQ workspace={workspace} onNewProject={() => navigate('/onboarding')} />
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

        {/* Tools */}
        <div className={cn('mt-3', collapsed ? 'px-2' : 'px-3')}>
          {!collapsed && (
            <button
              onClick={() => setToolsOpen((p) => !p)}
              aria-expanded={toolsOpen}
              className="w-full flex items-center justify-between px-1 mb-2 section-label hover:text-lumi-muted transition-colors"
            >
              <span>Tools</span>
              <ChevronRight
                className={cn('w-3 h-3 transition-transform duration-150', toolsOpen && 'rotate-90')}
                strokeWidth={2}
              />
            </button>
          )}

          {(toolsOpen || collapsed) && tools.map((tool) => (
            <NavLink
              key={tool.path}
              to={tool.path}
              title={collapsed ? tool.label : undefined}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-xl transition-all duration-150 mb-0.5 text-sm group',
                collapsed ? 'justify-center p-3' : 'px-3 py-2.5',
                isActive
                  ? 'bg-lumi-elevated border border-lumi-border text-lumi-text shadow-card'
                  : 'text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated/60',
              )}
            >
              <tool.icon className={cn('flex-shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} strokeWidth={1.5} />
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="font-display font-medium text-sm leading-tight truncate">{tool.label}</div>
                  <div className="text-xs text-lumi-subtle truncate mt-0.5">{tool.sub}</div>
                </div>
              )}
            </NavLink>
          ))}
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <div className={cn(
        'flex-shrink-0 border-t border-lumi-border p-3',
        collapsed ? 'flex flex-col items-center gap-2' : 'space-y-1',
      )}>
        <NavLink
          to="/app/settings"
          title={collapsed ? 'Settings' : undefined}
          aria-label="Settings"
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
          <div className="w-7 h-7 rounded-full bg-lumi-accent/20 border border-lumi-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-display font-bold text-lumi-accent">{initial}</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-display font-medium text-lumi-text truncate">{userLabel}</div>
              <div className="text-xs text-lumi-subtle truncate">{workspaceName?.toUpperCase()}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
