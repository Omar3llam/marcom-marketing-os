// ============================================================
// MARCOM / Lumi — Connection Management (Phase 12, BUYER/STRATEGIST)
// ------------------------------------------------------------
// Reads GET /api/lumi/connections (Integration display fields only). Lists
// connected channels + last sync + a stale/reconnect affordance — this is where
// a stale/failed channel surfaces for the user to fix (closing the 8.2 honesty
// loop). Assembly of existing primitives; no new primitive.
// ============================================================
import { Scale, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useConnections } from '@/hooks/useConnections.js';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';

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
export function ConnectionsView({ connections = [] }) {
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
      {KNOWN.map((platform) => {
        const c = byPlatform.get(platform);
        const connected = !!c?.connected;
        const stale = !!c?.stale;
        return (
          <div key={platform} className="flex items-center gap-3 px-4 py-3 border-b border-lumi-border/60 last:border-0">
            <span className="flex-shrink-0">
              {connected && !stale && <CheckCircle2 className="w-4 h-4 text-signal-scale" strokeWidth={1.5} />}
              {connected && stale && <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={1.5} />}
              {!connected && <Plus className="w-4 h-4 text-lumi-subtle" strokeWidth={1.5} />}
            </span>
            <span className="flex-1 text-sm text-lumi-text font-display font-medium">{LABEL[platform] ?? platform}</span>
            {connected ? (
              <span className="font-mono text-xs text-lumi-subtle">
                last sync {ago(c.lastSyncedAt)}{stale ? ' · stale — reconnect' : ''}
                {c.health?.lastError ? ` · ${c.health.lastError}` : ''}
              </span>
            ) : (
              <span className="font-mono text-xs text-lumi-accent">connect</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page wrapper: fetch + three states ──────────────────────────
export default function Connections() {
  const { data, loading, error } = useConnections();
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="decision-title text-lumi-text mb-1">Connected Channels</h1>
      <p className="text-sm text-lumi-muted mb-6">Where Lumi pulls its data from. A second channel lights up cross-channel blended truth.</p>

      {loading && <div className="space-y-3"><CardSkeleton /></div>}
      {!loading && error && <EmptyPanel Icon={Scale} text="Couldn't load connections right now. Try again shortly." />}
      {!loading && !error && <ConnectionsView connections={data?.connections ?? []} />}
    </div>
  );
}
