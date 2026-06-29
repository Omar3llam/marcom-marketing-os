// ============================================================
// MARCOM / Lumi — Blended Truth (Phase 11A · STAR 1)
// ------------------------------------------------------------
// Surfaces the "don't trust platform-reported performance" thesis the backend
// already enforces. Consumes BlendedTruthSchema via GET /api/lumi/blended.
//
// THE HONESTY REQUIREMENT: with < 2 connected channels (today's reality) we
// render the honest degenerate state — "needs ≥2 channels to reconcile across
// the portfolio" — NOT a fabricated multi-channel reconciliation. The component
// is built for N channels; the 1-channel case is rendered truthfully.
//
// Role: STRATEGIST sees the full per-channel table; BUYER sees the summary hero.
// Assembly of existing primitives + tokens — no new primitive.
// ============================================================
import { Link } from 'react-router-dom';
import { Scale, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useBlendedTruth } from '@/hooks/useBlendedTruth.js';
import { useAllocation } from '@/hooks/useAllocation.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { AllocationPanel } from './AllocationPanel.jsx';
import IntelligenceSubNav from '../IntelligenceSubNav.jsx';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { appRoutes } from '@/app/routeManifest.js';

const fx = (n) => `${(Number(n) || 0).toFixed(1)}×`;

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function BlendedTruthView({ data, role = WORKSPACE_ROLE.STRATEGIST, currency: currencyProp }) {
  const channels = data?.channels ?? [];
  const portfolio = data?.portfolio ?? null;

  if (channels.length === 0) {
    return (
      <EmptyPanel
        Icon={Scale}
        text="No connected channels yet — connect Meta to start validating platform-reported performance against store truth."
      />
    );
  }

  const single = channels.length < 2;
  // A connected channel carries its own currency (real, per PR #144); the
  // workspace currency threaded from the page is the fallback, then USD.
  const currency = currencyProp ?? channels[0]?.currency ?? 'USD';
  const isStrategist = role === WORKSPACE_ROLE.STRATEGIST;
  const staleChannels = channels.filter((c) => c.stale);

  return (
    <div className="space-y-4">
      {/* Staleness honesty (Phase 12) — never a confident gap over stale inputs. */}
      {staleChannels.length > 0 && (
        <div className="rounded-2xl border border-signal-kill/40 bg-signal-kill-bg px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-signal-kill flex-shrink-0" strokeWidth={1.5} />
          <p className="text-sm text-lumi-text">
            {staleChannels.map((c) => c.channel).join(', ')} data is stale — reconciliation may be incomplete. Re-sync to refresh the gap.
          </p>
        </div>
      )}
      {/* Hero — the gap is the whole point. */}
      {!single && portfolio && (
        <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
          <div className="section-label mb-2">Platform claims vs reality</div>
          <p className="decision-title text-lumi-text leading-snug">
            Platforms claim <span className="text-lumi-muted">{fx(portfolio.platformRoas)}</span>;
            {' '}blended truth says <span className="text-signal-scale font-semibold">{fx(portfolio.blendedRoas)}</span>.
          </p>
          <p className="mt-2 text-sm text-signal-kill font-mono">
            Over-reported by {Math.round(portfolio.gapPct)}% · {formatCurrency(portfolio.gapMinor, currency)} of revenue you&apos;d have over-allocated against.
          </p>
          <p className="mt-1 text-xs text-lumi-subtle font-mono">
            {portfolio.reconciledCount} reconciled · {portfolio.unverifiedCount} unverified (raw platform number, flagged).
          </p>
        </div>
      )}

      {/* Honest single-channel state — NOT a fake reconciliation. */}
      {single && (
        <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-lumi-accent flex-shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-sm text-lumi-text font-display font-medium">
                Blended truth reconciles across ≥2 channels.
              </p>
              <p className="mt-1 text-sm text-lumi-muted">
                Currently validating {channels[0]?.channel ?? channels[0]?.channelId} against store truth only —
                connect a second channel to reconcile the portfolio. We won&apos;t fabricate a multi-channel blend.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Per-channel detail — STRATEGIST only. A table (the evidence), not a chart. */}
      {isStrategist && (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-lumi-subtle border-b border-lumi-border">
                <th className="px-4 py-2.5 font-medium">Channel</th>
                <th className="px-4 py-2.5 font-medium">Platform ROAS</th>
                <th className="px-4 py-2.5 font-medium">Blended ROAS</th>
                <th className="px-4 py-2.5 font-medium">Gap</th>
                <th className="px-4 py-2.5 font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channelId} className="border-b border-lumi-border/60">
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{c.channel ?? c.channelId}</td>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">{fx(c.platformRoas)}</td>
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{fx(c.blendedRoas)}</td>
                  <td className="px-4 py-2.5 font-mono text-signal-kill">{Math.round(c.gapPct)}%</td>
                  <td className="px-4 py-2.5">
                    <span className={`font-mono text-xs ${c.coverage === 'RECONCILED' ? 'text-signal-scale' : 'text-lumi-subtle'}`}>
                      {c.coverage} · {c.confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page wrapper: fetch + three states ──────────────────────────
export default function BlendedTruth() {
  const { role } = useCollabRole();
  const { data, loading, error } = useBlendedTruth();
  const allocation = useAllocation();
  const { workspace } = useWorkspace();

  const isStrategist = role === WORKSPACE_ROLE.STRATEGIST;
  const channels = data?.channels ?? [];
  const currency = channels[0]?.currency ?? workspace?.currency ?? 'USD';

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="decision-title text-lumi-text mb-1">Blended Truth</h1>
      <p className="text-sm text-lumi-muted mb-6">What platforms claim, reconciled against store truth.</p>

      <IntelligenceSubNav />

      {loading && <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>}
      {!loading && error && (
        <div className="flex flex-col items-center gap-3">
          <EmptyPanel Icon={AlertTriangle} text="We couldn't load Blended Truth right now. It reconciles platform-reported spend against your store's real revenue." />
          <Link to={appRoutes.settingsIntegrations} className="inline-flex items-center gap-1 text-sm font-medium text-lumi-accent hover:underline">
            Connect Meta →
          </Link>
        </div>
      )}
      {!loading && !error && <BlendedTruthView data={data} role={role} currency={currency} />}

      {/* Reallocate capital — acts on these very channels. STRATEGIST-only (the
          commit gate), and only once there are channels to allocate across. */}
      {!loading && !error && isStrategist && channels.length > 0 && (
        <AllocationPanel
          currency={currency}
          onPreview={allocation.preview}
          onCommit={allocation.commit}
          plan={allocation.plan}
          previewNote={allocation.previewNote}
          previewing={allocation.previewing}
          previewError={allocation.previewError}
          committed={allocation.committed}
          committing={allocation.committing}
          commitError={allocation.commitError}
          canCommit={isStrategist}
        />
      )}
    </div>
  );
}
