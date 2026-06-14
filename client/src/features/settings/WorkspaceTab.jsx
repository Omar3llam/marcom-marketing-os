// ============================================================
// MARCOM / Lumi — WorkspaceTab (Settings · Workspace)
// ------------------------------------------------------------
// Workspace name + plan. The channel integrations live in the dedicated
// <Connections> surface (one connection-status implementation, workspace-scoped
// via /api/lumi/connections) — this tab no longer re-implements Meta status.
// No "Workspace Slug" field: the Workspace model has no slug, so showing one
// would fabricate an identifier with no backing row.
// ============================================================
import { Save, Shield } from 'lucide-react';

export function WorkspaceTab({
  workspaceName,
  setWorkspaceName,
  workspaceChanged,
  handleSaveWorkspace,
  busy,
}) {
  return (
    <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-dark-soft" strokeWidth={2} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">Workspace</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-lumi-text mb-1.5">Workspace Name</label>
          <input
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="My Workspace"
            className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-lumi-text mb-1.5">Current Plan</label>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-lumi-gold/10 border border-lumi-gold/30 px-3 py-1 text-xs font-medium text-lumi-deep">✨ FREE</div>
        </div>

        {workspaceChanged && (
          <button
            onClick={handleSaveWorkspace}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-dark-base px-4 py-2 text-sm font-medium text-surface-card hover:bg-dark-soft disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" strokeWidth={2} />
            Save Changes
          </button>
        )}
      </div>
    </section>
  );
}
