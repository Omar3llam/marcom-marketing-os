// ============================================================
// MARCOM / Lumi — Connection Management (Phase 12, BUYER/STRATEGIST)
// ------------------------------------------------------------
// Reads GET /api/lumi/connections (Integration display fields only). Lists
// connected channels + last sync + a stale/reconnect affordance — this is where
// a stale/failed channel surfaces for the user to fix (closing the 8.2 honesty
// loop). Assembly of existing primitives; no new primitive.
// ============================================================
import { useState } from 'react';
import { toast } from 'sonner';
import { Scale, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useProjectId } from '@/hooks/useProjectId.js';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';

// Kick the OAuth flow for a platform: ask the backend for the consent URL, then
// redirect the browser to it. Meta connect is PROJECT-scoped (the route 400s
// without ?projectId); Google connect is WORKSPACE-scoped (no projectId). The
// old Settings flow passed projectId — without it the connect silently no-ops.
const CONNECT_PATH = { GOOGLE: '/api/auth/google/connect', META: '/api/auth/meta/connect' };
// `returnTo` (optional) is the app path the OAuth callback should send the browser
// back to — Meta threads it through the signed state. Onboarding passes its own
// step so the full-page redirect lands back in the flow, not in Settings.
export async function startConnect(platform, projectId, returnTo) {
  const path = CONNECT_PATH[platform];
  if (!path) return;
  const params = {};
  if (platform === 'META' && projectId) params.projectId = projectId;
  if (returnTo) params.returnTo = returnTo;
  const res = await api.get(path, Object.keys(params).length ? { params } : undefined);
  if (res.data?.oauthUrl) window.location.href = res.data.oauthUrl;
}

const KNOWN = ['META', 'GOOGLE', 'TIKTOK', 'LINKEDIN', 'SNAP'];
const LABEL = { META: 'Meta Ads', GOOGLE: 'Google Ads', TIKTOK: 'TikTok', LINKEDIN: 'LinkedIn', SNAP: 'Snap' };

function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function ConnectionsView({ connections = [], projectId, onSwitchAccount, switching }) {
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
      {KNOWN.map((platform) => {
        const c = byPlatform.get(platform);
        const connected = !!c?.connected;
        const stale = !!c?.stale;
        // A picker only when the token grants more than one ad account — the
        // single-account user sees no change. Lets the user correct connect-time's
        // auto-pick (first active account ≠ always the one with delivery).
        const accounts = connected ? (c.availableAccounts ?? []) : [];
        return (
          <div key={platform} className="flex items-center gap-3 px-4 py-3 border-b border-lumi-border/60 last:border-0">
            <span className="flex-shrink-0">
              {connected && !stale && <CheckCircle2 className="w-4 h-4 text-signal-scale" strokeWidth={1.5} />}
              {connected && stale && <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={1.5} />}
              {!connected && <Plus className="w-4 h-4 text-lumi-subtle" strokeWidth={1.5} />}
            </span>
            <span className="flex-1 text-sm text-lumi-text font-display font-medium">{LABEL[platform] ?? platform}</span>
            {accounts.length > 1 && (
              <select
                value={c.accountId ?? ''}
                disabled={switching === platform}
                onChange={(e) => onSwitchAccount?.(platform, e.target.value)}
                aria-label={`Active ${LABEL[platform] ?? platform} ad account`}
                className="font-mono text-xs bg-lumi-surface border border-lumi-border rounded px-2 py-1 text-lumi-text disabled:opacity-50 max-w-[14rem]"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name ? `${a.name} (${a.id})` : a.id}</option>
                ))}
              </select>
            )}
            {connected ? (
              <span className="font-mono text-xs text-lumi-subtle">
                {switching === platform ? 'switching…' : `last sync ${ago(c.lastSyncedAt)}`}
                {switching !== platform && stale ? ' · stale — reconnect' : ''}
                {switching !== platform && c.health?.lastError ? ` · ${c.health.lastError}` : ''}
              </span>
            ) : CONNECT_PATH[platform] ? (
              <button onClick={() => startConnect(platform, projectId)} className="font-mono text-xs text-lumi-accent hover:underline">connect</button>
            ) : (
              <span className="font-mono text-xs text-lumi-subtle">soon</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page wrapper: fetch + three states ──────────────────────────
export default function Connections() {
  const { data, loading, error, refetch } = useConnections();
  const { projectId } = useProjectId();
  const [switching, setSwitching] = useState(null);

  // Switch the active ad account (server validates it against the token's accounts),
  // then refetch so the new account's freshness shows. The PATCH re-syncs server-
  // side, so by the time it resolves the new account's campaigns have landed.
  const handleSwitchAccount = async (platform, accountId) => {
    if (!accountId || switching) return;
    setSwitching(platform);
    try {
      await api.patch('/api/lumi/connections/account', { platform, accountId });
      toast.success('Ad account switched — re-syncing its campaigns…');
      refetch();
    } catch (err) {
      toast.error(err?.message || "Couldn't switch ad account");
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="decision-title text-lumi-text mb-1">Channels</h1>
      <p className="text-sm text-lumi-muted mb-6">Where Lumi pulls its data from. A second channel lights up cross-channel blended truth.</p>

      {loading && <div className="space-y-3"><CardSkeleton /></div>}
      {!loading && error && <EmptyPanel Icon={Scale} text="Couldn't load connections right now. Try again shortly." />}
      {!loading && !error && (
        <ConnectionsView
          connections={data?.connections ?? []}
          projectId={projectId}
          onSwitchAccount={handleSwitchAccount}
          switching={switching}
        />
      )}
    </div>
  );
}
