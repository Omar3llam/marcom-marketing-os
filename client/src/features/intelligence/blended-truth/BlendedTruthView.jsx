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
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useBlendedTruth } from '@/hooks/useBlendedTruth.js';
import { useAllocation } from '@/hooks/useAllocation.js';
import { AllocationPanel } from './AllocationPanel.jsx';
import IntelligenceSubNav from '../IntelligenceSubNav.jsx';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { appRoutes } from '@/app/routeManifest.js';
import UpgradePrompt from '@/components/plan/UpgradePrompt.jsx';
import { channelPresentation, reconciliationPresentation, ratioText } from './reconciliationPresentation.js';

// One presentation model keeps desktop and mobile evidence identical.
export function BlendedTruthView({ data, role = WORKSPACE_ROLE.STRATEGIST }) {
  const channels = data?.channels ?? [];
  const portfolio = data?.portfolio ?? null;
  if (!channels.length) return <EmptyPanel Icon={Scale} text="No connected channels yet — connect Meta to compare platform-reported revenue with available actual revenue evidence." />;
  const single = channels.length < 2;
  const isStrategist = role === WORKSPACE_ROLE.STRATEGIST;
  const staleChannels = channels.filter(c => c.stale);
  const rows = channels.map(channelPresentation);
  const comparison = reconciliationPresentation(portfolio?.reconciliation);
  const population = portfolio?.reconciliation;
  const channelLink = row => <Link to={`${appRoutes.campaigns}?channel=${encodeURIComponent(row.channel)}`} className="text-lumi-text hover:text-lumi-accent hover:underline transition-colors">{row.name}</Link>;
  const reconciliationDetail = row => <>
    <span>{row.reconciliation.label}</span>
    {row.reconciliation.period && <span className="block mt-1">Evidence period: {row.reconciliation.period}</span>}
    {row.reconciliation.reason && <span className="block mt-1">{row.reconciliation.reason}</span>}
  </>;
  return <div className="space-y-4">
    {staleChannels.length > 0 && <div className="rounded-2xl border border-signal-kill/40 bg-signal-kill-bg px-4 py-3 flex items-start gap-2.5">
      <AlertTriangle className="w-4 h-4 mt-0.5 text-signal-kill flex-shrink-0" strokeWidth={1.5} />
      <p className="text-sm text-lumi-text">{staleChannels.map(c => c.channel).join(', ')} data is stale — reconciliation may be incomplete. Re-sync to refresh the gap.</p>
    </div>}
    {!single && portfolio && <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
      <h2 className="text-sm font-medium text-lumi-text">Platform-reported vs actual revenue</h2>
      <p className="mt-2 text-sm text-lumi-text">Platform ROAS: {ratioText(portfolio.platformRoas)} · Blended revenue efficiency: {ratioText(portfolio.blendedRevenueEfficiency?.value)}</p>
      {population?.status === 'AVAILABLE' ? <>
        <p className="mt-2 text-sm text-lumi-text font-mono">Revenue gap: {comparison.gap} from actual revenue (gap as a share of platform-reported revenue).</p>
        <p className="mt-1 text-sm text-lumi-muted">Across {population.reconciledCount} of {population.totalChannelCount} channels with comparable evidence{population.reconciledCount < population.totalChannelCount ? ' — partial population; excluded channels are not reconciled.' : '.'}</p>
        <p className="mt-1 text-sm text-lumi-muted">Evidence period: {comparison.period}</p>
        {comparison.reason && <p className="mt-1 text-sm text-lumi-muted">{comparison.reason}</p>}
      </> : <p className="mt-2 text-sm text-lumi-muted">Portfolio revenue gap {comparison.label.toLowerCase()}: {comparison.reason}</p>}
      {population && <p className="mt-1 text-sm text-lumi-muted font-mono">{population.reconciledCount} reconciled · {population.unverifiedCount} unverified · {population.unavailableCount} unavailable.</p>}
    </div>}
    {single && <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
      <p className="text-sm text-lumi-text font-medium">Blended truth reconciles across ≥2 channels.</p>
      <p className="mt-1 text-sm text-lumi-muted">Only {rows[0].name} is present. Channel evidence appears below when your role permits; connect a second channel for a portfolio comparison.</p>
    </div>}
    {isStrategist && <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
      <section aria-label="Channel revenue evidence records" className="sm:hidden divide-y divide-lumi-border text-sm">
        {rows.map(row => <article key={row.id} aria-label={row.name + ' revenue evidence'} className="p-4 text-lumi-text break-words">
          <h3 className="font-medium">{channelLink(row)}</h3>
          <dl className="mt-3 space-y-3">
            {[['Platform ROAS', row.platformRoas], ['Blended efficiency', row.blendedEfficiency], ['Gap', row.reconciliation.gap], ['Reconciliation', reconciliationDetail(row)]].map(([label, value]) => <div key={label}><dt className="text-lumi-muted">{label}</dt><dd className="mt-1">{value}</dd></div>)}
          </dl>
        </article>)}
      </section>
      <table className="hidden sm:table w-full text-sm">
        <caption className="sr-only">Channel revenue evidence comparison</caption>
        <thead><tr className="text-left text-lumi-muted border-b border-lumi-border">
          {['Channel', 'Platform ROAS', 'Blended efficiency', 'Gap', 'Reconciliation'].map(label => <th key={label} scope="col" className="px-4 py-2.5 font-medium">{label}</th>)}
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-b border-lumi-border/60 text-lumi-text">
          <th scope="row" className="px-4 py-2.5 font-medium text-left">{channelLink(row)}</th>
          <td className="px-4 py-2.5 font-mono">{row.platformRoas}</td>
          <td className="px-4 py-2.5 font-mono">{row.blendedEfficiency}</td>
          <td className="px-4 py-2.5 font-mono">{row.reconciliation.gap}</td>
          <td className="px-4 py-2.5">{reconciliationDetail(row)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
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
      <p className="text-sm text-lumi-muted mb-6">Compare platform-reported revenue with available actual revenue evidence.</p>

      <IntelligenceSubNav />

      {/* Tier gate wins over every other state (mirrors IncrementalityPanel): a 403
          from requirePlan('GROWTH') is an honest LOCKED state, not a failure —
          checked first so a gated workspace never sees an error flash. */}
      {gated && <UpgradePrompt feature="Blended Truth" requiredPlan="GROWTH" />}

      {!gated && loading && <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>}
      {!gated && !loading && error && (
        <div className="flex flex-col items-center gap-3">
          <EmptyPanel Icon={AlertTriangle} text="We couldn't load Blended Truth right now. It compares platform-reported revenue with available actual revenue evidence." />
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
