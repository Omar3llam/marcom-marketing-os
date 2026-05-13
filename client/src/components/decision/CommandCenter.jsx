// ============================================================
// MARCOM / Lumi — CommandCenter v4.1 (Enterprise Dual-Zone)
// ------------------------------------------------------------
// ZONE A (TOP): 🔴 ACTIVE RADAR — Proactive bleeding campaign alerts
// ZONE B (BOTTOM): MANUAL OS TOOLS — Reactive 3-card grid
//
// This is NOT a chatbot. Every alert ends in a strict Verdict.
// The system is proactive (radar) AND reactive (manual upload).
// ============================================================
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  BarChart3, Target, ScanSearch, Clock, Brain, ArrowRight, Trash2,
  AlertTriangle, TrendingDown, Lock,
} from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';

const MODES = [
  {
    mode: 'campaign',
    badge: 'TOOL 01',
    accent: 'card-accent-campaign',
    iconCls: 'text-signal-kill bg-signal-kill-bg',
    badgeCls: 'text-signal-kill bg-signal-kill-bg',
    icon: BarChart3,
    title: 'Analyze Campaign',
    body: 'Upload CSV or sync Meta API. Get KILL / SCALE / HOLD verdicts with financial impact.',
    cta: 'Run analysis',
    enabled: true,
  },
  {
    mode: 'strategy',
    badge: 'TOOL 02',
    accent: 'card-accent-strategy',
    iconCls: 'text-stage-scaling bg-stage-scaling/10',
    badgeCls: 'text-stage-scaling bg-stage-scaling/10',
    icon: Target,
    title: 'Growth Strategy',
    body: 'Generate strategic campaign briefs. Locked until Phase 2.',
    cta: 'Start session',
    enabled: false,
  },
  {
    mode: 'content',
    badge: 'TOOL 03',
    accent: 'card-accent-content',
    iconCls: 'text-signal-hold bg-signal-hold-bg',
    badgeCls: 'text-signal-hold bg-signal-hold-bg',
    icon: ScanSearch,
    title: 'Content Score',
    body: 'Score ad copy with the MARCOM framework. Locked until Phase 3.',
    cta: 'Submit content',
    enabled: false,
  },
];

export default function CommandCenter({
  history,
  radarAlerts = [],
  summary,
  onStartFlow,
  onReviewAlert,
  onReplay,
  onClearHistory,
}) {
  const { currentUser } = useAuth();
  const name = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there';
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <div className="min-h-screen bg-surface-light p-6 lg:p-12 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <header className="mb-8">
        <h1 className="font-display font-bold text-2xl lg:text-3xl text-dark-base">
          Command Center
        </h1>
        <p className="mt-2 font-mono text-sm text-dark-soft inline-flex items-center gap-2">
          <Lock className="w-3 h-3 text-signal-scale" strokeWidth={1.5} />
          Context locked · Premium Intelligence · MENA market
        </p>
      </header>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ZONE A — ACTIVE RADAR (PROACTIVE)                          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section aria-labelledby="radar-heading" className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-signal-kill animate-pulse" aria-hidden="true" />
          <h2 id="radar-heading" className="font-display font-bold text-lg text-dark-base">
            🔴 Active Radar
          </h2>
          <span className="font-mono text-xs text-dark-soft ml-2">
            {radarAlerts.length} bleeding campaign{radarAlerts.length !== 1 ? 's' : ''} detected
          </span>
        </div>

        {radarAlerts.length === 0 ? (
          <EmptyRadar />
        ) : (
          <div className="space-y-3">
            {radarAlerts.map((alert) => (
              <RadarAlertCard key={alert.id} alert={alert} onReview={() => onReviewAlert(alert)} />
            ))}
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ZONE B — MANUAL OS TOOLS (REACTIVE)                        */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section aria-labelledby="tools-heading" className="mb-12">
        <h2 id="tools-heading" className="section-label mb-4">
          Manual OS Tools
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {MODES.map((m, i) => (
            <ModeCard
              key={m.mode}
              cfg={m}
              stagger={i * 75}
              onClick={() => m.enabled && onStartFlow(m.mode)}
            />
          ))}
        </div>
      </section>

      {/* Decision Memory */}
      <section aria-labelledby="memory-heading">
        <div className="flex items-center justify-between mb-3">
          <h2 id="memory-heading" className="section-label inline-flex items-center gap-1.5 text-dark-base">
            <Brain className="w-3 h-3" strokeWidth={1.5} /> Decision Memory
          </h2>
          {history.length > 0 && (
            confirmingClear ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-dark-soft">Clear all?</span>
                <button onClick={() => { onClearHistory(); setConfirmingClear(false); }}
                  className="text-signal-kill font-display font-semibold hover:underline">Yes, clear</button>
                <button onClick={() => setConfirmingClear(false)}
                  className="text-dark-soft hover:text-dark-base">Cancel</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="inline-flex items-center gap-1 text-xs text-dark-soft hover:text-signal-kill transition-colors"
              >
                <Trash2 className="w-3 h-3" strokeWidth={1.5} /> Clear history
              </button>
            )
          )}
        </div>

        {history.length === 0 ? (
          <EmptyMemory />
        ) : (
          <ul className="space-y-2">
            {history.slice(0, 5).map((d) => (
              <HistoryRow key={d.id} d={d} onReplay={() => onReplay(d)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Radar Alert Card ─────────────────────────────────────────
function RadarAlertCard({ alert, onReview }) {
  const riskBg = alert.risk_level === 'HIGH'   ? 'bg-signal-kill/5 border-signal-kill/20'
               : alert.risk_level === 'MEDIUM' ? 'bg-signal-hold/5 border-signal-hold/20'
               : 'bg-lumi-gold/5 border-lumi-gold/20';

  const riskText = alert.risk_level === 'HIGH'   ? 'text-signal-kill'
                 : alert.risk_level === 'MEDIUM' ? 'text-signal-hold'
                 : 'text-lumi-gold';

  return (
    <article
      className={cn(
        'rounded-2xl border p-5 bg-surface-card transition-all hover:border-lumi-gold/40 shadow-card hover:shadow-card-hover',
        riskBg,
      )}
    >
      <div className="flex items-start gap-4">
        {/* Alert Icon */}
        <div className="shrink-0 mt-1">
          <div className="w-10 h-10 rounded-xl bg-lumi-gold/10 border border-lumi-gold/20 flex items-center justify-center">
            <TrendingDown className={cn('w-5 h-5', riskText)} strokeWidth={1.5} />
          </div>
        </div>

        {/* Alert Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-display font-bold text-base text-dark-base">{alert.title}</h3>
            <VerdictPill verdict={alert.verdict} />
          </div>

          {/* Impact (Psychological UX: Use exact copy) */}
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-signal-kill/10 border border-signal-kill/20 px-3 py-1.5">
            <AlertTriangle className="w-4 h-4 text-signal-kill" strokeWidth={1.5} />
            <span className="font-mono text-sm text-signal-kill">{alert.impact}</span>
          </div>

          {/* Why Breakdown */}
          <ul className="space-y-1 mb-4">
            {alert.why.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-dark-soft">
                <span className="text-lumi-gold mt-0.5">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {/* Confidence + Review Button */}
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-dark-soft">
              Confidence: <span className="text-dark-base tabular-nums">{alert.confidence}%</span>
            </span>
            <button
              type="button"
              onClick={onReview}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-display font-semibold text-sm bg-lumi-gold text-dark-base hover:bg-lumi-deep hover:shadow-gold-glow shadow-card transition-all"
            >
              Review Alert <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyRadar() {
  return (
    <div className="rounded-2xl border border-dashed border-surface-border bg-surface-light/40 py-12 text-center shadow-card">
      <div className="w-12 h-12 mx-auto rounded-full bg-signal-scale/10 flex items-center justify-center mb-3">
        <AlertTriangle className="w-6 h-6 text-signal-scale" strokeWidth={1.5} />
      </div>
      <p className="text-dark-base font-display font-semibold">All clear</p>
      <p className="mt-1 text-dark-soft text-sm">No bleeding campaigns detected. Radar monitoring active.</p>
    </div>
  );
}

// ── Mode card (Manual Tools) ─────────────────────────────────
function ModeCard({ cfg, stagger, onClick }) {
  const Icon = cfg.icon;
  const disabled = !cfg.enabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ animationDelay: `${stagger}ms` }}
      className={cn(
        'reveal group flex flex-col items-stretch text-left',
        'bg-surface-card border border-surface-border rounded-2xl overflow-hidden shadow-card',
        'transition-all duration-200 focus-visible:border-lumi-gold/60 focus-visible:shadow-gold-glow',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:border-lumi-gold/40 hover:shadow-card-hover active:scale-[0.99]',
      )}
    >
      <div className={cn('card-accent', cfg.accent)} aria-hidden="true" />
      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center justify-between">
          <span className={cn('font-mono text-xs px-2 py-1 rounded-lg', cfg.badgeCls)}>{cfg.badge}</span>
          {disabled && <Lock className="w-3.5 h-3.5 text-dark-soft" strokeWidth={1.5} />}
        </div>
        <div className={cn('mt-4 w-12 h-12 rounded-xl p-2.5 flex items-center justify-center', cfg.iconCls)}>
          <Icon className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <h3 className="mt-4 font-display font-bold text-xl text-dark-base">{cfg.title}</h3>
        <p className="mt-2 text-dark-soft text-sm leading-relaxed">{cfg.body}</p>
        {cfg.enabled && (
          <span className="mt-6 inline-flex items-center gap-1 text-lumi-gold font-mono text-sm group-hover:underline">
            {cfg.cta} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
        )}
      </div>
    </button>
  );
}

// ── History ──────────────────────────────────────────────────
function HistoryRow({ d, onReplay }) {
  const borderCls =
      d.verdict === 'KILL'     ? 'border-l-2 border-l-signal-kill'
    : d.verdict === 'SCALE'    ? 'border-l-2 border-l-signal-scale'
    : d.verdict === 'HOLD'     ? 'border-l-2 border-l-signal-hold'
    : d.verdict === 'OPTIMIZE' ? 'border-l-2 border-l-stage-testing'
    : 'border-l-2 border-l-surface-border';

  return (
    <li>
      <button
        type="button"
        onClick={onReplay}
        className={cn(
          'w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left',
          'bg-surface-card border border-surface-border shadow-card',
          borderCls,
          'hover:border-lumi-gold/30 hover:shadow-card-hover transition-all',
        )}
      >
        <VerdictPill verdict={d.verdict} />
        <div className="flex-1 min-w-0">
          <div className="font-display font-medium text-sm text-dark-base truncate">{d.title}</div>
          <div className="font-mono text-xs text-dark-soft">
            {d.mode.toUpperCase()} · {fmtRelative(d.timestamp)}
          </div>
        </div>
        <span className="text-lumi-gold text-xs font-mono inline-flex items-center gap-1 group-hover:underline">
          Replay <ArrowRight className="w-3 h-3" strokeWidth={2} />
        </span>
      </button>
    </li>
  );
}

function EmptyMemory() {
  return (
    <div className="rounded-2xl border border-dashed border-surface-border bg-surface-light/40 py-10 text-center shadow-card">
      <Clock className="w-8 h-8 mx-auto text-dark-soft" strokeWidth={1.5} />
      <p className="mt-3 text-dark-soft text-sm">No decisions yet. Run your first analysis.</p>
    </div>
  );
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
