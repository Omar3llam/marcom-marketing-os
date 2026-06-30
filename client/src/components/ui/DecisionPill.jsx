// ============================================================
// MARCOM / Lumi — Decision pills
// ------------------------------------------------------------
// Three flavours, one base class (.decision-pill from index.css):
//   <VerdictPill  verdict='KILL|HOLD|SCALE|TEST' size='xs|sm|md' showIcon={boolean} />
//   <PriorityPill priority='HIGH|MEDIUM|LOW' />
//   <StagePill    stage='DYING|FATIGUED|TESTING|STABLE|SCALING' />
// ============================================================
import { cn } from '@/lib/utils.js';
import { XCircle, Pause, TrendingUp, FlaskConical, RefreshCw, Eye, Shuffle } from 'lucide-react';

// The full engine verdict vocabulary (verdictTypes.js). KILL/HOLD/SCALE are the
// originals; WATCH/REFRESH/REALLOCATE are first-class verdicts too — incl. the
// awareness track (REFRESH/WATCH/HOLD on engagement-only campaigns). They map to
// real semantic tokens so an awareness verdict is NOT a lesser/gray badge: it is
// as real as any other, just derived from different signals.
const verdictConfig = {
  KILL:       { bg: 'bg-signal-kill-bg',   text: 'text-signal-kill',   border: 'border-signal-kill/25',   icon: XCircle },
  HOLD:       { bg: 'bg-signal-hold-bg',   text: 'text-signal-hold',   border: 'border-signal-hold/25',   icon: Pause },
  SCALE:      { bg: 'bg-signal-scale-bg',  text: 'text-signal-scale',  border: 'border-signal-scale/25',  icon: TrendingUp },
  WATCH:      { bg: 'bg-signal-hold-bg',   text: 'text-signal-hold',   border: 'border-signal-hold/25',   icon: Eye },
  REFRESH:    { bg: 'bg-stage-testing/10', text: 'text-stage-testing', border: 'border-stage-testing/25', icon: RefreshCw },
  REALLOCATE: { bg: 'bg-stage-scaling/10', text: 'text-stage-scaling', border: 'border-stage-scaling/25', icon: Shuffle },
  TEST:       { bg: 'bg-stage-testing/10', text: 'text-stage-testing', border: 'border-stage-testing/25', icon: FlaskConical },
};

const priorityConfig = {
  HIGH:   { bg: 'bg-signal-kill-bg', text: 'text-signal-kill', border: 'border-signal-kill/25' },
  MEDIUM: { bg: 'bg-signal-hold-bg', text: 'text-signal-hold', border: 'border-signal-hold/25' },
  LOW:    { bg: 'bg-lumi-elevated',  text: 'text-lumi-muted',  border: 'border-lumi-border'    },
};

const stageConfig = {
  DYING:    'bg-signal-kill-bg   text-signal-kill   border-signal-kill/25',
  FATIGUED: 'bg-signal-hold-bg   text-signal-hold   border-signal-hold/25',
  TESTING:  'bg-stage-testing/10 text-stage-testing border-stage-testing/25',
  STABLE:   'bg-signal-scale-bg  text-signal-scale  border-signal-scale/25',
  SCALING:  'bg-stage-scaling/10 text-stage-scaling border-stage-scaling/25',
};

const fallback = 'bg-lumi-elevated text-lumi-muted border-lumi-border';

const sizeConfig = {
  xs: { padding: 'px-1.5 py-0.5', text: 'text-[9px]', icon: 'w-2.5 h-2.5', gap: 'gap-1' },
  sm: { padding: 'px-2 py-0.5',   text: 'text-[10px]', icon: 'w-3 h-3',     gap: 'gap-1' },
  md: { padding: 'px-2.5 py-1',   text: 'text-xs',     icon: 'w-3.5 h-3.5', gap: 'gap-1.5' },
};

export function VerdictPill({ verdict, size = 'md', showIcon = true }) {
  const c = verdictConfig[verdict];
  const s = sizeConfig[size] || sizeConfig.md;
  const Icon = c?.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-display font-semibold uppercase tracking-wide border',
        s.padding, s.text, s.gap,
        c?.bg, c?.text, c?.border, !c && fallback
      )}
      aria-label={`Verdict: ${verdict}`}
    >
      {showIcon && Icon && <Icon className={s.icon} strokeWidth={2} />}
      {verdict}
    </span>
  );
}

export function PriorityPill({ priority }) {
  const c = priorityConfig[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-display font-semibold uppercase tracking-wide border',
        c?.bg, c?.text, c?.border, !c && fallback
      )}
      aria-label={`Priority: ${priority}`}
    >
      {priority}
    </span>
  );
}

export function StagePill({ stage }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-display font-semibold uppercase tracking-wide border',
        stageConfig[stage] ?? fallback
      )}
      aria-label={`Stage: ${stage}`}
    >
      {stage}
    </span>
  );
}
