import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const priorityClass = {
  high: 'border-signal-kill/30 bg-signal-kill-bg',
  medium: 'border-signal-hold/30 bg-signal-hold-bg',
  low: 'border-lumi-border bg-lumi-surface',
};

export function RecommendationCard({
  title,
  description,
  priority = 'low',
  confidence,
  actionLabel,
  onAction,
  className,
}) {
  return (
    <article className={cn('rounded-xl border p-4 shadow-sm', priorityClass[priority], className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label">{priority} priority</div>
          <h3 className="mt-2 font-display text-sm font-semibold text-lumi-text">{title}</h3>
          {description && <p className="mt-2 text-sm leading-6 text-lumi-muted">{description}</p>}
        </div>
        {confidence && <span className="font-mono text-xs text-lumi-accent">{confidence}</span>}
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-lumi-border bg-lumi-elevated px-3 py-2 text-sm font-medium text-lumi-text transition-colors hover:bg-lumi-surface"
        >
          {actionLabel}
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}
    </article>
  );
}
