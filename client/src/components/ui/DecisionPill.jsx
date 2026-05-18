// ============================================================
// MARCOM / Lumi — Decision pills
// ------------------------------------------------------------
// Three flavours, one base class (.decision-pill from index.css):
//   <VerdictPill  verdict='KILL|HOLD|SCALE|TEST' />
//   <PriorityPill priority='HIGH|MEDIUM|LOW' />
//   <StagePill    stage='DYING|FATIGUED|TESTING|STABLE|SCALING' />
// ============================================================
import { cn } from '@/lib/utils.js';

const verdictConfig = {
  KILL:  { bg: 'bg-signal-kill-bg',   text: 'text-signal-kill',   border: 'border-signal-kill/25'   },
  HOLD:  { bg: 'bg-signal-hold-bg',   text: 'text-signal-hold',   border: 'border-signal-hold/25'   },
  SCALE: { bg: 'bg-signal-scale-bg',  text: 'text-signal-scale',  border: 'border-signal-scale/25'  },
  TEST:  { bg: 'bg-stage-testing/10', text: 'text-stage-testing', border: 'border-stage-testing/25' },
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

export function VerdictPill({ verdict }) {
  const c = verdictConfig[verdict];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-display font-semibold uppercase tracking-wide border',
        c?.bg, c?.text, c?.border, !c && fallback
      )}
      aria-label={`Verdict: ${verdict}`}
    >
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
