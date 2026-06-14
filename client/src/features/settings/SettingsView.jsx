import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { sendPasswordResetEmail, auth } from '@/firebase.js';
import { toast } from 'sonner';
import { clearContextCache } from '@/router/ProtectedRoute.jsx';
import { settingsSections } from '@/app/routeManifest.js';
import { EmptyState, PageHeader } from '@/design-system/patterns';
import Connections from '@/pages/Connections.jsx';
import { ProfileTab } from './ProfileTab.jsx';
import { WorkspaceTab } from './WorkspaceTab.jsx';
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

  const renderSection = () => {
    switch (activeSection) {
      case 'integrations':
        // ONE connection-status implementation: the workspace-scoped <Connections>
        // surface (GET /api/lumi/connections), not a second Meta-only panel.
        return <Connections />;
      case 'team':
        return <SettingsPlaceholder title="Team & Roles" copy="Invite teammates, assign roles, and review workspace access from this settings section." />;
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
            {settingsSections.map((item) => (
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
          </nav>

          <div>{renderSection()}</div>
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
