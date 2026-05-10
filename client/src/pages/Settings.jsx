// ============================================================
// MARCOM / Lumi — Settings page
// ============================================================
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { clearContextCache } from '@/router/ProtectedRoute.jsx';

export default function Settings() {
  const navigate = useNavigate();

  const handleResetSetup = () => {
    clearContextCache();      // clears localStorage + resets in-memory cache
    navigate('/onboarding');  // sends user back through the setup wizard
  };

  return (
    <div className="flex flex-col h-full p-8">
      <div className="section-label">Settings</div>
      <h1 className="mt-1 font-display font-bold text-2xl text-lumi-text">Workspace Settings</h1>
      <p className="mt-2 text-lumi-muted text-sm max-w-xl">
        Workspace, members, billing, and integration settings.
        Full settings panel coming soon.
      </p>

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <div className="mt-12 max-w-xl rounded-xl border border-signal-kill/30 bg-signal-kill-bg p-6">
        <h2 className="font-display font-semibold text-sm text-signal-kill uppercase tracking-widest">
          Danger Zone
        </h2>
        <div className="mt-4 flex items-start justify-between gap-6">
          <div>
            <p className="font-display font-medium text-sm text-lumi-text">Re-run setup wizard</p>
            <p className="mt-1 text-xs text-lumi-muted">
              If your uploads are failing or your workspace is in a broken state,
              re-running the setup wizard will re-create your workspace context.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetSetup}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-signal-kill/40 bg-signal-kill-bg px-3 py-1.5 text-xs font-display font-semibold text-signal-kill hover:bg-signal-kill/15 transition-colors"
          >
            <RefreshCw className="w-3 h-3" strokeWidth={2} />
            Re-run setup
          </button>
        </div>
      </div>
    </div>
  );
}
