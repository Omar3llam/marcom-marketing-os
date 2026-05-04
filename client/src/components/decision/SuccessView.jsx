// ============================================================
// MARCOM / Lumi — SuccessView (FSM state D)
// ------------------------------------------------------------
// Progressive-reveal verdict report. Five sections, each with
// staggered animation-delay (CSS only, no JS timers):
//   0ms   verdict/confidence/risk
//   400ms financial impact
//   800ms why breakdown
//   1200ms mode-specific data
//   1600ms action buttons
// ============================================================
import {
  DollarSign, TrendingDown, Sparkles, ArrowLeft, Palette, Lock,
} from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import InlineBar       from '@/components/ui/InlineBar.jsx';
import { cn }          from '@/lib/utils.js';

const VERDICT_GLOW = {
  KILL:     'shadow-kill-glow border-signal-kill/30',
  SCALE:    'shadow-scale-glow border-signal-scale/30',
  HOLD:     'shadow-hold-glow border-signal-hold/30',
  OPTIMIZE: 'shadow-optimize-glow border-stage-testing/30',
};

const VERDICT_TEXT = {
  KILL:     'text-signal-kill bg-signal-kill-bg',
  SCALE:    'text-signal-scale bg-signal-scale-bg',
  HOLD:     'text-signal-hold bg-signal-hold-bg',
  OPTIMIZE: 'text-stage-testing bg-stage-testing/10',
};

export default function SuccessView({ data, onReset, onCommit }) {
  const isLoss = data.verdict === 'KILL' || data.verdict === 'HOLD';
  return (
    <div className="max-w-3xl mx-auto p-6 lg:p-8">
      {/* Subtle context header */}
      <div className="flex items-center gap-2 text-xs font-mono text-lumi-subtle mb-6">
        <Lock className="w-3 h-3 text-signal-scale" strokeWidth={1.5} />
        Calibrated for context lock · Mode {data.mode === 'campaign' ? '3' : data.mode === 'strategy' ? '2' : '4'}
        <span className="ml-auto inline-flex items-center gap-1">
          Analysis by:{' '}
          {data.agentsUsed?.includes('claude') && <AgentChip agent="claude" />}
          {data.agentsUsed?.includes('openai') && <AgentChip agent="openai" />}
        </span>
      </div>

      {/* ── SECTION 1 — Verdict + confidence + risk (0ms) ── */}
      <section className="reveal flex flex-col sm:flex-row sm:items-center gap-4 mb-6" style={{ animationDelay: '0ms' }}>
        <div className={cn(
          'inline-flex items-center gap-2 rounded-2xl border px-6 py-3',
          'font-display font-bold text-xl',
          VERDICT_TEXT[data.verdict],
          VERDICT_GLOW[data.verdict],
        )}>
          {data.verdict}
        </div>
        <div className="flex-1">
          <h1 className="font-display font-bold text-xl text-lumi-text">{data.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <ConfidenceBar value={data.confidence} />
            <RiskBadge level={data.riskLevel} />
          </div>
        </div>
      </section>

      {/* ── SECTION 2 — Financial impact (400ms) ── */}
      <section className="reveal mb-6" style={{ animationDelay: '400ms' }}>
        <div className={cn(
          'rounded-r-xl bg-lumi-elevated p-4 flex items-start gap-3',
          'border-l-4',
          isLoss ? 'border-l-signal-kill' : 'border-l-signal-scale',
        )}>
          {isLoss
            ? <TrendingDown className="w-5 h-5 text-signal-kill shrink-0 mt-0.5" strokeWidth={1.5} />
            : <DollarSign  className="w-5 h-5 text-signal-scale shrink-0 mt-0.5" strokeWidth={1.5} />}
          <p className="font-display font-semibold text-lumi-text leading-snug">
            {data.financialImpact}
          </p>
        </div>
      </section>

      {/* ── SECTION 3 — Why breakdown (800ms) ── */}
      {data.whyBreakdown.length > 0 && (
        <section className="reveal mb-6" style={{ animationDelay: '800ms' }}>
          <div className="section-label mb-2">Why this verdict</div>
          <ol className="space-y-2 border-l-2 border-lumi-accent/30 pl-3">
            {data.whyBreakdown.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-xs bg-lumi-elevated text-lumi-muted px-2 py-0.5 rounded shrink-0 mt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-lumi-text font-body text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── SECTION 4 — Mode-specific (1200ms) ── */}
      <section className="reveal mb-6" style={{ animationDelay: '1200ms' }}>
        {data.mode === 'campaign' && data.modeSpecificData?.creativeAssets && (
          <CreativeAssetsBlock assets={data.modeSpecificData.creativeAssets} />
        )}
        {data.mode === 'content' && data.modeSpecificData?.contentRewrite && (
          <ContentRewriteBlock rewrite={data.modeSpecificData.contentRewrite} />
        )}
        {data.mode === 'strategy' && data.modeSpecificData?.strategyMarkdown && (
          <StrategyMarkdownBlock markdown={data.modeSpecificData.strategyMarkdown} />
        )}
      </section>

      {/* ── SECTION 5 — Actions (1600ms) ── */}
      <section className="reveal flex flex-col sm:flex-row gap-2 mt-8" style={{ animationDelay: '1600ms' }}>
        <button
          type="button"
          onClick={() => onCommit(data)}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-display font-semibold bg-lumi-accent text-lumi-bg hover:bg-lumi-accent-hover shadow-accent-glow transition-all"
        >
          {data.actionLabel}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 font-display text-sm text-lumi-muted border border-lumi-border hover:text-lumi-text hover:border-lumi-border-strong transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} /> New Decision
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 font-display text-sm text-lumi-subtle border border-lumi-border opacity-50 cursor-not-allowed"
          title="PDF export coming soon"
        >
          Export PDF
        </button>
      </section>
    </div>
  );
}

// ── Confidence + risk ───────────────────────────────────────
function ConfidenceBar({ value }) {
  const v = Math.max(0, Math.min(100, value));
  const fillClass =
      v < 50 ? 'bg-signal-kill'
    : v < 75 ? 'bg-signal-hold'
    :          'bg-signal-scale';
  return (
    <div className="flex-1 max-w-xs">
      <div className="flex items-baseline justify-between text-xs">
        <span className="section-label">Confidence</span>
        <span className="font-mono text-lumi-text tabular-nums">{v}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-lumi-border overflow-hidden"
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={`Confidence ${v}%`}>
        <div className={cn('h-full transition-[width] duration-500', fillClass)} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function RiskBadge({ level }) {
  const cls = level === 'High'   ? 'text-signal-kill bg-signal-kill-bg border-signal-kill/30'
            : level === 'Low'    ? 'text-signal-scale bg-signal-scale-bg border-signal-scale/30'
            :                      'text-signal-hold bg-signal-hold-bg border-signal-hold/30';
  return (
    <span className={cn('font-mono text-xs uppercase tracking-wide px-2 py-1 rounded border', cls)}>
      {level} Risk
    </span>
  );
}

// ── Mode-specific renderers ─────────────────────────────────
function CreativeAssetsBlock({ assets }) {
  const variants = assets?.variants || [];
  if (variants.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="section-label">AI Creative Variants</span>
        <span className="font-mono text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">ChatGPT</span>
      </div>
      {assets.creative_strategy_rationale && (
        <p className="text-xs italic text-lumi-muted mb-3">{assets.creative_strategy_rationale}</p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {variants.map((v, i) => (
          <article key={i} className="w-72 flex-shrink-0 rounded-2xl border border-lumi-border bg-lumi-surface p-4">
            <h4 className="text-xs font-display font-semibold text-lumi-accent">{v.angle_name}</h4>
            <p className="mt-2 font-display text-base text-lumi-text">{v.headline}</p>
            <p className="mt-1 text-sm text-lumi-muted">{v.primary_text}</p>
            {v.visual_direction && (
              <blockquote className="mt-3 flex gap-2 rounded-lg border-l-2 border-yellow-400/50 bg-lumi-bg p-2 text-xs text-lumi-muted">
                <Palette className="w-3.5 h-3.5 shrink-0 text-yellow-300" strokeWidth={1.5} />
                <span className="italic">{v.visual_direction}</span>
              </blockquote>
            )}
            {v.platform_notes && (
              <span className="mt-2 inline-block font-mono text-[10px] bg-lumi-elevated text-lumi-muted border border-lumi-border px-1.5 py-0.5 rounded">
                {v.platform_notes}
              </span>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function ContentRewriteBlock({ rewrite }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">Rewrite</span>
        <span className="font-mono text-xs bg-signal-scale-bg text-signal-scale border border-signal-scale/30 px-2 py-0.5 rounded">
          Score → {rewrite.score}/100
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Pane title="Original" tone="kill" body={rewrite.original} />
        <Pane title="Lumi Rewrite" tone="scale" body={rewrite.rewrite} />
      </div>
      {rewrite.platformNotes && (
        <p className="mt-3 text-xs text-lumi-muted italic">Platform note: {rewrite.platformNotes}</p>
      )}
    </div>
  );
}

function Pane({ title, tone, body }) {
  const cls = tone === 'kill'
    ? 'border-l-2 border-l-signal-kill bg-lumi-bg text-lumi-muted'
    : 'border-l-2 border-l-signal-scale bg-signal-scale-bg/10 text-lumi-text';
  return (
    <div className={cn('rounded-xl border border-lumi-border p-4', cls)}>
      <div className="section-label mb-2">{title}</div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{body || '—'}</p>
    </div>
  );
}

function StrategyMarkdownBlock({ markdown }) {
  // Lightweight markdown — we already validated at the API boundary that
  // it's a string. Render as monospaced pre-block to preserve structure
  // until @tailwindcss/typography is added later.
  return (
    <div>
      <div className="section-label mb-2">Strategy Brief</div>
      <pre className="rounded-xl border border-lumi-border bg-lumi-surface p-4 font-body text-sm text-lumi-text leading-relaxed whitespace-pre-wrap break-words">
        {markdown}
      </pre>
    </div>
  );
}

function AgentChip({ agent }) {
  const cls = agent === 'claude'
    ? 'text-orange-400 bg-orange-500/10 border-orange-500/25'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
  return (
    <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded border', cls)}>
      {agent === 'claude' ? 'Claude' : 'ChatGPT'}
    </span>
  );
}
