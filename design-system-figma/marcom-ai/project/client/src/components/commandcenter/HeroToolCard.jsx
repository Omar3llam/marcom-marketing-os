import { BarChart3, Target, ScanSearch, ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { DecisionTitle } from '@/components/primitives';

const MODES = [
  {
    mode: 'campaign',
    badge: 'MODULE 01',
    accent: 'card-accent-campaign',
    iconCls: 'text-signal-kill bg-signal-kill-bg',
    badgeCls: 'text-signal-kill bg-signal-kill-bg',
    icon: BarChart3,
    title: 'Campaign Intelligence',
    body: 'Connect campaign data via CSV or Meta API. Get KILL / SCALE / HOLD verdicts with financial impact.',
    cta: 'Run intelligence scan',
    enabled: true,
  },
  {
    mode: 'strategy',
    badge: 'MODULE 02',
    accent: 'card-accent-strategy',
    iconCls: 'text-stage-scaling bg-stage-scaling/10',
    badgeCls: 'text-stage-scaling bg-stage-scaling/10',
    icon: Target,
    title: 'Strategic Intelligence',
    body: 'Generate strategic campaign briefs. Capability locked until Phase 2.',
    cta: 'Start session',
    enabled: false,
  },
  {
    mode: 'content',
    badge: 'MODULE 03',
    accent: 'card-accent-content',
    iconCls: 'text-signal-hold bg-signal-hold-bg',
    badgeCls: 'text-signal-hold bg-signal-hold-bg',
    icon: ScanSearch,
    title: 'Content Intelligence',
    body: 'Score ad copy with the MARCOM framework. Capability locked until Phase 3.',
    cta: 'Submit content',
    enabled: false,
  },
];

export default function HeroToolCard({ campaignMetrics, onStartFlow }) {
  return (
    <section aria-labelledby="tools-heading" className="mb-12">
      <h2 id="tools-heading" className="section-label mb-4">
        Decision Modules
      </h2>

      {/* Campaign card — hero entry point (full width, dominant) */}
      <ModeCard
        cfg={{ ...MODES[0], _metrics: campaignMetrics }}
        stagger={0}
        hero
        onClick={() => MODES[0].enabled && onStartFlow(MODES[0].mode)}
      />

      {/* Secondary tools — 2-col grid below the hero */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MODES.slice(1).map((m, i) => (
          <ModeCard
            key={m.mode}
            cfg={m}
            stagger={(i + 1) * 75}
            onClick={() => m.enabled && onStartFlow(m.mode)}
          />
        ))}
      </div>
    </section>
  );
}

function ModeCard({ cfg, stagger, onClick, hero = false }) {
  const Icon = cfg.icon;
  const disabled = !cfg.enabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ animationDelay: `${stagger}ms` }}
      className={cn(
        'reveal group text-left w-full',
        'bg-surface-card border rounded-2xl overflow-hidden shadow-card',
        'transition-all duration-200 focus-visible:border-lumi-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lumi-gold/20 focus-visible:shadow-gold-glow',
        hero
          ? 'flex flex-col lg:flex-row items-stretch border-lumi-gold/30 shadow-gold-glow'
          : 'flex flex-col items-stretch border-surface-border',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : hero
            ? 'hover:border-lumi-gold/60 hover:brightness-[1.02] active:scale-[0.99]'
            : 'hover:border-lumi-gold/40 hover:shadow-card-hover active:scale-[0.99]',
      )}
      aria-label={`${cfg.title} - ${cfg.body}`}
      aria-disabled={disabled}
    >
      <div className={cn('card-accent', cfg.accent)} aria-hidden="true" />

      {/* Main content section */}
      <div className="p-4 sm:p-6 flex flex-col flex-1">
        <div className="flex items-center justify-between">
          <span className={cn('font-mono text-xs px-2 py-1 rounded-lg', cfg.badgeCls)}>{cfg.badge}</span>
          {disabled && <Lock className="w-3.5 h-3.5 text-dark-soft" strokeWidth={1.5} aria-label="Locked" />}
        </div>
        <div className={cn('mt-4 w-12 h-12 rounded-xl p-2.5 flex items-center justify-center', cfg.iconCls)} aria-hidden="true">
          <Icon className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <DecisionTitle as="h3" className="mt-4 text-dark-base">{cfg.title}</DecisionTitle>
        <p className="mt-2 text-dark-soft text-sm leading-relaxed">{cfg.body}</p>

        {/* Hero metrics — show on mobile/tablet as well */}
        {hero && cfg._metrics && (
          <div className="mt-4 lg:hidden grid grid-cols-3 gap-3 p-3 rounded-xl bg-lumi-gold/5 border border-lumi-gold/20">
            <HeroMetricMobile label="Campaigns" value={cfg._metrics.total} />
            <HeroMetricMobile label="Spend" value={cfg._metrics.spend} />
            <HeroMetricMobile label="Verdict" value="~18s" />
          </div>
        )}

        {cfg.enabled && (
          hero ? (
            // Hero variant: explicit full-width button + time-to-value line
            <div className="mt-auto pt-5">
              <div
                className="w-full flex items-center justify-center gap-2
                           px-4 sm:px-5 py-3 rounded-xl
                           bg-lumi-gold text-dark-base
                           font-display font-bold text-sm
                           shadow-gold-glow
                           group-hover:bg-lumi-deep
                           transition-colors"
                aria-label={cfg.cta}
              >
                {cfg.cta}
                <ArrowRight className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              </div>
              <p className="mt-2 text-center font-mono text-xs text-dark-soft/70">
                Drop CSV → verdict in ~18s
              </p>
            </div>
          ) : (
            // Secondary variant: subtle link
            <span className="mt-6 inline-flex items-center gap-1 text-lumi-gold font-mono text-sm group-hover:underline">
              {cfg.cta} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
            </span>
          )
        )}
      </div>

      {/* Hero-only: right panel with session metrics (desktop only) */}
      {hero && (
        <div className="hidden lg:flex flex-col justify-center
                        px-6 py-6 border-t lg:border-t-0 lg:border-l border-lumi-gold/20
                        bg-lumi-gold/5 min-w-[180px] shrink-0">
          <p className="font-mono text-[10px] uppercase tracking-widest
                        text-dark-soft mb-3">
            Live feed
          </p>
          <div className="space-y-3">
            <HeroMetric label="Campaigns tracked" value={cfg._metrics?.total   ?? '—'} />
            <HeroMetric label="Spend in feed"      value={cfg._metrics?.spend   ?? '—'} />
            <HeroMetric label="Avg verdict time"   value="~18s" note="typical" />
          </div>
        </div>
      )}
    </button>
  );
}

function HeroMetric({ label, value, note }) {
  return (
    <div>
      <div className="font-mono text-xs text-dark-soft">{label}</div>
      <div className="font-display font-bold text-sm text-dark-base tabular-nums">
        {value}
        {note && (
          <span className="ml-1 font-mono text-xs font-normal text-dark-soft/60">
            ({note})
          </span>
        )}
      </div>
    </div>
  );
}

function HeroMetricMobile({ label, value }) {
  return (
    <div className="text-center">
      <div className="font-display font-bold text-sm text-dark-base tabular-nums">{value}</div>
      <div className="font-mono text-[10px] text-dark-soft mt-0.5">{label}</div>
    </div>
  );
}
