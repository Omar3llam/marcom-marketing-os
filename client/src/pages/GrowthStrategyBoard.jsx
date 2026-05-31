// ============================================================
// MARCOM / Lumi — GrowthStrategyBoard  (/app/growth)
// ------------------------------------------------------------
// CMO war room: 4 macro metrics + horizontal active-bets strip
// + memory-layer timeline. MRR / LTV:CAC / CAC don't exist as
// backend endpoints yet — those tiles render the section label
// with an honest "—" placeholder rather than fabricating numbers.
// ============================================================
import { useMemo } from 'react';
import { Target, Brain, Zap } from 'lucide-react';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { cn } from '@/lib/utils.js';
import { fmtRelative } from '@/lib/dateUtils.js';

export default function GrowthStrategyBoard() {
  const { campaigns, summary, loading } = useCampaignFeed();

  // Active bets = pending alerts, treated as hypotheses under test.
  const bets = useMemo(() => {
    const out = [];
    for (const c of campaigns) {
      for (const a of c.alerts ?? []) {
        out.push({
          id:        a.action_id,
          status:    a.action_plan?.status === 'PENDING' ? 'ACTIVE' : 'CONCLUDED',
          title:     a.action_plan?.action || a.analysis?.root_cause || c.campaign_id,
          campaign:  c.campaign_id,
          mode:      'MODE 3',
          confidence: confidenceFor(a),
          conclusion: a.action_plan?.status === 'PENDING' ? null : 'Awaiting outcome data',
        });
      }
    }
    return out.slice(0, 12);
  }, [campaigns]);

  // Memory entries — the orchestrator + temporal observer write
  // these into DecisionMemory. We surface them via /api/lumi/feed
  // (each alert carries a `memory` array of last-3 prior decisions).
  const learnings = useMemo(() => {
    const out = [];
    for (const c of campaigns) {
      for (const a of c.alerts ?? []) {
        for (const m of a.memory ?? []) {
          out.push({
            id:           `${a.action_id}-${m.actionType}-${m.recordedAt || ''}`,
            campaign:     c.campaign_id,
            actionType:   m.actionType,
            rationale:    m.decisionRationale || m.rationale || '—',
            sustainable:  m.isSustainable,
            durationHrs:  m.impactDurationHrs,
            recordedAt:   m.recordedAt,
          });
        }
      }
    }
    return out.slice(0, 8);
  }, [campaigns]);

  return (
    <div className="flex flex-col h-full p-6 lg:p-8 animate-fade-in">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="decision-title text-lumi-text">Growth Strategy</h1>
          <p className="text-lumi-muted text-sm mt-1">The macro view — CMO memory layer active</p>
        </div>
        <div className="inline-flex items-center gap-1.5 bg-stage-testing/10 border border-stage-testing/25 text-stage-testing font-mono text-xs px-3 py-1 rounded-full self-start sm:self-auto">
          <Brain className="w-3 h-3" strokeWidth={1.5} />
          Memory Layer: {learnings.length} learning{learnings.length === 1 ? '' : 's'}
        </div>
      </header>

      {/* ── MACRO METRICS ───────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <MetricCard
          label="MRR Target"
          primary="—"
          secondary="No revenue source connected"
          footer="Connect Stripe to populate"
        />
        <MetricCard
          label="LTV:CAC"
          primary="—"
          secondary="No CRM source connected"
          footer="Awaiting customer-data integration"
        />
        <MetricCard
          label="Blended CPA"
          primary={summary.blendedCpa != null ? `$${summary.blendedCpa.toFixed(2)}` : '—'}
          secondary={loading ? 'Loading…' : (summary.pending ? 'Avg across pending decisions' : 'No campaigns yet')}
          footer={summary.blendedCpa != null ? <Sparkline values={[summary.blendedCpa]} /> : null}
        />
        <MetricCard
          label="Active Campaigns"
          primary={summary.total}
          secondary={`${summary.byVerdict.SCALE || 0} Scaling · ${summary.byVerdict.HOLD || 0} Holding · ${summary.byVerdict.KILL || 0} Killing`}
        />
      </section>

      {/* ── ACTIVE STRATEGIC BETS ───────────────────────────── */}
      <section className="mb-10">
        <div className="section-label">Active Strategic Bets</div>
        <p className="mt-1 text-lumi-muted text-sm mb-4">Hypotheses currently being tested by the system</p>

        {bets.length === 0 ? (
          <EmptyBets loading={loading} />
        ) : (
          <div
            className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2"
            role="list"
            aria-label="Active strategic bets"
          >
            {bets.map((b) => <BetCard key={b.id} bet={b} />)}
          </div>
        )}
      </section>

      {/* ── MEMORY LAYER TIMELINE ───────────────────────────── */}
      <section className="flex-1 min-h-0">
        <div className="section-label">System Learnings — The Memory Layer</div>
        <p className="mt-1 text-lumi-muted text-sm mb-4">
          Rules the AI has learned from your campaigns. Applied to every future decision.
        </p>

        {learnings.length === 0 ? (
          <EmptyMemory />
        ) : (
          <ol className="relative">
            <span aria-hidden="true" className="absolute left-4 top-2 bottom-2 w-px bg-lumi-border" />
            {learnings.map((l) => <MemoryRow key={l.id} l={l} />)}
          </ol>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function MetricCard({ label, primary, secondary, footer }) {
  return (
    <article className="bg-lumi-surface border border-lumi-border rounded-xl p-5 flex flex-col">
      <div className="section-label">{label}</div>
      <div className="mt-2 metric-display text-lumi-text">{primary}</div>
      <div className="mt-1 text-xs text-lumi-muted">{secondary}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </article>
  );
}

function BetCard({ bet }) {
  const statusColor =
    bet.status === 'ACTIVE'    ? 'text-lumi-accent  bg-lumi-accent-soft'
  : bet.status === 'PAUSED'    ? 'text-signal-hold  bg-signal-hold-bg'
  :                              'text-signal-scale bg-signal-scale-bg';

  const confColor =
    bet.confidence < 40 ? 'bg-signal-kill'
  : bet.confidence < 70 ? 'bg-signal-hold'
  :                        'bg-signal-scale';

  return (
    <article
      role="listitem"
      className="w-72 flex-shrink-0 bg-lumi-surface border border-lumi-border rounded-2xl p-5 hover:border-lumi-border-strong transition-all"
    >
      <span className={cn('inline-block font-mono text-xs uppercase px-2 py-0.5 rounded', statusColor)}>
        {bet.status}
      </span>
      <h3 className="font-display font-semibold text-sm text-lumi-text leading-snug mt-2 line-clamp-3">{bet.title}</h3>
      <p className="text-xs text-lumi-subtle mt-1 truncate">{bet.campaign}</p>

      <div className="mt-4">
        <div className="flex items-center justify-between font-mono text-xs text-lumi-muted">
          <span>Confidence</span>
          <span className="text-lumi-text">{bet.confidence}%</span>
        </div>
        <div
          className="h-1.5 rounded-full bg-lumi-border mt-1.5 overflow-hidden"
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bet.confidence}
          aria-label={`Confidence ${bet.confidence}%`}
        >
          <div className={cn('h-full', confColor)} style={{ width: `${bet.confidence}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 font-mono text-xs">
        <span className="text-lumi-subtle">{bet.mode}</span>
      </div>

      {bet.conclusion && (
        <div className="bg-signal-scale-bg border-t border-signal-scale/25 -mx-5 -mb-5 px-5 py-2 mt-4 rounded-b-2xl">
          <p className="font-mono text-xs text-signal-scale">Result: {bet.conclusion}</p>
        </div>
      )}
    </article>
  );
}

function MemoryRow({ l }) {
  const dotColor = l.sustainable === true ? 'bg-signal-scale'
                 : l.sustainable === false ? 'bg-signal-hold'
                 : 'bg-stage-testing';
  const impactColor = l.sustainable === true
    ? 'text-signal-scale bg-signal-scale-bg border-signal-scale/25'
    : 'text-signal-hold bg-signal-hold-bg border-signal-hold/25';
  const impactLabel = l.sustainable === true ? 'HIGH IMPACT'
                    : l.sustainable === false ? 'REGRESSED' : 'PENDING';

  return (
    <li className="relative flex gap-4 pl-10 pb-5">
      <span aria-hidden="true" className={cn('absolute left-[14px] top-1 w-2 h-2 rounded-full', dotColor)} />
      <span className="font-mono text-xs text-lumi-subtle w-24 flex-shrink-0 pt-0.5">
        {fmtRelative(l.recordedAt)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm text-lumi-text leading-relaxed">{l.rationale}</p>
        <div className="flex flex-wrap gap-2 mt-1.5">
          <Tag>{(l.actionType || 'OBSERVATION').toUpperCase()}</Tag>
          <Tag>{l.campaign}</Tag>
          {l.durationHrs ? <Tag>{l.durationHrs}H WINDOW</Tag> : null}
          <span className={cn('font-mono text-xs uppercase tracking-wide px-2 py-0.5 rounded border', impactColor)}>
            {impactLabel}
          </span>
        </div>
      </div>
    </li>
  );
}

function Tag({ children }) {
  return (
    <span className="font-mono text-xs bg-lumi-elevated border border-lumi-border text-lumi-muted px-2 py-0.5 rounded">
      {children}
    </span>
  );
}

function Sparkline({ values = [] }) {
  if (values.length === 0) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 60;
    const y = 16 - ((v - min) / range) * 16;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="60" height="16" viewBox="0 0 60 16" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.25" points={pts} className="text-lumi-accent" />
    </svg>
  );
}

function EmptyBets({ loading }) {
  if (loading) return <div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading…</div>;
  return (
    <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-10 text-center">
      <Target className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
      <p className="mt-3 font-display text-lumi-text">No strategic bets active.</p>
      <p className="mt-1 text-lumi-muted text-sm">
        Analyze your first campaign to generate strategic recommendations.
      </p>
    </div>
  );
}

function EmptyMemory() {
  return (
    <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-10 text-center">
      <Zap className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
      <p className="mt-3 font-display text-lumi-text">The memory layer is empty.</p>
      <p className="mt-1 text-lumi-muted text-sm">
        Lumi will learn from your campaigns and store rules here.
      </p>
    </div>
  );
}

function confidenceFor(alert) {
  const v = alert?.analysis?.verdict;
  const p = alert?.priority;
  let base = v === 'SCALE' ? 78 : v === 'HOLD' ? 55 : v === 'KILL' ? 90 : 50;
  if (p === 'HIGH') base = Math.min(95, base + 8);
  if (p === 'LOW')  base = Math.max(20, base - 12);
  return base;
}
