// ============================================================
// MARCOM / Lumi — Home · Connection Health Strip (UI-2)
// ------------------------------------------------------------
// Published readiness, latest-attempt availability and successful-sync
// completeness remain independent. This is concise context, not diagnostics.
// ============================================================
import { Link } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { useConnections } from '@/hooks/useConnections.js';
import { appRoutes } from '@/app/routeManifest.js';
import { connectorFactLabels } from '@/features/connectors/connectorPresentation.js';

// The two live connectors (TikTok/LinkedIn are "coming soon" at /app/connections).
const CHANNELS = [
  { key: 'META', label: 'Meta' },
  { key: 'GOOGLE', label: 'Google' },
];

export default function ConnectionHealthStrip({ compact = false, state = null }) {
  const ownState = useConnections();
  // Overview passes the same read it used to classify PARTIAL, so its rail
  // cannot independently report a different answer from a duplicate request.
  const { data, loading, error } = state ?? ownState;

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
          <p className="text-sm text-dark-soft">Couldn&apos;t load channel status.</p>
        </div>
      )
      : (
        <div className="mb-6 rounded-xl border border-lumi-border bg-lumi-elevated px-4 py-2.5 font-mono text-sm text-dark-soft">
          Couldn&apos;t load channel status right now.
        </div>
      );
  }

  const connections = data?.connections ?? [];
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
  // No channel connected at all → the strip becomes actionable (its one job on
  // Home is honest status; connecting lives at /app/connections).
  const hasConnector = connections.some((c) => c.connected);

  // ── Rail variant ──────────────────────────────────────────
  // Stacked channel facts wrap in the narrow rail; no adverse axis is truncated.
  if (compact) {
    return (
      <div className="space-y-2">
        <p className="section-label text-lumi-muted">Channels</p>
        {CHANNELS.map(({ key, label }) => {
          const c = byPlatform.get(key);
          const connected = !!c?.connected;
          const labels = connected ? connectorFactLabels(c) : ['Not connected'];
          return (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-lumi-text">{label}</span>
              <span className="min-w-0 text-right text-sm text-lumi-muted">
                {labels.map((text) => <span key={text} className="block break-words">{text}</span>)}
              </span>
            </div>
          );
        })}
        {!hasConnector && (
          <Link
            to={appRoutes.connections}
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
        const labels = connected ? connectorFactLabels(c) : ['Not connected'];
        return (
          <span key={key} className="inline-flex min-w-0 items-center gap-1.5">
            <Plug className="w-3.5 h-3.5 flex-shrink-0 text-dark-subtle" strokeWidth={1.5} />
            <span className="font-display text-sm font-medium text-dark-base">{label}</span>
            <span className="min-w-0 font-mono text-sm text-dark-soft">
              {labels.map((text) => <span key={text} className="block break-words">{text}</span>)}
            </span>
          </span>
        );
      })}
      {!hasConnector && (
        <Link
          to={appRoutes.connections}
          className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] font-medium text-lumi-accent hover:underline"
        >
          Connect →
        </Link>
      )}
    </div>
  );
}
