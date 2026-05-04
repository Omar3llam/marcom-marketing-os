// ============================================================
// MARCOM / Lumi — CommandCenter (FSM state A)
// ------------------------------------------------------------
// "What do you want to decide today?" — 3 mode cards with
// gradient accent bars + agent attribution chips, plus a
// horizontal Decision Memory strip backed by localStorage.
// ============================================================
import { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import {
  BarChart3, Target, ScanSearch, Clock, Brain, ArrowRight, Trash2,
} from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';

const MODES = [
  {
    mode: 'campaign',
    badge: 'MODE 3',
    accent: 'card-accent-campaign',
    iconCls: 'text-signal-kill bg-signal-kill-bg',
    badgeCls: 'text-signal-kill bg-signal-kill-bg',
    icon: BarChart3,
    title: 'Analyze Campaign Data',
    body: 'Upload Meta or Google Ads CSV. Get SCALE / HOLD / KILL verdicts with financial impact and wasted-spend breakdown.',
    cta: 'Run analysis',
    agents: ['claude', 'openai'],
  },
  {
    mode: 'strategy',
    badge: 'MODE 2',
    accent: 'card-accent-strategy',
    iconCls: 'text-stage-scaling bg-stage-scaling/10',
    badgeCls: 'text-stage-scaling bg-stage-scaling/10',
    icon: Target,
    title: 'Generate Campaign Brief',
    body: 'Brief Lumi on your goal. Get a structured campaign strategy tied to your commercial reality. No generic templates.',
    cta: 'Start strategy session',
    agents: ['claude'],
  },
  {
    mode: 'content',
    badge: 'MODE 4',
    accent: 'card-accent-content',
    iconCls: 'text-signal-hold bg-signal-hold-bg',
    badgeCls: 'text-signal-hold bg-signal-hold-bg',
    icon: ScanSearch,
    title: 'Score Content',
    body: 'Paste any ad, post or landing-page copy. Lumi runs the 10-step MARCOM framework and returns scores with rewrites.',
    cta: 'Submit content',
    agents: ['claude'],
  },
];

export default function CommandCenter({ history, onStartFlow, onReplay, onClearHistory }) {
  const { user } = useUser();
  const name = user?.firstName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'there';
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <div className="p-6 lg:p-12 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <header className="mb-10">
        <h1 className="font-display font-bold text-2xl lg:text-3xl text-lumi-text">
          What do you want to decide today, {name}?
        </h1>
        <p className="mt-2 font-mono text-sm text-lumi-muted">
          Context locked · Code81 · MENA market
        </p>
      </header>

      {/* Mode cards */}
      <section aria-label="Decision modes" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {MODES.map((m, i) => (
          <ModeCard
            key={m.mode}
            cfg={m}
            stagger={i * 75}
            onClick={() => onStartFlow(m.mode)}
          />
        ))}
      </section>

      {/* Decision Memory */}
      <section aria-labelledby="memory-heading" className="mt-12">
        <div className="flex items-center justify-between mb-3">
          <h2 id="memory-heading" className="section-label inline-flex items-center gap-1.5">
            <Brain className="w-3 h-3" strokeWidth={1.5} /> Decision Memory
          </h2>
          {history.length > 0 && (
            confirmingClear ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-lumi-muted">Clear all?</span>
                <button onClick={() => { onClearHistory(); setConfirmingClear(false); }}
                  className="text-trend-danger font-display font-semibold hover:underline">Yes, clear</button>
                <button onClick={() => setConfirmingClear(false)}
                  className="text-lumi-subtle hover:text-lumi-muted">Cancel</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="inline-flex items-center gap-1 text-xs text-lumi-subtle hover:text-trend-danger transition-colors"
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

// ── Mode card ────────────────────────────────────────────────
function ModeCard({ cfg, stagger, onClick }) {
  const Icon = cfg.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${stagger}ms` }}
      className={cn(
        'reveal group flex flex-col items-stretch text-left',
        'bg-lumi-surface border border-lumi-border rounded-2xl overflow-hidden',
        'hover:border-lumi-accent/40 hover:shadow-accent-glow active:scale-[0.99]',
        'transition-all duration-200 focus-visible:border-lumi-accent/60',
      )}
    >
      <div className={cn('card-accent', cfg.accent)} aria-hidden="true" />
      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center justify-between">
          <span className={cn('font-mono text-xs px-2 py-1 rounded-lg', cfg.badgeCls)}>{cfg.badge}</span>
          <div className="flex items-center gap-1">
            {cfg.agents.map((a) => <AgentChip key={a} agent={a} />)}
          </div>
        </div>
        <div className={cn('mt-4 w-12 h-12 rounded-xl p-2.5 flex items-center justify-center', cfg.iconCls)}>
          <Icon className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <h3 className="mt-4 font-display font-bold text-xl text-lumi-text">{cfg.title}</h3>
        <p className="mt-2 text-lumi-muted text-sm leading-relaxed">{cfg.body}</p>
        <span className="mt-6 inline-flex items-center gap-1 text-lumi-accent font-mono text-sm group-hover:underline">
          {cfg.cta} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
        </span>
      </div>
    </button>
  );
}

function AgentChip({ agent }) {
  const cls = agent === 'claude'
    ? 'text-orange-400  bg-orange-500/10  border-orange-500/25'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
  return (
    <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded border', cls)}>
      {agent === 'claude' ? 'Claude' : 'ChatGPT'}
    </span>
  );
}

// ── History ──────────────────────────────────────────────────
function HistoryRow({ d, onReplay }) {
  const borderCls =
      d.verdict === 'KILL'     ? 'border-l-2 border-l-signal-kill'
    : d.verdict === 'SCALE'    ? 'border-l-2 border-l-signal-scale'
    : d.verdict === 'HOLD'     ? 'border-l-2 border-l-signal-hold'
    : d.verdict === 'OPTIMIZE' ? 'border-l-2 border-l-stage-testing'
    : 'border-l-2 border-l-lumi-border';

  return (
    <li>
      <button
        type="button"
        onClick={onReplay}
        className={cn(
          'w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left',
          'bg-lumi-elevated border border-lumi-border',
          borderCls,
          'hover:border-lumi-accent/30 transition-all',
        )}
      >
        <VerdictPill verdict={d.verdict} />
        <div className="flex-1 min-w-0">
          <div className="font-display font-medium text-sm text-lumi-text truncate">{d.title}</div>
          <div className="font-mono text-xs text-lumi-subtle">
            {d.mode.toUpperCase()} · {fmtRelative(d.timestamp)}
          </div>
        </div>
        <span className="text-lumi-accent text-xs font-mono inline-flex items-center gap-1 group-hover:underline">
          Replay <ArrowRight className="w-3 h-3" strokeWidth={2} />
        </span>
      </button>
    </li>
  );
}

function EmptyMemory() {
  return (
    <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 py-10 text-center">
      <Clock className="w-8 h-8 mx-auto text-lumi-subtle" strokeWidth={1.5} />
      <p className="mt-3 text-lumi-muted text-sm">No decisions yet. Run your first analysis.</p>
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
