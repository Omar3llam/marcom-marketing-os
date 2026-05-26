// ============================================================
// MARCOM / Lumi — DecisionFrame v4.1
// ------------------------------------------------------------
// THE EXECUTION GUARD LAYER
//
// Displays the final Verdict and provides strict guarded
// execution flow:
//   1. SUCCESS state → Show verdict + [Execute [VERDICT] Action 🔒]
//   2. User clicks → Transition to CONFIRM_EXECUTION
//   3. Show modal: "Are you sure you want to execute via Meta API?"
//   4. User confirms → Transition to API_EXECUTION (locked)
//   5. Mock 1.5s API call → Transition to MEMORY_COMMIT
//   6. Success toast → Reset to COMMAND_CENTER
//
// STRICT GUARDRAILS:
// - No direct execution (always through confirmation)
// - UI locked during API_EXECUTION
// - Clear error handling with fallback actions
// ============================================================
import { useState, useEffect } from 'react';
import {
  DollarSign, TrendingDown, Sparkles, ArrowLeft, Palette, Lock,
  AlertTriangle, CheckCircle2, Loader2, X,
} from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';
import {
  DecisionTitle,
  SectionLabel,
  Text,
  BodyMuted,
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

export default function DecisionFrame({
  data,
  view,
  isLocked,
  executionStatus,
  onConfirmExecution,
  onExecuteAction,
  onCommitToMemory,
  onReset,
}) {
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

      {/* ── SECTION 1 — Verdict + confidence + risk (0ms) ── */}
      <section className="reveal mb-6" style={{ animationDelay: '0ms' }}>
        <DecisionTrustCluster
          verdict={data.verdict}
          title={data.title}
          confidence={data.confidence}
          riskLevel={data.riskLevel}
        />
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
          <Text as="p" variant="data" intent="primary" className="font-display font-semibold leading-snug">
            {data.financialImpact}
          </Text>
        </div>
      </section>

      {/* ── SECTION 3 — Why breakdown (800ms) ── */}
      {data.whyBreakdown.length > 0 && (
        <section className="reveal mb-6" style={{ animationDelay: '800ms' }}>
          <SectionLabel as="div" className="mb-2">Why this verdict</SectionLabel>
          <ol className="space-y-2 border-l-2 border-lumi-accent/30 pl-3">
            {data.whyBreakdown.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-xs bg-lumi-elevated text-lumi-muted px-2 py-0.5 rounded shrink-0 mt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </span>
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
      </section>

      {/* ── SECTION 5 — EXECUTION GUARD (1600ms) ── */}
      <section className="reveal flex flex-col sm:flex-row gap-2 mt-8" style={{ animationDelay: '1600ms' }}>
        {view === 'SUCCESS' && (
          <button
            type="button"
            onClick={onConfirmExecution}
            disabled={isLocked}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3',
              'font-display font-semibold transition-all',
              isLocked
                ? 'bg-surface-border text-dark-soft cursor-not-allowed opacity-50'
                : 'bg-lumi-gold hover:bg-lumi-deep text-dark-base shadow-gold-glow',
            )}
          >
            <Lock className="w-4 h-4" strokeWidth={2} />
            🔒 Execute {data.verdict} on Meta
          </button>
        )}

        <button
          type="button"
          onClick={onReset}
          disabled={isLocked}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-3',
            'font-display text-sm border transition-colors',
            isLocked
              ? 'text-lumi-subtle border-lumi-border cursor-not-allowed opacity-50'
              : 'text-lumi-muted border-lumi-border hover:text-lumi-text hover:border-lumi-border-strong',
          )}
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

      {/* ── CONFIRMATION MODAL ── */}
      {view === 'CONFIRM_EXECUTION' && (
        <ExecutionConfirmModal
          verdict={data.verdict}
          action={data.action}
          onConfirm={onExecuteAction}
          onCancel={onReset}
        />
      )}

      {/* ── EXECUTION PROGRESS MODALS (Locked) ── */}
      {(view === 'API_EXECUTION' || view === 'EXECUTION_QUEUED' || view === 'EXECUTING') && (
        <ExecutionProgressModal
          verdict={data.verdict}
          status={executionStatus?.status || 'EXECUTING'}
          onComplete={onCommitToMemory}
        />
      )}

      {/* ── EXECUTION SUCCESS MODAL ── */}
      {view === 'EXECUTED_SUCCESS' && (
        <ExecutionSuccessModal
          verdict={data.verdict}
          onContinue={onCommitToMemory}
        />
      )}
    </div>
  );
}

// ── CONFIRMATION MODAL ───────────────────────────────────────
function ExecutionConfirmModal({ verdict, action, onConfirm, onCancel }) {
  // Extract financial impact from action data
  const dailySpendImpact = action?.dailySpendImpact || '$0/day';
  const estimatedMonthlyImpact = action?.estimatedMonthlyImpact || '$0';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-card border border-surface-border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 animate-scale-in">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-signal-hold/10 border border-signal-hold/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-signal-hold" strokeWidth={1.5} />
          </div>
          <div>
            <DecisionTitle as="h3" className="text-lg">
              Confirm {verdict} Execution
            </DecisionTitle>
            <BodyMuted as="p" size="sm" className="mt-1">
              This action will be applied via Meta API immediately.
            </BodyMuted>
          </div>
        </div>

        {/* Financial Impact Warning */}
        <div className="mb-6 rounded-xl bg-signal-kill/5 border border-signal-kill/20 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-signal-kill shrink-0 mt-0.5" />
            <div className="flex-1">
              <Text as="p" variant="data" intent="danger" size="sm" className="font-display font-semibold mb-2">
                ⚠️ Financial Impact
              </Text>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <Text as="span" variant="data" intent="muted" size="xs" className="font-mono">
                    Daily spend:
                  </Text>
                  <Text as="span" variant="data" intent="primary" size="xs" className="font-mono font-semibold">
                    {dailySpendImpact}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text as="span" variant="data" intent="muted" size="xs" className="font-mono">
                    Est. monthly:
                  </Text>
                  <Text as="span" variant="data" intent="primary" size="xs" className="font-mono font-semibold">
                    {estimatedMonthlyImpact}
                  </Text>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Details */}
        <div className="mb-6 rounded-xl bg-surface-light border border-surface-border p-4">
          <SectionLabel as="div" className="mb-2">Action Details</SectionLabel>
          <div className="space-y-2">
            <div>
              <BodyMuted as="span" size="sm">Verdict:</BodyMuted>
              <Text as="span" variant="data" intent="primary" size="sm" className="ml-2 font-mono font-semibold">
                {verdict}
              </Text>
            </div>
            <div>
              <BodyMuted as="span" size="sm">Type:</BodyMuted>
              <Text as="span" variant="data" intent="primary" size="sm" className="ml-2 font-mono font-semibold">
                {action?.type || 'pause_campaign'}
              </Text>
            </div>
            <div>
              <BodyMuted as="span" size="sm">Target:</BodyMuted>
              <Text as="code" variant="data" intent="primary" size="xs" className="ml-2 font-mono bg-dark-soft/10 px-1.5 py-0.5 rounded">
                {action?.target_id || 'N/A'}
              </Text>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 font-display font-semibold text-sm text-dark-soft border border-surface-border hover:text-dark-base hover:border-surface-border transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.5} /> Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 font-display font-semibold text-sm bg-lumi-gold text-dark-base hover:bg-lumi-deep shadow-gold-glow transition-all"
          >
            <CheckCircle2 className="w-4 h-4" strokeWidth={2} /> Confirm Execute
          </button>
        </div>
      </div>
    </div>
  );
}

// ── API EXECUTION MODAL (Locked, with progress) ──────────────
function ExecutionProgressModal({ verdict, status = 'EXECUTING', onComplete }) {
  const [progress, setProgress] = useState(0);

  // Status-specific messaging
  const statusConfig = {
    QUEUED: {
      title: 'Queued for Execution',
      subtitle: 'Waiting in execution queue...',
      showProgress: false,
    },
    EXECUTING: {
      title: `Executing ${verdict} Action`,
      subtitle: 'Communicating with Meta API...',
      showProgress: true,
    },
  };

  const config = statusConfig[status] || statusConfig.EXECUTING;

  useEffect(() => {
    if (!config.showProgress) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => onComplete(), 500);
          return 100;
        }
        return prev + (100 / 15); // 1.5s total (15 ticks * 100ms)
      });
    }, 100);

    return () => clearInterval(interval);
  }, [onComplete, config.showProgress]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-card border border-surface-border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-lumi-gold/10 border border-lumi-gold/30 flex items-center justify-center shrink-0">
            <Loader2 className="w-5 h-5 text-lumi-gold animate-spin" strokeWidth={1.5} />
          </div>
          <div>
            <DecisionTitle as="h3" className="text-lg">
              {config.title}
            </DecisionTitle>
            <BodyMuted as="p" size="sm" className="mt-1">
              {config.subtitle}
            </BodyMuted>
          </div>
        </div>

        {config.showProgress && (
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-1">
              <SectionLabel as="span">Progress</SectionLabel>
              <Text as="span" variant="data" intent="primary" size="xs" className="font-mono tabular-nums">
                {Math.round(progress)}%
              </Text>
            </div>
            <div className="h-2 rounded-full bg-surface-border overflow-hidden">
              <div
                className="h-full bg-lumi-gold transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="text-center">
          <Lock className="w-3 h-3 inline-block mr-1" strokeWidth={1.5} />
          <BodyMuted as="span" size="xs">
            UI locked during execution
          </BodyMuted>
        </div>
      </div>
    </div>
  );
}

// ── EXECUTION SUCCESS MODAL ───────────────────────────────────
function ExecutionSuccessModal({ verdict, onContinue }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-card border border-surface-border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-signal-scale-bg border border-signal-scale/30 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-signal-scale" strokeWidth={1.5} />
          </div>
          <div>
            <DecisionTitle as="h3" className="text-lg">
              Execution Successful
            </DecisionTitle>
            <BodyMuted as="p" size="sm" className="mt-1">
              {verdict} action executed on Meta
            </BodyMuted>
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-display font-semibold text-sm bg-lumi-gold text-dark-base hover:bg-lumi-deep shadow-gold-glow transition-all"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Confidence + risk ───────────────────────────────────────
// Replaced by semantic primitives: ConfidenceIndicator, RiskSignal

// ── Mode-specific renderers ─────────────────────────────────
function CreativeAssetsBlock({ assets }) {
  const variants = assets?.variants || [];
  if (variants.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <SectionLabel as="span">AI Creative Variants</SectionLabel>
        <span className="font-mono text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">ChatGPT</span>
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
