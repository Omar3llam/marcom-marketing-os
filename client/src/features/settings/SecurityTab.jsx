import { Key, AlertTriangle, Trash2, RefreshCw, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useFocusTrap } from '@/hooks/useFocusTrap.js';
import { useTeam } from '@/hooks/useTeam.js';
import { toast } from 'sonner';

export function SecurityTab({ currentUser, handlePasswordReset, handleResetSetup, busy, showDeleteModal, setShowDeleteModal, deleteConfirmText, setDeleteConfirmText, handleDeleteAccount, formatDate }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Contextual delete warning — mirror the backend guard (routes/user.js) so the
  // UI is honest about what deletion actually does BEFORE the user commits:
  //   sole member        → the whole workspace + all data is destroyed
  //   last strategist     → deletion is blocked; transfer the role first (409)
  //   otherwise           → only this membership is removed; the team is untouched
  // Effective role: null collabRole ⇒ STRATEGIST (same rule as the backend).
  const { members } = useTeam();
  const teamLoaded = Array.isArray(members) && members.length > 0;
  const isSoleMember = teamLoaded && members.length === 1;
  const myEffectiveRole = teamLoaded ? (members.find((m) => m.isSelf)?.collabRole ?? 'STRATEGIST') : null;
  const otherStrategists = teamLoaded
    ? members.filter((m) => !m.isSelf && (m.collabRole === 'STRATEGIST' || m.collabRole == null)).length
    : 0;
  const isLastStrategist = teamLoaded && !isSoleMember && myEffectiveRole === 'STRATEGIST' && otherStrategists === 0;
  // Focus trap for the destructive delete-account modal: traps Tab, focuses the
  // confirm input on open, restores focus to the trigger on close, and closes
  // on Escape (the modal had no keyboard close before).
  const deleteModalRef = useFocusTrap(showDeleteModal, () => {
    setShowDeleteModal(false);
    setDeleteConfirmText('');
  });

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('[Settings] Logout failed:', err);
      toast.error('Sign out failed. Please try again.');
    }
  };
  return (
    <>
      <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-dark-soft" strokeWidth={2} />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">Security</h2>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-lumi-text mb-1.5">Password</p>
            <p className="text-xs text-lumi-muted mb-3">Click below to receive a password reset link via email</p>
            <button
              onClick={handlePasswordReset}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-4 py-2 text-sm font-medium text-lumi-text hover:bg-surface-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Key className="w-4 h-4" strokeWidth={2} />
              Change Password
            </button>
          </div>

          <div>
            <p className="text-sm font-medium text-lumi-text mb-3">Active Sessions</p>
            <div className="rounded-lg border border-surface-border bg-surface-light p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-lumi-text">{currentUser.email}</p>
                  <p className="text-xs text-lumi-muted mt-0.5">Last sign-in: {formatDate(currentUser.metadata?.lastSignInTime)}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-scale-bg border border-signal-scale/30 px-2.5 py-0.5 text-xs font-medium text-signal-scale">Current session</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SIGN OUT ──────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-lumi-text mb-1">Sign out of this device</p>
            <p className="text-xs text-lumi-muted">You will be redirected to the login page. Your workspace and data are saved.</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-signal-kill/40 bg-signal-kill-bg px-3 py-1.5 text-xs font-display font-semibold text-signal-kill hover:bg-signal-kill/15 transition-colors"
          >
            <LogOut className="w-3 h-3" strokeWidth={2} />
            Sign Out
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-signal-kill/30 bg-signal-kill-bg p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={2} />
          <h2 className="font-display font-semibold text-sm text-signal-kill uppercase tracking-widest">Danger Zone</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-6 pb-4 border-b border-signal-kill/20">
            <div>
              <p className="font-display font-medium text-sm text-lumi-text">Re-run setup wizard</p>
              <p className="mt-1 text-xs text-lumi-muted">If your data sync is failing or your workspace is in a broken state, re-running the setup wizard will re-create your workspace context.</p>
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

          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="font-display font-medium text-sm text-lumi-text">Delete account</p>
              {isSoleMember ? (
                <p className="mt-1 text-xs text-signal-kill">
                  You are the only member — deleting your account permanently deletes this entire workspace, all campaigns, and AI memory. This cannot be undone.
                </p>
              ) : isLastStrategist ? (
                <p className="mt-1 text-xs text-signal-hold">
                  You are the last Strategist. Transfer the Strategist role to another member before deleting your account.
                </p>
              ) : teamLoaded ? (
                <p className="mt-1 text-xs text-lumi-muted">
                  Your account will be removed from this workspace. The workspace and other members are not affected.
                </p>
              ) : (
                <p className="mt-1 text-xs text-lumi-muted">Permanently delete your account. This action cannot be undone.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-signal-kill-bg px-3 py-1.5 text-xs font-display font-semibold text-signal-kill hover:bg-signal-kill/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" strokeWidth={2} />
              Delete Account
            </button>
          </div>
        </div>
      </section>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            ref={deleteModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Delete account confirmation"
            className="bg-surface-card rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-signal-kill/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-signal-kill" strokeWidth={2} />
              </div>
              <h3 className="font-display font-bold text-lg text-lumi-text">Delete Account</h3>
            </div>
            <p className="text-sm text-lumi-muted mb-4">
              {isSoleMember ? (
                <>This will permanently delete your workspace, all campaigns, AI memory, and account data. <strong>This action cannot be undone.</strong></>
              ) : isLastStrategist ? (
                <>You are the last Strategist — this deletion is blocked until you transfer the Strategist role to another member. <strong>Transfer the role first.</strong></>
              ) : (
                <>This removes your account from the workspace. The workspace and other members are not affected. <strong>This action cannot be undone.</strong></>
              )}
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-lumi-text mb-2">
                Type <span className="font-mono font-bold">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none transition-all font-mono"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
                disabled={busy}
                className="flex-1 rounded-lg border border-surface-border bg-surface-card px-4 py-2 text-sm font-medium text-lumi-text hover:bg-surface-light disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={busy || deleteConfirmText !== 'DELETE'}
                className="flex-1 rounded-lg bg-signal-kill px-4 py-2 text-sm font-medium text-surface-card hover:bg-signal-kill disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
