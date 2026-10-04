// ============================================================
// MARCOM / Lumi — Sidebar (Enhanced with Figma Design)
// ------------------------------------------------------------
// 268px expanded, 64px collapsed. Features:
// - Lumi star mark + notification bell
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
  Brain, FlaskConical, Microscope, Megaphone, FileText, Plug, History, Layers,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { ROLE_READ, WORKSPACE_ROLE } from '@/context/RoleContext.jsx';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { usePlan, WORKSPACE_READ } from '@/hooks/usePlan.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useConnections } from '@/hooks/useConnections.js';
import { usePendingApprovals } from '@/hooks/usePendingApprovals.js';
import { cn } from '@/lib/utils.js';
import NotificationBell from '@/components/ui/NotificationBell.jsx';
import InboxPanel from '@/features/inbox/InboxPanel.jsx';
import RecentDecisions from '@/components/ui/RecentDecisions.jsx';
import CommandPalette from '@/components/ui/CommandPalette.jsx';
import { appRoutes } from '@/app/routeManifest.js';
import LumiStar from '@/components/brand/LumiStar.jsx';

// FE-05 — the nav reduction. B7-08 locked a primary navigation of the four
// axes plus Connectors; this executes it, with two exceptions the discovery
// forced.
//
// `group` is a THIRD, orthogonal axis to the two gates below. It decides where
// a row is drawn — never whether the seat may reach it. Every demoted surface
// keeps its route, its gates and its ⌘K entry; demotion is not deletion, and
// nothing here becomes URL-only.
//
// 🔒 Testing and Measurement stay PRIMARY. The proof that they could be demoted
// failed in a closed loop: a RUNNING experiment reaches Attention through the
// agenda ("In flight — read when concluded."), and the moment it CONCLUDES the
// planner stops emitting it, its Decision has no back-edge to it (B8-05
// deferred — `rootCause` is not an identity contract), Memory holds no reading
// of it, and the only links into an experiment detail are from these two lists.
// The experiment tells the operator to come back when it is done, and demotion
// would remove the door it asked them to come back through.
//
// 🔒 Reports stays PRIMARY. It is the only item with no `roles` constraint —
// nine of ten are STRATEGIST/BUYER — so demoting it would empty a CLIENT's
// primary navigation entirely. A navigation regression, not a preference.
export const NAV_GROUP = { PRIMARY: 'PRIMARY', SECONDARY: 'SECONDARY' };

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
  // "Today's decisions" — NOT "Decision queue", which is Campaigns' sub-label.
  // Two nav rows carrying the same phrase would read as the same destination.
  // B7 R-N1 — Overview YIELDS the word "Decisions". It named the NOW axis while
  // "Decision queue" named the SUBJECT axis, so the one name covered two axes
  // and THEN, which owns the object, had none. This was fought once already and
  // settled with sub-labels; the axes are what needed separating, not the copy.
  { key: 'overview',     label: 'Attention',    sub: 'What needs you now',    icon: Layout,       path: appRoutes.overview,     roles: ['STRATEGIST', 'BUYER'], plan: 'FREE',  group: NAV_GROUP.PRIMARY },
  // THEN — historical commitment. Ungated by plan (B7 Ruling 3).
  { key: 'decisions',    label: 'Decisions',    sub: 'What Lumi decided',     icon: History,      path: appRoutes.decisions,    roles: ['STRATEGIST', 'BUYER'], plan: 'FREE',  group: NAV_GROUP.PRIMARY },
  { key: 'campaigns',    label: 'Campaigns',    sub: 'Where to investigate',  icon: BarChart3,    path: appRoutes.campaigns,    roles: ['STRATEGIST', 'BUYER'], plan: 'FREE',  group: NAV_GROUP.PRIMARY },
  // 🔒 PRIMARY — a CLIENT's only nav destination. Nine of the ten items carry a
  // STRATEGIST/BUYER constraint and this one carries none, so it is not merely
  // the CLIENT's most useful row: it is the whole of their navigation.
  { key: 'leadership',   label: 'Reports',      sub: 'Weekly narratives',      icon: FileText,     path: appRoutes.leadership,   plan: 'FREE',  group: NAV_GROUP.PRIMARY },
  // FE-05 — Connectors takes the slot FE-04 deferred to this slice. The
  // destination had NINE inbound production CTAs and no navigation owner, which
  // left the topology one node short of what FE-04 built.
  //
  // `plan: 'FREE'` is load-bearing, not a default. /app/connections carries a
  // RoleGate and deliberately NO PlanGate — connectors are how an account gets
  // ANY data at all, so a tier gate there would lock a FREE workspace out of
  // the one action that makes the product work. `plan` here is an entitlement
  // FILTER (`canAccess`), not a heading, so anything stricter than FREE would
  // hide the connect destination from exactly the accounts with nothing
  // connected — B7 Ruling 3's mismatch, pointing the other way.
  { key: 'connections',  label: 'Connectors',   sub: 'Where data comes from',  icon: Plug,         path: appRoutes.connections,  roles: ['STRATEGIST', 'BUYER'], plan: 'FREE',  group: NAV_GROUP.PRIMARY },
  // ── GROWTH — locked on FREE ─────────────────────────────────
  // ACROSS — what Lumi learned, and whether it held up. FE-02 gave the axis an
  // address; until then its two readings were tabs under "Intelligence" below,
  // and the axis had no name in this list at all. GROWTH because the read it
  // depends on, GET /lumi/briefing, is `requirePlan('GROWTH')` — a nav row that
  // outruns its API is a lie one click deep.
  { key: 'memory',       label: 'Memory',       sub: 'What Lumi learned',      icon: Brain,        path: appRoutes.memory,       roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH', group: NAV_GROUP.PRIMARY },
  // ── PRO — locked on FREE / GROWTH ───────────────────────────
  // 🔒 Both PRIMARY. See the LOCK note above the array: a concluded experiment
  // has no other door.
  { key: 'testing',      label: 'Testing',      sub: 'A/B experiments',        icon: FlaskConical, path: appRoutes.testing,      roles: ['STRATEGIST', 'BUYER'], plan: 'PRO',    group: NAV_GROUP.PRIMARY },
  { key: 'measure',      label: 'Measurement',  sub: 'Scenarios + holdouts',   icon: Microscope,   path: appRoutes.measure,      roles: ['STRATEGIST', 'BUYER'], plan: 'PRO',    group: NAV_GROUP.PRIMARY },
  // ── SECONDARY — demoted, NOT deleted ────────────────────────
  // The census measured each of these as having no inbound production link but
  // the Sidebar itself (content 1, intelligence 1, publishing 2 — all of them
  // this file). A secondary group therefore leaves them exactly as reachable as
  // they are today, which is what makes the demotion safe: nothing else was
  // pointing at them to be orphaned.
  //
  // Intelligence is a redirect covering TWO surfaces (Blended Truth + Growth
  // Strategy). Both keep their own inbound links from Attention's PacingWidget,
  // the agenda, ScenarioPanel and the inbox, so demoting the landing row does
  // not strand either of them.
  { key: 'content',      label: 'Creative Optimizer', sub: 'Improve creative performance', icon: Send, path: appRoutes.contentLab, roles: ['STRATEGIST', 'BUYER'], plan: 'FREE',  group: NAV_GROUP.SECONDARY },
  { key: 'intelligence', label: 'Intelligence', sub: 'Truth + strategy board', icon: Layers,       path: appRoutes.intelligence, roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH', group: NAV_GROUP.SECONDARY },
  { key: 'publishing',   label: 'Publishing',   sub: 'Content approvals',      icon: Megaphone,    path: appRoutes.publishing,   roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH', group: NAV_GROUP.SECONDARY },
  // Copilot is demoted from the primary nav while it's a static placeholder — it
  // now lives as a teaser card in Overview. The /app/copilot route stays
  // reachable by direct URL (see App.jsx); restore this line to re-promote it.
];

// Derived, so the two groups can never disagree with `tools` — the drift a
// hand-maintained second array invites (`legacyAppRedirects` is the standing
// example of that mistake, kept accurate by hand and importable by nobody).
export const primaryTools   = tools.filter((t) => t.group === NAV_GROUP.PRIMARY);
export const secondaryTools = tools.filter((t) => t.group === NAV_GROUP.SECONDARY);

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
            {workspace.market && (
              <div className="text-xs text-lumi-subtle mt-0.5 font-mono">
                Market: <span className="text-lumi-muted">{workspace.market}</span>
              </div>
            )}
          </div>
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
  recentDecisions = [],
  mobileMenuOpen = false,
  onMobileMenuToggle,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentUser } = useAuth();
  const { role: collabRole, status: roleStatus, loading: roleLoading, error: roleError } = useCollabRole();
  const { canAccess, loading: planLoading, status: planStatus } = usePlan();
  const { workspace, hasWorkspace, loading: workspaceLoading, error: workspaceError, status: workspaceStatus, canRetry: workspaceCanRetry, refetch: retryWorkspace } = useWorkspace();
  const { data: connectionsData, loading: connectionsLoading, error: connectionsError } = useConnections();

  // Role- AND plan-gated navigation. An item hides if the seat's role can't see
  // it OR the workspace's plan doesn't reach it — locked items are hidden
  // completely, never shown with a lock. Plan is only enforced once loaded
  // (planLoading ⇒ show), so a paying operator never sees items flash away
  // mid-load. Filtering here also keeps locked items out of the ⌘K palette,
  // which reads navItems.
  //
  // Phase 5.9 — an UNKNOWN entitlement is treated exactly like a loading one:
  // the plan filter does not run. Not because the user is entitled, but because
  // hiding claims they are not, and we did not read a plan. Two consequences
  // are deliberate. A failed read no longer deletes the FREE items as well
  // (`canAccess('FREE')` is false when nothing was read, so enforcing here
  // would empty the whole nav). And the route-level PlanGate still refuses —
  // honestly, as an absence rather than as an upgrade wall — if the item is
  // clicked. R-4 (show-locked vs hide) is untouched and still open.
  const planKnown = planStatus === WORKSPACE_READ.PRESENT;
  const navItems = tools.filter(
    (t) => roleAllowed(collabRole, t.roles) && (planLoading || !planKnown || canAccess(t.plan)),
  );
  // FE-05 — the same filtered list, split by where it is drawn. The gates run
  // FIRST and identically for both groups: `group` decides placement, never
  // permission, so a demoted surface is exactly as reachable as it was.
  const primaryNav   = navItems.filter((t) => t.group !== NAV_GROUP.SECONDARY);
  const secondaryNav = navItems.filter((t) => t.group === NAV_GROUP.SECONDARY);

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
  // the Connectors destination uses, so it disappears the moment a connection lands.
  const connectionReadKnown = !connectionsLoading && !connectionsError && connectionsData != null;
  const hasResolvedWorkspace = connectionReadKnown
    && typeof connectionsData.workspaceId === 'string' && connectionsData.workspaceId.length > 0;
  const canSuggestConnect = hasResolvedWorkspace
    && !connectionsData.connections.some((c) => c.connected === true);
  const showConnectCTA = roleAllowed(collabRole, ['STRATEGIST', 'BUYER']) && canSuggestConnect;

  // FE-05 — one row renderer, used by BOTH groups. Extracted rather than
  // duplicated so a demoted surface can never drift into looking different
  // from a primary one: the only thing that differs is where it is drawn.
  const renderNavRow = (tool) => {
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
  };

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

  // Only the live Publishing approval feed establishes a navigation count.
  const alertsByKey = { publishing: pendingApprovalCount };

  const initial = (currentUser?.displayName?.[0] || currentUser?.email?.[0] || 'L').toUpperCase();
  const userLabel = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User';
  const footerRole = roleStatus === ROLE_READ.PRESENT && !roleLoading && !roleError
    && Object.values(WORKSPACE_ROLE).includes(collabRole) ? collabRole : null;
  // Workspace status also describes entitlement readability. The current record
  // may establish a market independently, but a loading/failed record cannot.
  const footerMarket = !workspaceLoading && !workspaceError && hasWorkspace
    && typeof workspace?.market === 'string' && workspace.market.trim() ? workspace.market : null;
  const footerFacts = [footerRole, footerMarket].filter(Boolean).join(' · ');

  // Workspace display name (fallback for loading/empty states)
  const workspaceName = workspaceLoading
    ? 'Loading...'
    : workspace?.name || (workspaceStatus === WORKSPACE_READ.NOTHING_FOUND ? 'No Workspace' : 'Workspace unavailable');

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
        {!collapsed && workspaceStatus === WORKSPACE_READ.NOTHING_FOUND && !workspaceLoading && (
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

        {!collapsed && !hasWorkspace && !workspaceLoading && workspaceStatus !== WORKSPACE_READ.NOTHING_FOUND && (
          <div className="px-3 mt-2" role="alert">
            <div className="section-label mb-2 px-1">Workspace</div>
            <p className="px-3 py-2.5 text-xs text-lumi-muted">
              {workspaceStatus === WORKSPACE_READ.NOT_PERMITTED
                ? 'You are not allowed to read this workspace.'
                : 'Your workspace could not be read right now.'}
            </p>
            {workspaceCanRetry && <button type="button" onClick={retryWorkspace}>Retry workspace</button>}
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

          {primaryNav.map(renderNavRow)}

          {/* FE-05 — the demoted surfaces. A SECOND GROUP, not a removal: each
              of these still carries its own route, its own gates and its ⌘K
              entry, and the census measured that nothing but this Sidebar ever
              linked to them — so a heading is the whole of what changed for
              them. Hidden while collapsed, where there is no room for a label
              and an unlabelled second cluster would read as one long list. */}
          {secondaryNav.length > 0 && !collapsed && (
            <div className="mt-5 pt-3 border-t border-lumi-border/60">
              <div className="section-label px-1 mb-2">More</div>
              {secondaryNav.map(renderNavRow)}
            </div>
          )}
          {secondaryNav.length > 0 && collapsed && secondaryNav.map(renderNavRow)}

          {/* Connect-a-channel shortcut. ⚠️ Its old justification — "solves the
              no-main-nav-entry-to-Integrations gap" — stopped being true in this
              slice: Connectors is a primary row now. What remains is first-run
              EMPHASIS, not a missing entrance, and for a brand-new account it is
              a second sidebar path to the same destination. Kept because
              self-hiding first-run guidance is a product decision, not a nav
              reduction; reported rather than removed here. */}
          {showConnectCTA && (
            <NavLink
              to={appRoutes.connections}
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

      {/* ── FOOTER with evidenced user identity ───────────── */}
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
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-display font-medium text-lumi-text truncate">{userLabel}</div>
              {footerFacts && (
                <div className="text-[10px] text-lumi-subtle truncate">
                  <span className="font-mono">{footerFacts}</span>
                </div>
              )}
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
