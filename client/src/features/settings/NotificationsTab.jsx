import { Save, Bell } from 'lucide-react';

export function NotificationsTab({ notifPrefs, setNotifPrefs, notifChanged, setNotifChanged, handleSaveNotifications }) {
  return (
    <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-dark-soft" strokeWidth={2} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">Notifications</h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-lumi-text">Email notifications</p>
            <p className="text-xs text-lumi-muted">Receive emails for execution success/failure</p>
          </div>
          <button
            onClick={() => { setNotifPrefs((prev) => ({ ...prev, emailExecutionUpdates: !prev.emailExecutionUpdates })); setNotifChanged(true); }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifPrefs.emailExecutionUpdates ? 'bg-lumi-gold' : 'bg-surface-border'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifPrefs.emailExecutionUpdates ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-lumi-text mb-1.5">Slack Webhook URL (optional)</label>
          <input
            type="url"
            value={notifPrefs.slackWebhook}
            onChange={(e) => { setNotifPrefs((prev) => ({ ...prev, slackWebhook: e.target.value })); setNotifChanged(true); }}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none transition-all font-mono text-xs"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-lumi-text">Weekly performance digest</p>
            <p className="text-xs text-lumi-muted">Summary email every Monday morning</p>
          </div>
          <button
            onClick={() => { setNotifPrefs((prev) => ({ ...prev, weeklyDigest: !prev.weeklyDigest })); setNotifChanged(true); }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifPrefs.weeklyDigest ? 'bg-lumi-gold' : 'bg-surface-border'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifPrefs.weeklyDigest ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

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
  );
}
