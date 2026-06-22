// ============================================================
// MARCOM / Lumi — IntelligenceSubNav
// ------------------------------------------------------------
// Shared sub-nav strip mounted on all three Intelligence surfaces
// (Blended Truth · Growth Strategy · Proof of Learning). Reuses the
// route-driven NavLink pattern from Settings: the section list lives in
// routeManifest (`intelligenceSections`); this just renders + role-filters it.
//
// The Sidebar's "Intelligence" item only ever lands on Blended Truth — this
// strip is what makes the other two reachable. Tabs are filtered to what the
// caller's role can actually open (same roleAllowed() the Sidebar uses), so a
// CLIENT who can only reach Proof never sees a tab that would redirect them out.
// With < 2 visible tabs there's nothing to navigate between, so we render
// nothing rather than an orphan single-tab strip.
// ============================================================
import { NavLink } from 'react-router-dom';
import { intelligenceSections } from '@/app/routeManifest.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { cn } from '@/lib/utils.js';

export default function IntelligenceSubNav() {
  const { role } = useCollabRole();
  const items = intelligenceSections.filter((s) => roleAllowed(role, s.roles));

  if (items.length < 2) return null;

  return (
    <nav
      aria-label="Intelligence sections"
      className="flex items-center gap-1 mb-6 border-b border-lumi-border"
    >
      {items.map((item) => (
        <NavLink
          key={item.key}
          to={item.path}
          end
          className={({ isActive }) => cn(
            'px-3 py-2 text-sm font-display border-b-2 -mb-px transition-colors',
            isActive
              ? 'border-lumi-accent text-lumi-text font-semibold'
              : 'border-transparent text-lumi-muted hover:text-lumi-text',
          )}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
