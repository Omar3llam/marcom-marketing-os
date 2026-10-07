// ============================================================
// MARCOM / Lumi — Connectors (the destination for /app/connections)
// ------------------------------------------------------------
// FE-04. This surface did not change; its ADDRESS did. It used to render only
// as a tab inside Settings, while `/app/connections` — the URL named for it —
// was a <Navigate> pointing back into that tab. Same shape B8-03 met at
// /app/decisions: the URL exists, the surface does not live at it. Reclaimed,
// not invented.
//
// Nine production call sites send an operator here ("Connect a channel" in the
// Sidebar and the first-run interrupt, plus the gates on Blended Truth, Proof,
// Incrementality and Reports). The most important instruction the product
// gives a new account was resolving into a settings sub-tab.
//
// Settings › Channels is now a REDIRECT here, never a second rendering of the
// same object (B7 Ruling 2). The page keeps its operator-facing noun,
// "Channels" — the nav noun is FE-05's call, not this slice's.
//
// Reads GET /api/lumi/connections (Integration display fields only). Assembly
// of existing primitives; no new primitive.
// ============================================================
import { useState } from 'react';
import { toast } from 'sonner';
import { Scale, Plus, Plug } from 'lucide-react';
import { useConnections } from '@/hooks/useConnections.js';
import { useProjectId } from '@/hooks/useProjectId.js';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { PageHeader } from '@/design-system/patterns';
// startConnect lives in its own module so onboarding's ConnectStep can start an
// OAuth flow without importing this whole surface. The requests go through the
// feature service — a destination under features/ may not call the shared api
// client directly (arch-check CHECK 2B).
import { startConnect } from './startConnect.js';
import { isConnectable, switchAdAccount } from './services.js';
import { connectorFactLabels } from './connectorPresentation.js';

const KNOWN = ['META', 'GOOGLE', 'TIKTOK', 'LINKEDIN', 'SNAP'];
const LABEL = { META: 'Meta Ads', GOOGLE: 'Google Ads', TIKTOK: 'TikTok', LINKEDIN: 'LinkedIn', SNAP: 'Snap' };

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function ConnectionsView({ connections = [], projectId, onSwitchAccount, switching }) {
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
      {KNOWN.map((platform) => {
        const c = byPlatform.get(platform);
        const connected = !!c?.connected;
        // A picker only when the token grants more than one ad account — the
        // single-account user sees no change. Lets the user correct connect-time's
        // auto-pick (first active account ≠ always the one with delivery).
        const accounts = connected ? (c.availableAccounts ?? []) : [];
        return (
          <div key={platform} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-lumi-border/60 last:border-0">
            <span className="flex-shrink-0">
              {connected && <Plug className="w-4 h-4 text-lumi-subtle" strokeWidth={1.5} />}
              {!connected && <Plus className="w-4 h-4 text-lumi-subtle" strokeWidth={1.5} />}
            </span>
            <span className="flex-1 text-sm text-lumi-text font-display font-medium">{LABEL[platform] ?? platform}</span>
            {accounts.length > 1 && (
              <select
                value={c.accountId ?? ''}
                disabled={switching === platform}
                onChange={(e) => onSwitchAccount?.(platform, e.target.value)}
                aria-label={`Active ${LABEL[platform] ?? platform} ad account`}
                className="font-mono text-sm bg-lumi-surface border border-lumi-border rounded px-2 py-1 text-lumi-text disabled:opacity-50 max-w-[14rem]"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name ? `${a.name} (${a.id})` : a.id}</option>
                ))}
              </select>
            )}
            {connected ? (
              <span className="w-full min-w-0 font-mono text-sm text-lumi-muted">
                {switching === platform ? 'switching…' : connectorFactLabels(c, { details: true }).map((label) => (
                  <span key={label} className="block break-words">{label}</span>
                ))}
              </span>
            ) : isConnectable(platform) ? (
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
export default function ConnectorsView() {
  const { data, loading, error, refetch } = useConnections();
  const { projectId } = useProjectId();
  const [switching, setSwitching] = useState(null);
  const connectionReadKnown = !loading && !error && data != null;
  const hasResolvedWorkspace = connectionReadKnown
    && typeof data.workspaceId === 'string' && data.workspaceId.length > 0;

  // Switch the active ad account (server validates it against the token's accounts),
  // then refetch connection truth. The PATCH awaits best-effort sync; its success
  // proves the account switched, not that campaigns landed or data is current.
  const handleSwitchAccount = async (platform, accountId) => {
    if (!accountId || switching) return;
    setSwitching(platform);
    try {
      await switchAdAccount(platform, accountId);
      toast.success('Ad account switched.');
      refetch();
    } catch (err) {
      toast.error(err?.message || "Couldn't switch ad account");
    } finally {
      setSwitching(null);
    }
  };

  return (
    // A destination owns its own page chrome. Nested inside Settings this view
    // brought an <h1> and a max-w of its own under Settings' own PageHeader and
    // grid — a page header inside a page header, the shape FE-02 stripped out
    // of ProofView when Memory took ownership of it.
    //
    // No scroll container of its own: MainLayout's <main> is the ONE vertical
    // scroll owner (pinned by CampaignsView's "single scroll owner" test), and
    // this matches MemoryView, the destination FE-02 landed.
    <div className="max-w-3xl mx-auto px-6 py-8">
      <PageHeader
        title="Channels"
        description="Where Lumi pulls its data from. A second channel lights up cross-channel blended truth."
      />

      {loading && <div className="space-y-3"><CardSkeleton /></div>}
      {!loading && error && <EmptyPanel Icon={Scale} text="Couldn't load connections right now. Try again shortly." />}
      {!loading && !error && !connectionReadKnown && <EmptyPanel Icon={Plug} text="Channel setup unavailable." />}
      {connectionReadKnown && !hasResolvedWorkspace && <EmptyPanel Icon={Plug} text="A workspace is required before channels can be connected." />}
      {hasResolvedWorkspace && (
        <ConnectionsView
          connections={data.connections}
          projectId={projectId}
          onSwitchAccount={handleSwitchAccount}
          switching={switching}
        />
      )}
    </div>
  );
}
