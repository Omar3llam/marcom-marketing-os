import { Save, Shield, Link2, Check, ChevronRight, Loader2, RefreshCw } from 'lucide-react';

export function IntegrationsTab({
  workspaceName,
  setWorkspaceName,
  workspaceSlug,
  workspaceChanged,
  handleSaveWorkspace,
  busy,
  metaStatus,
  metaExpires,
  metaAccountId,
  connectingMeta,
  handleMetaConnect,
  projectId,
  projectLoading,
  showWorkspace = true,
  showIntegrations = true,
}) {
  return (
    <>
      {showWorkspace && (
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
            <label className="block text-sm font-medium text-lumi-text mb-1.5">Workspace Slug</label>
            <input
              type="text"
              value={workspaceSlug}
              disabled
              className="w-full rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-sm text-dark-soft cursor-not-allowed font-mono"
            />
            <p className="mt-1 text-xs text-lumi-muted">Used in your API tokens — contact support to change</p>
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
      )}

      {showIntegrations && (
      <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-4 h-4 text-dark-soft" strokeWidth={2} />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">Integrations</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-semibold text-lumi-text">Meta Ads</p>
              <p className="text-xs text-lumi-muted mt-0.5">
                {metaStatus === 'loading' ? (
                  'Checking connection...'
                ) : metaStatus === 'connected' ? (
                  <>
                    Connected
                    {metaAccountId && <span className="font-mono"> · {metaAccountId}</span>}
                    {metaExpires && (
                      <span>
                        {' · Expires '}
                        {new Date(metaExpires) < new Date() ? (
                          <span className="font-semibold text-trend-warning">EXPIRED</span>
                        ) : (
                          new Date(metaExpires).toLocaleDateString()
                        )}
                      </span>
                    )}
                  </>
                ) : (
                  'Connect to enable Sync Live Meta and execution.'
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {metaStatus === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-dark-soft/40" />}
              {metaStatus === 'connected' && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-signal-scale">
                  <Check className="w-3.5 h-3.5" /> Connected
                </span>
              )}
              <button
                type="button"
                onClick={handleMetaConnect}
                disabled={connectingMeta || metaStatus === 'loading' || projectLoading || !projectId}
                className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-lumi-text hover:border-lumi-gold/40 hover:bg-surface-light transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connectingMeta ? <><Loader2 className="w-3 h-3 animate-spin" /> Connecting...</>
                  : metaStatus === 'connected' ? <><RefreshCw className="w-3 h-3" /> Reconnect</>
                  : <>Connect <ChevronRight className="w-3 h-3" /></>}
              </button>
            </div>
          </div>

          <hr className="border-surface-border" />

          <div className="flex items-center justify-between py-1 opacity-40">
            <div>
              <p className="text-sm font-semibold text-lumi-text">Google Ads</p>
              <p className="text-xs text-lumi-muted mt-0.5">Coming soon.</p>
            </div>
            <span className="text-xs font-mono text-dark-soft">SOON</span>
          </div>
        </div>
      </section>
      )}
    </>
  );
}
