import { cn } from '@/lib/utils.js';

const toneClass = {
  neutral: 'border-lumi-border bg-lumi-surface',
  success: 'border-signal-scale/30 bg-signal-scale-bg',
  warning: 'border-signal-hold/30 bg-signal-hold-bg',
  danger: 'border-signal-kill/30 bg-signal-kill-bg',
  intelligence: 'border-lumi-accent/30 bg-lumi-accent-soft',
};

export function MetricTile({ label, value, detail, icon: Icon, tone = 'neutral', className }) {
  return (
    <section className={cn('rounded-xl border p-4 shadow-sm', toneClass[tone], className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label">{label}</div>
          <div className="metric-display mt-2 text-lumi-text">{value}</div>
          {detail && <p className="mt-1 text-xs leading-5 text-lumi-muted">{detail}</p>}
        </div>
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-current/20 text-lumi-accent">
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </div>
        )}
      </div>
    </section>
  );
}
