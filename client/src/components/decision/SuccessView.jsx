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
import {
  DecisionTitle,
  MetricValue,
  SectionLabel,
  Text,
  BodyMuted,
  BodySubtle,
  RiskSignal,
  RecommendationStrength,
} from '@/components/primitives';
import { DecisionTrustCluster } from '@/components/assemblies';

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

// Risk level mapping moved to DecisionTrustCluster assembly

export default function SuccessView({ data, onReset, onCommit }) {
  const isLoss = data.verdict === 'KILL' || data.verdict === 'HOLD';
  return (
    <div className="max-w-3xl mx-auto p-6 lg:p-8">
      {/* Subtle context header */}
      <div className="flex items-center gap-2 mb-6">
        <Lock className="w-3 h-3 text-signal-scale" strokeWidth={1.5} />
        <Text as="span" variant="data" intent="subtle" size="xs" className="font-mono">
          Calibrated for context lock · Mode {data.mode === 'campaign' ? '3' : data.mode === 'strategy' ? '2' : '4'}
        </Text>
        <span className="ml-auto inline-flex items-center gap-1">
          <Text as="span" variant="data" intent="subtle" size="xs">
            Analysis by:{' '}
          </Text>
          {data.agentsUsed?.includes('claude') && <AgentChip agent="claude" />}
          {data.agentsUsed?.includes('openai') && <AgentChip agent="openai" />}
        </span>
      </div>

      {/* ── SECTION 1 — Hero Verdict Zone (0ms) ── */}
      <section className="reveal mb-6" style={{ animationDelay: '0ms' }}>
        <DecisionTrustCluster
          verdict={data.verdict}
          title={data.title}
          confidence={data.confidence}
          riskLevel={data.riskLevel}
        />
      </section>

      {/* ── SECTION 2 — Confidence metrics (400ms) ── */}
      <section className="reveal mb-6" style={{ animationDelay: '400ms' }}>
        <ConfidenceCard data={data} />
      </section>

      {/* ── SECTION 3 — Why breakdown (800ms) ── */}
      {data.whyBreakdown.length > 0 && (
        <section className="reveal mb-6" style={{ animationDelay: '800ms' }}>
          <SectionLabel as="div" className="mb-2">Why this verdict</SectionLabel>
          <ol className="space-y-2 border-l-2 border-lumi-accent/30 pl-3">
            {data.whyBreakdown.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <Text as="span" variant="data" intent="muted" size="xs" className="font-mono bg-lumi-elevated px-2 py-0.5 rounded shrink-0 mt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text as="span" variant="body" intent="primary" size="sm" className="leading-relaxed">
                  {item}
                </Text>
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
        <AutonomousRecommendation rec={data.modeSpecificData?.autonomousRecommendation} />
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
// Replaced by semantic primitives: ConfidenceIndicator, RiskSignal

// ── Confidence Card (auditable AI verdict) ──────────────────
function ConfidenceCard({ data }) {
  const { confidence = 0, riskLevel = 'Medium', financialImpact, whyBreakdown = [] } = data;

  return (
    <div className="rounded-xl border border-lumi-border bg-lumi-elevated p-5 shadow-card">
      {/* Title */}
      <SectionLabel as="p" className="mb-4">
        Verdict intelligence
      </SectionLabel>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <MetricValue as="div" className="text-lumi-text tabular-nums">
            {confidence}%
          </MetricValue>
          <BodySubtle as="div" size="xs" className="font-mono mt-0.5">
            Confidence
          </BodySubtle>
        </div>
        <div className="text-center">
          <RiskSignal
            severity={mapRiskLevelToSeverity(riskLevel)}
            showLabel
            showIcon={false}
            className="inline-flex px-3 py-1"
          />
          <BodySubtle as="div" size="xs" className="font-mono mt-0.5">
            Risk level
          </BodySubtle>
        </div>
        <div className="text-center">
          <MetricValue as="div" className="text-lumi-text tabular-nums">
            {whyBreakdown.length}
          </MetricValue>
          <BodySubtle as="div" size="xs" className="font-mono mt-0.5">
            Signals analyzed
          </BodySubtle>
        </div>
      </div>

      {/* Financial impact */}
      {financialImpact && (
        <div className="rounded-lg border border-signal-kill/20 bg-signal-kill-bg px-4 py-2.5">
          <Text as="p" variant="data" intent="danger" size="sm" className="font-mono font-semibold">
            {financialImpact}
          </Text>
        </div>
      )}
    </div>
  );
}

// ── Autonomous Recommendation (Momentum Layer) ───────────────
function AutonomousRecommendation({ rec }) {
  if (!rec?.action) return null;

  return (
    <div className="rounded-2xl border border-lumi-gold/25 bg-lumi-gold/5 p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1.5 h-1.5 rounded-full bg-lumi-gold animate-pulse" />
        <SectionLabel as="p" intent="primary" className="text-lumi-gold">
          Autonomous recommendation
        </SectionLabel>
      </div>

      <DecisionTitle as="p" className="text-base mb-3">
        {rec.action}
      </DecisionTitle>

      {rec.reallocation && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-surface-card border border-surface-border">
          <BodyMuted as="span" size="xs" className="font-mono">
            Reallocation:{' '}
          </BodyMuted>
          <Text as="span" variant="data" intent="primary" size="xs" className="font-mono font-semibold">
            {rec.reallocation}
          </Text>
        </div>
      )}

      <BodyMuted as="p" size="sm" className="leading-relaxed mb-2">
        {rec.rationale}
      </BodyMuted>

      {rec.expectedOutcome && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-border">
          <BodyMuted as="span" size="xs" className="font-mono">
            Expected:{' '}
          </BodyMuted>
          <Text as="span" variant="data" intent="success" size="xs" className="font-mono font-semibold">
            {rec.expectedOutcome}
          </Text>
        </div>
      )}
    </div>
  );
}

// ── Mode-specific renderers ─────────────────────────────────
function CreativeAssetsBlock({ assets }) {
  const variants = assets?.variants || [];
  if (variants.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <SectionLabel as="span">AI Creative Variants</SectionLabel>
        <Text as="span" variant="data" size="xs" className="font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
          ChatGPT
        </Text>
      </div>
      {assets.creative_strategy_rationale && (
        <BodyMuted as="p" size="xs" className="italic mb-3">
          {assets.creative_strategy_rationale}
        </BodyMuted>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {variants.map((v, i) => (
          <article key={i} className="w-72 flex-shrink-0 rounded-2xl border border-lumi-border bg-lumi-surface p-4">
            <Text as="h4" variant="data" intent="secondary" size="xs" className="font-display font-semibold">
              {v.angle_name}
            </Text>
            <Text as="p" variant="body" intent="primary" className="mt-2 font-display">
              {v.headline}
            </Text>
            <BodyMuted as="p" size="sm" className="mt-1">
              {v.primary_text}
            </BodyMuted>
            {v.visual_direction && (
              <blockquote className="mt-3 flex gap-2 rounded-lg border-l-2 border-yellow-400/50 bg-lumi-bg p-2">
                <Palette className="w-3.5 h-3.5 shrink-0 text-yellow-300" strokeWidth={1.5} />
                <BodyMuted as="span" size="xs" className="italic">
                  {v.visual_direction}
                </BodyMuted>
              </blockquote>
            )}
            {v.platform_notes && (
              <Text as="span" variant="data" intent="muted" size="xs" className="mt-2 inline-block font-mono bg-lumi-elevated border border-lumi-border px-1.5 py-0.5 rounded">
                {v.platform_notes}
              </Text>
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
        <SectionLabel as="span">Rewrite</SectionLabel>
        <Text as="span" variant="data" intent="success" size="xs" className="font-mono bg-signal-scale-bg border border-signal-scale/30 px-2 py-0.5 rounded">
          Score → {rewrite.score}/100
        </Text>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Pane title="Original" tone="kill" body={rewrite.original} />
        <Pane title="Lumi Rewrite" tone="scale" body={rewrite.rewrite} />
      </div>
      {rewrite.platformNotes && (
        <BodyMuted as="p" size="xs" className="mt-3 italic">
          Platform note: {rewrite.platformNotes}
        </BodyMuted>
      )}
    </div>
  );
}

function Pane({ title, tone, body }) {
  const cls = tone === 'kill'
    ? 'border-l-2 border-l-signal-kill bg-lumi-bg'
    : 'border-l-2 border-l-signal-scale bg-signal-scale-bg/10';
  const textIntent = tone === 'kill' ? 'muted' : 'primary';

  return (
    <div className={cn('rounded-xl border border-lumi-border p-4', cls)}>
      <SectionLabel as="div" className="mb-2">{title}</SectionLabel>
      <Text as="p" variant="body" intent={textIntent} size="sm" className="leading-relaxed whitespace-pre-wrap">
        {body || '—'}
      </Text>
    </div>
  );
}

function StrategyMarkdownBlock({ markdown }) {
  // Lightweight markdown — we already validated at the API boundary that
  // it's a string. Render as monospaced pre-block to preserve structure
  // until @tailwindcss/typography is added later.
  return (
    <div>
      <SectionLabel as="div" className="mb-2">Strategy Brief</SectionLabel>
      <Text
        as="pre"
        variant="body"
        intent="primary"
        size="sm"
        className="rounded-xl border border-lumi-border bg-lumi-surface p-4 font-body leading-relaxed whitespace-pre-wrap break-words"
      >
        {markdown}
      </Text>
    </div>
  );
}

function AgentChip({ agent }) {
  const cls = agent === 'claude'
    ? 'text-orange-400 bg-orange-500/10 border-orange-500/25'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
  return (
    <Text
      as="span"
      variant="data"
      size="xs"
      className={cn('font-mono px-1.5 py-0.5 rounded border', cls)}
    >
      {agent === 'claude' ? 'Claude' : 'ChatGPT'}
    </Text>
  );
}
