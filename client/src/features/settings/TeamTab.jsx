// ============================================================
// MARCOM / Lumi — TeamTab (Settings · Team & Roles)
// ------------------------------------------------------------
// The roster + invite surface. STRATEGIST-only mutations (invite / change role /
// remove / cancel) — everyone else sees a read-only roster. You can never change
// or remove yourself (controls are hidden for your own row, and the backend
// 400s it too). The "last STRATEGIST" guard lives in the backend; here we just
// surface its honest message via toast. No fabricated data — one member shows
// one member.
//
// Phase 5.12 (R-15) — the read/manage split is now DECLARED, in the route
// manifest, rather than restated here as a literal. The roster is open to every
// member because GET /api/team/members is, and the controls below are gated on
// `manageAudience` because each mutation route carries
// requireCollabRole('STRATEGIST'). Reading the declaration instead of repeating
// it is what keeps this tab and the section gate from drifting into two
// different answers.
//
// `roleAllowed` is deliberate rather than `role === STRATEGIST`: since 5.11
// `role` is null whenever the seat was not READ, and null is in no allow-list,
// so an unresolved seat gets the read-only roster — never the controls.
// ============================================================
import { useState } from 'react';
import { UserPlus, Trash2, Shield, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useTeam } from '@/hooks/useTeam.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { settingsSection } from '@/app/routeManifest.js';

const ROLES = ['STRATEGIST', 'BUYER', 'CLIENT'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initials(email) {
  return (email || '?').slice(0, 2).toUpperCase();
}

function daysUntil(iso) {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return Math.max(0, d);
}

function Card({ title, icon: Icon, children }) {
  return (
    <section className="bg-white rounded-xl border border-surface-border/80 p-6 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-dark-soft" strokeWidth={2} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-dark-soft">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function RoleBadge({ role }) {
  return (
    <span className="inline-flex items-center rounded-full bg-lumi-elevated border border-surface-border px-2.5 py-0.5 text-xs font-medium text-lumi-text">
      {role}
    </span>
  );
}

export default function TeamTab() {
  const { role } = useCollabRole();
  const isStrategist = roleAllowed(role, settingsSection('team')?.manageAudience);
  const {
    members, pendingInvitations, isLoading, error,
    isInviting, invite, changeRole, removeMember, cancelInvitation,
  } = useTeam();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('BUYER');
  const [confirmingId, setConfirmingId] = useState(null);

  const onInvite = async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!EMAIL_RE.test(email)) { toast.error('Enter a valid email address.'); return; }
    try {
      const res = await invite(email, inviteRole);
      toast.success(
        res?.emailSent ? `Invitation sent to ${email}` : `Invitation created for ${email} (email delivery is not configured)`,
      );
      setInviteEmail('');
      setInviteRole('BUYER');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send the invitation.');
    }
  };

  const onChangeRole = async (userId, collabRole) => {
    try { await changeRole(userId, collabRole); toast.success('Role updated'); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not change the role.'); }
  };

  const onRemove = async (userId) => {
    setConfirmingId(null);
    try { await removeMember(userId); toast.success('Member removed'); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not remove the member.'); }
  };

  const onCancelInvite = async (id) => {
    try { await cancelInvitation(id); toast.success('Invitation cancelled'); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not cancel the invitation.'); }
  };

  if (isLoading) {
    return <Card title="Team & Roles" icon={Shield}><p className="text-sm text-lumi-muted">Loading team…</p></Card>;
  }
  if (error) {
    return <Card title="Team & Roles" icon={Shield}><p className="text-sm text-signal-kill">{error}</p></Card>;
  }

  return (
    <>
      {/* ── Members ── */}
      <Card title="Members" icon={Shield}>
        <div className="divide-y divide-surface-border/70">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-lumi-gold to-lumi-deep flex items-center justify-center text-surface-card font-display font-bold text-xs shadow-sm">
                {initials(m.email)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-lumi-text truncate">
                  {m.email}{m.isSelf && <span className="text-lumi-muted font-normal"> (you)</span>}
                </p>
              </div>

              {isStrategist && !m.isSelf ? (
                <>
                  <select
                    value={m.collabRole}
                    onChange={(e) => onChangeRole(m.id, e.target.value)}
                    className="rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-xs text-lumi-text focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none"
                    aria-label={`Role for ${m.email}`}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {confirmingId === m.id ? (
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => onRemove(m.id)} className="text-xs font-medium text-signal-kill hover:underline">Confirm</button>
                      <button onClick={() => setConfirmingId(null)} className="text-xs text-lumi-muted hover:text-lumi-text">Cancel</button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(m.id)}
                      className="inline-flex items-center gap-1 text-xs text-dark-soft hover:text-signal-kill transition-colors"
                      aria-label={`Remove ${m.email}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Remove
                    </button>
                  )}
                </>
              ) : (
                <RoleBadge role={m.collabRole} />
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Pending invitations ── */}
      {pendingInvitations.length > 0 && (
        <Card title="Pending invitations" icon={Clock}>
          <div className="divide-y divide-surface-border/70">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-lumi-text truncate">{inv.email}</p>
                  <p className="text-xs text-lumi-muted">Expires in {daysUntil(inv.expiresAt)} days</p>
                </div>
                <RoleBadge role={inv.collabRole} />
                {isStrategist && (
                  <button
                    onClick={() => onCancelInvite(inv.id)}
                    className="text-xs text-dark-soft hover:text-signal-kill transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Invite form ── */}
      <Card title="Invite a teammate" icon={UserPlus}>
        {isStrategist ? (
          <form onSubmit={onInvite} className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1 rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-lumi-text placeholder:text-dark-soft focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="rounded-lg border border-surface-border bg-surface-card px-2.5 py-2 text-sm text-lumi-text focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 outline-none"
              aria-label="Invite role"
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              type="submit"
              disabled={isInviting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-dark-base px-4 py-2 text-sm font-medium text-surface-card hover:bg-dark-soft disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isInviting ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : <UserPlus className="w-4 h-4" strokeWidth={2} />}
              Send invite
            </button>
          </form>
        ) : (
          <p className="text-sm text-lumi-muted">Only Strategists can invite team members.</p>
        )}
      </Card>
    </>
  );
}
