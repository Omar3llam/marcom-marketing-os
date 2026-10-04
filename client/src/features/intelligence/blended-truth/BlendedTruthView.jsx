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
import { AllocationPanel } from './AllocationPanel.jsx';
import IntelligenceSubNav from '../IntelligenceSubNav.jsx';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { appRoutes } from '@/app/routeManifest.js';
import UpgradePrompt from '@/components/plan/UpgradePrompt.jsx';
import { gapPresentation, channelGapText } from './gapPresentation.js';

// Null/non-finite ROAS → "—" (honest empty), never a fabricated 0.0× that reads
// as a real (terrible) return. A genuine finite 0 still formats as 0.0×.
const fx = (n) => (n == null || !Number.isFinite(Number(n))) ? '—' : `${Number(n).toFixed(1)}×`;

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function BlendedTruthView({ data, role = WORKSPACE_ROLE.STRATEGIST }) {
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
  const currency = portfolio?.monetaryStatus === 'MONETARY_VALID' ? portfolio.currency : null;
  const gap = gapPresentation(portfolio?.gapPct, portfolio?.gapMinor);
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
          <div className="section-label mb-2 inline-flex items-center gap-1">
            Platform claims vs reality
            <HelpTip variant="popover" content={HELP.BLENDED_TRUTH} />
          </div>
          {portfolio.platformRoas != null && portfolio.blendedRevenueEfficiency?.value != null ? (
            <p className="decision-title text-lumi-text leading-snug">
              Platforms claim <span className="text-lumi-muted">{fx(portfolio.platformRoas)}</span>;
              {' '}blended revenue efficiency is <span className="text-signal-scale font-semibold">{fx(portfolio.blendedRevenueEfficiency.value)}</span>
              <HelpTip variant="popover" content={HELP.BLENDED_ROAS} className="ml-1" />.
            </p>
          ) : (
            <p className="decision-title text-lumi-text leading-snug">Blended monetary comparison unavailable.</p>
          )}
          {currency && portfolio.gapMinor != null && gap.direction !== 'UNAVAILABLE' ? (
            <p className="mt-2 text-sm text-lumi-subtle font-mono">
              {gap.direction === 'MATCH'
                ? 'Platform-reported revenue matches blended revenue for this comparison.'
                : <>Revenue gap: {gap.pctText} {gap.direction === 'ABOVE' ? 'above' : 'below'} · {formatCurrency(gap.magnitudeMinor, currency)} difference from blended revenue (gap as a share of platform-reported revenue).</>}
            </p>
          ) : (
            <p className="mt-2 text-sm text-lumi-subtle font-mono">Monetary comparison unavailable{portfolio.monetaryReason ? `: ${portfolio.monetaryReason}` : '.'}</p>
          )}
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
                Currently validating {channels[0]?.name ?? channels[0]?.channel ?? channels[0]?.channelId} against store truth only —
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
                <th className="px-4 py-2.5 font-medium">Blended efficiency</th>
                <th className="px-4 py-2.5 font-medium">Gap</th>
                <th className="px-4 py-2.5 font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channelId} className="border-b border-lumi-border/60">
                  <td className="px-4 py-2.5 font-mono">
                    {/* Cross-link into the Campaigns page filtered to this channel. */}
                    <Link
                      to={`${appRoutes.campaigns}?channel=${encodeURIComponent(c.channel ?? c.channelId)}`}
                      className="text-lumi-text hover:text-lumi-accent hover:underline transition-colors"
                    >
                      {/* name → channel enum → UUID (last resort). The href filters by
                          channel (platform), so it stays channel-based regardless. */}
                      {c.name ?? c.channel ?? c.channelId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">{fx(c.platformRoas)}</td>
                  <td className="px-4 py-2.5 text-lumi-text font-mono">{fx(c.blendedRevenueEfficiency?.value)}</td>
                  <td className="px-4 py-2.5 font-mono text-lumi-muted">{channelGapText(c.gapPct)}</td>
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
  const { data, loading, error, gated } = useBlendedTruth();
  const allocation = useAllocation();

  const isStrategist = role === WORKSPACE_ROLE.STRATEGIST;
  const channels = data?.channels ?? [];
  const portfolio = data?.portfolio;
  const currency = portfolio?.monetaryStatus === 'MONETARY_VALID' ? portfolio.currency : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="decision-title text-lumi-text mb-1">Blended Truth</h1>
      <p className="text-sm text-lumi-muted mb-6">What platforms claim, reconciled against store truth.</p>

      <IntelligenceSubNav />

      {/* Tier gate wins over every other state (mirrors IncrementalityPanel): a 403
          from requirePlan('GROWTH') is an honest LOCKED state, not a failure —
          checked first so a gated workspace never sees an error flash. */}
      {gated && <UpgradePrompt feature="Blended Truth" requiredPlan="GROWTH" />}

      {!gated && loading && <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>}
      {!gated && !loading && error && (
        <div className="flex flex-col items-center gap-3">
          <EmptyPanel Icon={AlertTriangle} text="We couldn't load Blended Truth right now. It reconciles platform-reported spend against your store's real revenue." />
          <Link to={appRoutes.connections} className="inline-flex items-center gap-1 text-sm font-medium text-lumi-accent hover:underline">
            Connect Meta →
          </Link>
        </div>
      )}
      {!gated && !loading && !error && <BlendedTruthView data={data} role={role} />}

      {/* Reallocate capital — acts on these very channels. STRATEGIST-only (the
          commit gate), and only once there are channels to allocate across. */}
      {!gated && !loading && !error && isStrategist && channels.length > 0 && (
        <AllocationPanel
          currency={currency}
          monetaryReason={portfolio?.monetaryReason}
          canAllocate={Boolean(currency && portfolio?.blendedRevenueEfficiency?.value != null)}
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
