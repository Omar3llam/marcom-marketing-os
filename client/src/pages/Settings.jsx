// ============================================================
// MARCOM / Lumi — Settings Page (Complete Account Management)
// ============================================================
// Sections:
//   1. Profile — display name, email (read-only), avatar
//   2. Workspace — name, slug (read-only), plan
//   2.5. Integrations — Meta Ads (LIVE status), Google Ads (soon)
//   3. Notifications — email, Slack, digest (localStorage)
//   4. Security — password reset, active sessions
//   5. Danger Zone — re-run setup, delete account
// ============================================================
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Mail, Key, Trash2, AlertTriangle, Save, Bell, Shield, Link2, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { sendPasswordResetEmail, auth } from '@/firebase.js';
import { api } from '@/lib/api.js';
import { toast } from 'sonner';
import { clearContextCache } from '@/router/ProtectedRoute.jsx';

const NOTIFICATION_PREFS_KEY = 'lumi_notification_prefs';

export default function Settings() {
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  // ── Profile State ──────────────────────────────────────────
  const [displayName, setDisplayName] = useState('');
  const [profileChanged, setProfileChanged] = useState(false);

  // ── Workspace State ────────────────────────────────────────
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug] = useState('workspace-001'); // Read-only
  const [workspaceChanged, setWorkspaceChanged] = useState(false);

  // ── Notifications State (localStorage) ─────────────────────
  const [notifPrefs, setNotifPrefs] = useState({
    emailExecutionUpdates: true,
    slackWebhook: '',
    weeklyDigest: false,
  });
  const [notifChanged, setNotifChanged] = useState(false);

  // ── Meta Integration State ─────────────────────────────────
  const [metaStatus, setMetaStatus] = useState('loading'); // loading | connected | disconnected
  const [metaExpires, setMetaExpires] = useState(null);
  const [metaAccountId, setMetaAccountId] = useState(null);
  const [connectingMeta, setConnectingMeta] = useState(false);

  // ── Delete Account Modal ───────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // ── Initialize from Firebase + localStorage ────────────────
  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.displayName || '');
      setWorkspaceName('My Workspace'); // TODO: fetch from Firestore

      // Load notification prefs from localStorage
      try {
        const saved = localStorage.getItem(NOTIFICATION_PREFS_KEY);
        if (saved) {
          setNotifPrefs(JSON.parse(saved));
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, [currentUser]);

  // ── Fetch Meta Integration Status ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (currentUser?.uid) {
      api.get('/api/credentials/status', {
        params: { platform: 'meta_ads', projectId: currentUser.uid },
      })
        .then(res => {
          if (cancelled) return;
          setMetaStatus(res.data?.connected ? 'connected' : 'disconnected');
          setMetaExpires(res.data?.expiresAt ?? null);
          setMetaAccountId(res.data?.accountId ?? null);
        })
        .catch(() => {
          if (!cancelled) setMetaStatus('disconnected');
        });
    }
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  // ── Track Profile Changes ──────────────────────────────────
  useEffect(() => {
    if (currentUser) {
      const changed = displayName !== (currentUser.displayName || '');
      setProfileChanged(changed);
    }
  }, [displayName, currentUser]);

  // ── Track Workspace Changes ────────────────────────────────
  useEffect(() => {
    setWorkspaceChanged(workspaceName !== 'My Workspace');
  }, [workspaceName]);

  // ══════════════════════════════════════════════════════════════
  // HANDLERS
  // ══════════════════════════════════════════════════════════════

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      toast.error('Display name cannot be empty');
      return;
    }

    setBusy(true);
    try {
      await api.patch('/api/user/profile', { displayName: displayName.trim() });
      toast.success('Profile updated');
      setProfileChanged(false);

      // Force Firebase to reload user data
      if (currentUser) {
        await currentUser.reload();
      }
    } catch (err) {
      console.error('[Settings] Save profile error:', err);
      toast.error(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveWorkspace = async () => {
    if (!workspaceName.trim()) {
      toast.error('Workspace name cannot be empty');
      return;
    }

    setBusy(true);
    try {
      await api.patch('/api/user/workspace', { workspaceName: workspaceName.trim() });
      toast.success('Workspace updated');
      setWorkspaceChanged(false);
    } catch (err) {
      console.error('[Settings] Save workspace error:', err);
      toast.error(err.response?.data?.error || 'Failed to update workspace');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNotifications = () => {
    try {
      localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notifPrefs));
      toast.success('Notification preferences saved');
      setNotifChanged(false);
    } catch (err) {
      console.error('[Settings] Save notifications error:', err);
      toast.error('Failed to save preferences');
    }
  };

  const handlePasswordReset = async () => {
    if (!currentUser?.email) {
      toast.error('No email address found');
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      toast.success(`Password reset email sent to ${currentUser.email}`);
    } catch (err) {
      console.error('[Settings] Password reset error:', err);
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setBusy(false);
    }
  };

  const handleMetaConnect = () => {
    setConnectingMeta(true);
    window.location.href = '/api/auth/meta/connect';
  };

  const handleResetSetup = () => {
    clearContextCache();
    navigate('/onboarding');
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      toast.error('Type DELETE to confirm');
      return;
    }

    setBusy(true);
    try {
      await api.delete('/api/user/account');
      toast.success('Account deleted');

      // Clear all local data
      localStorage.clear();

      // Sign out and redirect
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('[Settings] Delete account error:', err);
      toast.error(err.response?.data?.error || 'Failed to delete account');
      setBusy(false);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      return new Date(timestamp).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return '—';
    }
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-lumi-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full p-6 lg:p-8">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="section-label">Settings</div>
          <h1 className="mt-1 font-display font-bold text-lg text-lumi-text">
            Account Settings
          </h1>
          <p className="mt-2 text-lumi-muted text-sm">
            Manage your profile, workspace, and account preferences.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════ */}
        {/* SECTION 1: Profile                                     */}
        {/* ══════════════════════════════════════════════════════ */}
        <section className="bg-surface-card rounded-xl border border-surface-border p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-dark-soft" strokeWidth={2} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">
              Profile
            </h2>
          </div>

          <div className="space-y-4">
            {/* Avatar Display */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-lumi-gold to-lumi-deep flex items-center justify-center text-surface-card font-display font-bold text-lg shadow-md">
                {getInitials(displayName || currentUser.email)}
              </div>
              <div>
                <p className="text-sm font-medium text-lumi-text">
                  {currentUser.email}
                </p>
                <p className="text-xs text-lumi-muted">
                  Avatar auto-generated from name
                </p>
              </div>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-lumi-text mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none transition-all"
              />
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-sm font-medium text-lumi-text mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={currentUser.email || ''}
                disabled
                className="w-full rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-sm text-dark-soft cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-lumi-muted">
                Email is managed by Firebase and cannot be changed here
              </p>
            </div>

            {/* Save Button */}
            {profileChanged && (
              <button
                onClick={handleSaveProfile}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-dark-base px-4 py-2 text-sm font-medium text-surface-card hover:bg-dark-soft disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="w-4 h-4" strokeWidth={2} />
                Save Changes
              </button>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════ */}
        {/* SECTION 2: Workspace                                   */}
        {/* ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-dark-soft" strokeWidth={2} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">
              Workspace
            </h2>
          </div>

          <div className="space-y-4">
            {/* Workspace Name */}
            <div>
              <label className="block text-sm font-medium text-lumi-text mb-1.5">
                Workspace Name
              </label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="My Workspace"
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none transition-all"
              />
            </div>

            {/* Workspace Slug (read-only) */}
            <div>
              <label className="block text-sm font-medium text-lumi-text mb-1.5">
                Workspace Slug
              </label>
              <input
                type="text"
                value={workspaceSlug}
                disabled
                className="w-full rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-sm text-dark-soft cursor-not-allowed font-mono"
              />
              <p className="mt-1 text-xs text-lumi-muted">
                Used in your API tokens — contact support to change
              </p>
            </div>

            {/* Plan Badge */}
            <div>
              <label className="block text-sm font-medium text-lumi-text mb-1.5">
                Current Plan
              </label>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-lumi-gold/10 border border-lumi-gold/30 px-3 py-1 text-xs font-medium text-lumi-deep">
                ✨ FREE
              </div>
            </div>

            {/* Save Button */}
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

        {/* ══════════════════════════════════════════════════════ */}
        {/* SECTION 2.5: Integrations (Meta Ads)                   */}
        {/* ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Link2 className="w-4 h-4 text-dark-soft" strokeWidth={2} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">
              Integrations
            </h2>
          </div>

          <div className="space-y-4">
            {/* Meta Ads Integration */}
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
                {/* Status Badge */}
                {metaStatus === 'loading' && (
                  <Loader2 className="w-4 h-4 animate-spin text-dark-soft/40" />
                )}
                {metaStatus === 'connected' && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-signal-scale">
                    <Check className="w-3.5 h-3.5" /> Connected
                  </span>
                )}

                {/* Connect/Reconnect Button */}
                <button
                  type="button"
                  onClick={handleMetaConnect}
                  disabled={connectingMeta || metaStatus === 'loading'}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-lumi-text hover:border-lumi-gold/40 hover:bg-surface-light transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connectingMeta ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Connecting...</>
                  ) : metaStatus === 'connected' ? (
                    <><RefreshCw className="w-3 h-3" /> Reconnect</>
                  ) : (
                    <>Connect <ChevronRight className="w-3 h-3" /></>
                  )}
                </button>
              </div>
            </div>

            <hr className="border-surface-border" />

            {/* Google Ads — Coming Soon */}
            <div className="flex items-center justify-between py-1 opacity-40">
              <div>
                <p className="text-sm font-semibold text-lumi-text">Google Ads</p>
                <p className="text-xs text-lumi-muted mt-0.5">Coming soon.</p>
              </div>
              <span className="text-xs font-mono text-dark-soft">SOON</span>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════ */}
        {/* SECTION 3: Notifications                               */}
        {/* ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-dark-soft" strokeWidth={2} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">
              Notifications
            </h2>
          </div>

          <div className="space-y-4">
            {/* Email Notifications Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-lumi-text">
                  Email notifications
                </p>
                <p className="text-xs text-lumi-muted">
                  Receive emails for execution success/failure
                </p>
              </div>
              <button
                onClick={() => {
                  setNotifPrefs((prev) => ({
                    ...prev,
                    emailExecutionUpdates: !prev.emailExecutionUpdates,
                  }));
                  setNotifChanged(true);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  notifPrefs.emailExecutionUpdates ? 'bg-lumi-gold' : 'bg-surface-border'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    notifPrefs.emailExecutionUpdates ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Slack Webhook */}
            <div>
              <label className="block text-sm font-medium text-lumi-text mb-1.5">
                Slack Webhook URL (optional)
              </label>
              <input
                type="url"
                value={notifPrefs.slackWebhook}
                onChange={(e) => {
                  setNotifPrefs((prev) => ({ ...prev, slackWebhook: e.target.value }));
                  setNotifChanged(true);
                }}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none transition-all font-mono text-xs"
              />
            </div>

            {/* Weekly Digest Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-lumi-text">
                  Weekly performance digest
                </p>
                <p className="text-xs text-lumi-muted">
                  Summary email every Monday morning
                </p>
              </div>
              <button
                onClick={() => {
                  setNotifPrefs((prev) => ({ ...prev, weeklyDigest: !prev.weeklyDigest }));
                  setNotifChanged(true);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  notifPrefs.weeklyDigest ? 'bg-lumi-gold' : 'bg-surface-border'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    notifPrefs.weeklyDigest ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Save Button */}
            {notifChanged && (
              <button
                onClick={handleSaveNotifications}
                className="inline-flex items-center gap-2 rounded-lg bg-dark-base px-4 py-2 text-sm font-medium text-surface-card hover:bg-dark-soft transition-colors"
              >
                <Save className="w-4 h-4" strokeWidth={2} />
                Save Preferences
              </button>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════ */}
        {/* SECTION 4: Security                                    */}
        {/* ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-4 h-4 text-dark-soft" strokeWidth={2} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">
              Security
            </h2>
          </div>

          <div className="space-y-6">
            {/* Password Reset */}
            <div>
              <p className="text-sm font-medium text-lumi-text mb-1.5">
                Password
              </p>
              <p className="text-xs text-lumi-muted mb-3">
                Click below to receive a password reset link via email
              </p>
              <button
                onClick={handlePasswordReset}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-4 py-2 text-sm font-medium text-lumi-text hover:bg-surface-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Key className="w-4 h-4" strokeWidth={2} />
                Change Password
              </button>
            </div>

            {/* Active Sessions */}
            <div>
              <p className="text-sm font-medium text-lumi-text mb-3">
                Active Sessions
              </p>
              <div className="rounded-lg border border-surface-border bg-surface-light p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-lumi-text">
                      {currentUser.email}
                    </p>
                    <p className="text-xs text-lumi-muted mt-0.5">
                      Last sign-in: {formatDate(currentUser.metadata?.lastSignInTime)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-scale-bg border border-signal-scale/30 px-2.5 py-0.5 text-xs font-medium text-signal-scale">
                    Current session
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════ */}
        {/* SECTION 5: DANGER ZONE                                 */}
        {/* ══════════════════════════════════════════════════════ */}
        <section className="rounded-xl border border-signal-kill/30 bg-signal-kill-bg p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={2} />
            <h2 className="font-display font-semibold text-sm text-signal-kill uppercase tracking-widest">
              Danger Zone
            </h2>
          </div>

          <div className="space-y-4">
            {/* Re-run Setup Wizard */}
            <div className="flex items-start justify-between gap-6 pb-4 border-b border-signal-kill/20">
              <div>
                <p className="font-display font-medium text-sm text-lumi-text">
                  Re-run setup wizard
                </p>
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

            {/* Delete Account */}
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="font-display font-medium text-sm text-lumi-text">
                  Delete account
                </p>
                <p className="mt-1 text-xs text-lumi-muted">
                  Permanently delete your workspace, all campaigns, and AI memory.
                  This action cannot be undone.
                </p>
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
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* DELETE ACCOUNT MODAL                                   */}
      {/* ══════════════════════════════════════════════════════ */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-card rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-signal-kill/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-signal-kill" strokeWidth={2} />
              </div>
              <h3 className="font-display font-bold text-lg text-lumi-text">
                Delete Account
              </h3>
            </div>

            <p className="text-sm text-lumi-muted mb-4">
              This will permanently delete your workspace, all campaigns, AI memory,
              and account data. <strong>This action cannot be undone.</strong>
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
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
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
    </div>
  );
}
