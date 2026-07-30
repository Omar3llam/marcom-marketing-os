// ============================================================
// MARCOM / Lumi — Home · Connection Health Strip (UI-2)
// ------------------------------------------------------------
// The daily-home "is data flowing?" signal. Reads the same
// GET /api/lumi/connections contract the Channels page uses, so
// every value (connected · stale · last sync) traces to a real
// Integration row — no fabricated status. Read-only on Home;
// connecting/reconnecting lives on the Channels page.
// Honest states: skeleton while loading, honest line on error,
// "not connected" / "stale" surfaced plainly.
// ============================================================
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Plug } from 'lucide-react';
import { useConnections } from '@/hooks/useConnections.js';
import { appRoutes } from '@/app/routeManifest.js';

// The two live connectors (TikTok/LinkedIn are "coming soon" on the Channels page).
const CHANNELS = [
  { key: 'META', label: 'Meta' },
  { key: 'GOOGLE', label: 'Google' },
];

function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function ConnectionHealthStrip({ compact = false }) {
  const { data, loading, error } = useConnections();

  if (loading) {
    return compact
      ? <div className="h-[64px] animate-pulse rounded-xl border border-lumi-border bg-lumi-elevated" aria-hidden="true" />
      : <div className="mb-6 h-[42px] rounded-xl border border-lumi-border bg-lumi-elevated animate-pulse" aria-hidden="true" />;
  }

  if (error) {
    // The rail is narrow but must not go silent — a channel that stopped
    // flowing is often *why* the decisions above look wrong.
    return compact
      ? (
        <div className="space-y-1">
          <p className="section-label text-lumi-muted">Channels</p>
          <p className="text-xs text-dark-soft">Couldn&apos;t load channel status.</p>
        </div>
      )
      : (
        <div className="mb-6 rounded-xl border border-lumi-border bg-lumi-elevated px-4 py-2.5 font-mono text-xs text-dark-soft">
          Couldn&apos;t load channel status right now.
        </div>
      );
  }

  const connections = data?.connections ?? [];
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
  // No channel connected at all → the strip becomes actionable (its one job on
  // Home is honest status; connecting still lives on the Channels page).
  const hasConnector = connections.some((c) => c.connected);

  // ── Rail variant ──────────────────────────────────────────
  // One line per channel, stacked. Same source, same three states, no icons —
  // at 280px the icon + label + status row wraps into unreadable fragments.
  if (compact) {
    return (
      <div className="space-y-2">
        <p className="section-label text-lumi-muted">Channels</p>
        {CHANNELS.map(({ key, label }) => {
          const c = byPlatform.get(key);
          const connected = !!c?.connected;
          const stale = !!c?.stale;
          return (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-lumi-text">{label}</span>
              <span
                className={`section-label truncate ${
                  !connected ? 'text-lumi-muted' : stale ? 'text-signal-kill' : 'text-signal-scale'
                }`}
              >
                {!connected ? 'Not connected' : stale ? `Stale · ${ago(c.lastSyncedAt)}` : `Synced ${ago(c.lastSyncedAt)}`}
              </span>
            </div>
          );
        })}
        {!hasConnector && (
          <Link
            to={appRoutes.settingsIntegrations}
            className="section-label inline-block text-lumi-accent hover:underline"
          >
            Connect →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-lumi-border bg-lumi-elevated px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted">
        Channels
      </span>
      {CHANNELS.map(({ key, label }) => {
        const c = byPlatform.get(key);
        const connected = !!c?.connected;
        const stale = !!c?.stale;
        const Icon = !connected ? Plug : stale ? AlertTriangle : CheckCircle2;
        const tone = !connected ? 'text-dark-subtle' : stale ? 'text-signal-kill' : 'text-signal-scale';
        const status = !connected
          ? 'not connected'
          : stale
            ? `stale · last sync ${ago(c.lastSyncedAt)}`
            : `synced ${ago(c.lastSyncedAt)}`;
        return (
          <span key={key} className="inline-flex items-center gap-1.5" title={status}>
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${tone}`} strokeWidth={1.5} />
            <span className="font-display text-xs font-medium text-dark-base">{label}</span>
            <span className="font-mono text-[10px] text-dark-soft">{status}</span>
          </span>
        );
      })}
      {!hasConnector && (
        <Link
          to={appRoutes.settingsIntegrations}
          className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] font-medium text-lumi-accent hover:underline"
        >
          Connect →
        </Link>
      )}
    </div>
  );
}
