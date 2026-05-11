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
  Settings, PanelLeftClose,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { cn } from '@/lib/utils.js';

const tools = [
  { label: 'Command Hub',       sub: 'Your OS launchpad',           icon: LayoutDashboard, path: '/app/feed'           },
  { label: 'Campaign Analysis', sub: 'SCALE / HOLD / KILL verdicts', icon: BarChart3,       path: '/app/campaigns'      },
  { label: 'Growth Strategy',   sub: 'CMO memory layer',             icon: Target,          path: '/app/growth'         },
  { label: 'Score Content',     sub: '10-step MARCOM framework',     icon: ScanSearch,      path: '/app/tools/score'    },
  { label: 'Social Calendar',   sub: '4-week content plan',          icon: CalendarDays,    path: '/app/tools/calendar' },
];

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

        {/* Project switcher (expanded) */}
        {!collapsed && (
          <div className="px-3 mt-2">
            <div className="section-label mb-2 px-1">Project</div>
            <button
              onClick={() => setProjectOpen((p) => !p)}
              aria-expanded={projectOpen}
              disabled={workspaceLoading}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl',
                'border transition-all duration-150 text-left',
                projectOpen
                  ? 'bg-lumi-elevated border-lumi-border-strong'
                  : 'bg-transparent border-lumi-border hover:border-lumi-border-strong',
                workspaceLoading && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span className={cn(
                'w-2 h-2 rounded-full flex-shrink-0',
                hasWorkspace ? 'bg-signal-scale' : 'bg-lumi-subtle',
              )} />
              <span className="flex-1 text-sm font-display font-medium text-lumi-text truncate">
                {workspaceName}
              </span>
              <ChevronDown
                className={cn(
                  'w-3.5 h-3.5 text-lumi-muted transition-transform duration-150',
                  projectOpen && 'rotate-180',
                )}
                strokeWidth={1.5}
              />
            </button>

            {projectOpen && (
              <div className="mt-1 bg-lumi-elevated border border-lumi-border rounded-xl overflow-hidden shadow-panel animate-slide-up">
                {hasWorkspace && workspace && (
                  <div className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm font-display text-lumi-accent bg-lumi-accent-soft border-b border-lumi-border">
                    <span className="w-2 h-2 rounded-full bg-lumi-accent flex-shrink-0" />
                    <span className="truncate">{workspace.name}</span>
                  </div>
                )}

                {!hasWorkspace && (
                  <div className="px-3 py-2.5 text-xs text-lumi-subtle text-center">
                    No project yet — create one below
                  </div>
                )}

                <div className={cn(!hasWorkspace && 'border-t border-lumi-border')}>
                  <button
                    onClick={() => { setProjectOpen(false); navigate('/onboarding'); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left
                               text-sm text-lumi-muted hover:text-lumi-accent
                               hover:bg-lumi-accent-soft transition-colors duration-100"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                    New Project
                  </button>
                </div>
              </div>
            )}
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
