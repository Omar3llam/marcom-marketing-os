// ============================================================
// MARCOM / Lumi — Admin Panel (standalone, ADMIN-only)
// ------------------------------------------------------------
// Mounted at /admin OUTSIDE the app shell (no Sidebar / TopBar). The route is
// guarded by <RequireUserRole role="ADMIN">; every /api/admin/* call it makes is
// independently requireAdmin-gated server-side. Internal operator tool —
// functional over pretty, desktop-first. Semantic tokens only.
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { StatusTab } from '@/features/admin/StatusTab.jsx';
import { WorkspacesTab } from '@/features/admin/WorkspacesTab.jsx';
import { UsersTab } from '@/features/admin/UsersTab.jsx';
import { DemoTab } from '@/features/admin/DemoTab.jsx';
import { AuditTab } from '@/features/admin/AuditTab.jsx';

const TABS = [
  { key: 'status',     label: 'System Status', Body: StatusTab },
  { key: 'workspaces', label: 'Workspaces',    Body: WorkspacesTab },
  { key: 'users',      label: 'Users',         Body: UsersTab },
  { key: 'demo',       label: 'Demo',          Body: DemoTab },
  { key: 'audit',      label: 'Audit Log',     Body: AuditTab },
];

export default function AdminPanel() {
  const [active, setActive] = useState('status');
  const Active = TABS.find((t) => t.key === active)?.Body ?? StatusTab;

  return (
    <div className="min-h-screen bg-lumi-bg text-lumi-text">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-lumi-accent" />
            <h1 className="font-display text-lg font-semibold text-lumi-text">Admin</h1>
          </div>
          <Link to={appRoutes.overview}
            className="inline-flex items-center gap-1.5 text-xs text-lumi-muted transition-colors hover:text-lumi-text">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to app
          </Link>
        </header>

        <nav className="mb-6 flex gap-1 border-b border-lumi-border" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                active === t.key
                  ? 'border-lumi-accent text-lumi-text'
                  : 'border-transparent text-lumi-muted hover:text-lumi-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <Active />
      </div>
    </div>
  );
}
