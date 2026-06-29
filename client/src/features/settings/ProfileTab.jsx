import { Save, Mail } from 'lucide-react';

export function ProfileTab({ displayName, setDisplayName, currentUser, profileChanged, handleSaveProfile, busy, getInitials }) {
  return (
    <section className="bg-surface-card rounded-xl border border-surface-border p-6 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Mail className="w-4 h-4 text-dark-soft" strokeWidth={2} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">Profile</h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-lumi-gold to-lumi-deep flex items-center justify-center text-surface-card font-display font-bold text-lg shadow-md">
            {getInitials(displayName || currentUser.email)}
          </div>
          <div>
            <p className="text-sm font-medium text-lumi-text">{currentUser.email}</p>
            <p className="text-xs text-lumi-muted">Avatar auto-generated from name</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-lumi-text mb-1.5">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter your name"
            className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-lumi-text mb-1.5">Email Address</label>
          <input
            type="email"
            value={currentUser.email || ''}
            disabled
            className="w-full rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-sm text-dark-soft cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-lumi-muted">To update your email address, contact support.</p>
        </div>

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
  );
}
