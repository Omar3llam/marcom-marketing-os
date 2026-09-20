import { useState, useEffect } from 'react';
import { NavLink, Link, useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useUserRole } from '@/hooks/useUserRole.js';
import { sendPasswordResetEmail, auth } from '@/firebase.js';
import { toast } from 'sonner';
import { clearContextCache } from '@/router/ProtectedRoute.jsx';
import { settingsSections } from '@/app/routeManifest.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import RoleGate, { roleAllowed } from '@/components/auth/RoleGate.jsx';
import SectionNotPermitted from './SectionNotPermitted.jsx';
import { EmptyState, PageHeader } from '@/design-system/patterns';
import { ProfileTab } from './ProfileTab.jsx';
import { WorkspaceTab } from './WorkspaceTab.jsx';
import TeamTab from './TeamTab.jsx';
import RevenueCsvTab from './RevenueCsvTab.jsx';
import { NotificationsTab } from './NotificationsTab.jsx';
import { SecurityTab } from './SecurityTab.jsx';
import {
  deleteUserAccount,
  updateUserProfile,
  updateWorkspaceName,
} from './services.js';

const NOTIFICATION_PREFS_KEY = 'lumi_notification_prefs';

export default function Settings() {
  const navigate = useNavigate();
  const { section } = useParams();
  const { currentUser, logout } = useAuth();
  const { isAdmin } = useUserRole();
  // R-15 — the collab seat, for the SECTION audience. Distinct axis from
  // useUserRole above, which is the system ADMIN allowlist and gates /admin.
  const { role: collabRole } = useCollabRole();
  const [busy, setBusy] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [profileChanged, setProfileChanged] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceChanged, setWorkspaceChanged] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState({ emailExecutionUpdates: true, slackWebhook: '', weeklyDigest: false });
  const [notifChanged, setNotifChanged] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Meta OAuth return toast — the connect flow now lives in <Connections>, but
  // the callback still redirects here with ?meta_connected / ?meta_error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('meta_connected') === '1') {
      toast.success('Meta Ads connected successfully!');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('meta_error')) {
      const errorType = params.get('meta_error');
      const errorMessages = { denied: 'Meta connection was cancelled', invalid_state: 'Invalid OAuth state - please try again', project_not_found: 'Workspace not found', server_error: 'Server error during Meta connection' };
      toast.error(errorMessages[errorType] || 'Failed to connect Meta Ads');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.displayName || '');
      setWorkspaceName('My Workspace');
      try {
        const saved = localStorage.getItem(NOTIFICATION_PREFS_KEY);
        if (saved) setNotifPrefs(JSON.parse(saved));
      } catch { /* Invalid JSON, ignore */ }
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) setProfileChanged(displayName !== (currentUser.displayName || ''));
  }, [displayName, currentUser]);

  useEffect(() => { setWorkspaceChanged(workspaceName !== 'My Workspace'); }, [workspaceName]);

  const handleSaveProfile = async () => {
    if (!displayName.trim()) { toast.error('Display name cannot be empty'); return; }
    setBusy(true);
    try {
      await updateUserProfile(displayName.trim());
      toast.success('Profile updated');
      setProfileChanged(false);
      if (currentUser) await currentUser.reload();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update profile');
    } finally { setBusy(false); }
  };

  const handleSaveWorkspace = async () => {
    if (!workspaceName.trim()) { toast.error('Workspace name cannot be empty'); return; }
    setBusy(true);
    try {
      await updateWorkspaceName(workspaceName.trim());
      toast.success('Workspace updated');
      setWorkspaceChanged(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update workspace');
    } finally { setBusy(false); }
  };

  const handleSaveNotifications = () => {
    try {
      localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notifPrefs));
      toast.success('Notification preferences saved');
      setNotifChanged(false);
    } catch { toast.error('Failed to save preferences'); }
  };

  const handlePasswordReset = async () => {
    if (!currentUser?.email) { toast.error('No email address found'); return; }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      toast.success(`Password reset email sent to ${currentUser.email}`);
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    } finally { setBusy(false); }
  };

  const handleResetSetup = () => { clearContextCache(); navigate('/onboarding'); };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    setBusy(true);
    try {
      await deleteUserAccount();
      toast.success('Account deleted');
      localStorage.clear();
      await logout();
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete account');
      setBusy(false);
    }
  };

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try { return new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return '—'; }
  };

  if (!currentUser) return <div className="flex items-center justify-center h-full"><p className="text-lumi-muted">Loading...</p></div>;

  const activeSection = settingsSections.some((item) => item.key === section)
    ? section
    : 'general';
  // Always defined: activeSection is either a declared key or 'general', which
  // is one. An unknown key ('billing', 'team-and-roles', anything invented)
  // already resolves to General above, so a URL cannot name a section that has
  // no audience declared for it.
  const activeItem = settingsSections.find((item) => item.key === activeSection);

  // ── THE SECTION BOUNDARY (Phase 5.12 · R-15) ──────────────────────────
  // The same manifest entry answers the nav question and the URL question, so
  // there is no way to reach a section by typing its address that does not go
  // through the check that hid its nav item. Hiding the link alone is not a
  // permission — it is a suggestion.
  //
  // RoleGate is reused rather than reimplemented: it already carries the three
  // outcomes this needs (hold while LOADING, RoleUnavailable when the seat was
  // not READ, fallback when it was read and excludes us), and a second copy of
  // that logic is how two copies of a rule drift apart.
  //
  // Note what does NOT happen here: no redirect. A refused section keeps its
  // address and states the rule, so Back and Forward behave, a refresh lands in
  // the same place, and there is no loop to fall into.
  const gated = (content) =>
    (activeItem?.roles
      ? (
        <RoleGate
          role={activeItem.roles}
          fallback={<SectionNotPermitted label={activeItem.label} roles={activeItem.roles} />}
        >
          {content}
        </RoleGate>
      )
      : content);

  const renderSection = () => {
    switch (activeSection) {
      // FE-04 — `integrations` is gone from here. It was never a settings
      // CONCERN: it is the surface an operator connects and repairs a channel
      // on, and it now owns /app/connections. The address still resolves —
      // App.jsx redirects it — so rendering it here as well would give one
      // object two destinations, which is what B7 Ruling 2 forbids.
      case 'team':
        return <TeamTab />;
      case 'revenue':
        return <RevenueCsvTab />;
      case 'billing':
        return <SettingsPlaceholder title="Billing" copy="Billing configuration is reserved here so plan and payment controls stay separate from marketing workflows." />;
      case 'workspace':
        return (
          <WorkspaceTab
            workspaceName={workspaceName}
            setWorkspaceName={setWorkspaceName}
            workspaceChanged={workspaceChanged}
            handleSaveWorkspace={handleSaveWorkspace}
            busy={busy}
          />
        );
      case 'security':
        return (
          <SecurityTab
            currentUser={currentUser}
            handlePasswordReset={handlePasswordReset}
            handleResetSetup={handleResetSetup}
            busy={busy}
            showDeleteModal={showDeleteModal}
            setShowDeleteModal={setShowDeleteModal}
            deleteConfirmText={deleteConfirmText}
            setDeleteConfirmText={setDeleteConfirmText}
            handleDeleteAccount={handleDeleteAccount}
            formatDate={formatDate}
          />
        );
      case 'general':
      default:
        return (
          <>
            <ProfileTab
              displayName={displayName}
              setDisplayName={setDisplayName}
              currentUser={currentUser}
              profileChanged={profileChanged}
              handleSaveProfile={handleSaveProfile}
              busy={busy}
              getInitials={getInitials}
            />
            <NotificationsTab
              notifPrefs={notifPrefs}
              setNotifPrefs={setNotifPrefs}
              notifChanged={notifChanged}
              setNotifChanged={setNotifChanged}
              handleSaveNotifications={handleSaveNotifications}
            />
          </>
        );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full p-6 lg:p-8">
        <PageHeader
          eyebrow="Settings"
          title="Workspace Settings"
          description="Configure the system without mixing settings into core marketing workflows."
        />

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="space-y-1" aria-label="Settings sections">
            {/* An unconstrained item stays visible to every seat; a
                constrained one needs a READ seat that is in its list, so a
                pending or failed role hides it rather than betting on it. */}
            {settingsSections
              .filter((item) => roleAllowed(collabRole, item.roles))
              .map((item) => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive || activeSection === item.key
                      ? 'bg-lumi-elevated text-lumi-text'
                      : 'text-lumi-muted hover:bg-lumi-elevated/60 hover:text-lumi-text'
                  }`}
                >
                  {item.label}
                </NavLink>
              ))}

            {/* Internal admin panel — only an ADMIN (ADMIN_EMAILS allowlist)
                ever sees this link; the /admin route is independently gated. */}
            {isAdmin && (
              <Link
                to="/admin"
                className="mt-3 flex items-center gap-1.5 border-t border-lumi-border px-3 pt-3 text-sm text-lumi-muted transition-colors hover:text-lumi-accent"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Admin
              </Link>
            )}
          </nav>

          <div>{gated(renderSection())}</div>
        </div>
      </div>
    </div>
  );
}

function SettingsPlaceholder({ title, copy }) {
  return (
    <EmptyState title={title} description={copy} />
  );
}
