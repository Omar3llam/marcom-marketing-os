import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const stateTone = {
  neutral: 'border-lumi-border bg-lumi-surface text-lumi-muted',
  warning: 'border-signal-hold/30 bg-signal-hold-bg text-dark-soft',
  danger: 'border-signal-kill/30 bg-signal-kill-bg text-dark-soft',
};

export function StateBlock({
  title,
  description,
  icon: Icon = Search,
  tone = 'neutral',
  action,
  className,
}) {
  return (
    <section className={cn('rounded-xl border p-6 text-center shadow-sm', stateTone[tone], className)}>
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-lumi-border bg-white/5">
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <h2 className="font-display text-sm font-semibold text-lumi-text">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-lumi-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </section>
  );
}

export function EmptyState(props) {
  return <StateBlock {...props} />;
}

export function ErrorState(props) {
  return <StateBlock icon={AlertTriangle} tone="danger" {...props} />;
}

export function LoadingState({ title = 'Loading', description, className }) {
  return (
    <StateBlock
      icon={Loader2}
      title={title}
      description={description}
      className={cn('[&_svg]:animate-spin', className)}
    />
  );
}
