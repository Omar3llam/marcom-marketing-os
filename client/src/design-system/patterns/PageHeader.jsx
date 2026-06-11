import { cn } from '@/lib/utils.js';

export function PageHeader({ eyebrow, title, description, actions, meta, className }) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="section-label">{eyebrow}</div>}
        <h1 className="decision-title mt-1 text-lumi-text">{title}</h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-lumi-muted">{description}</p>
        )}
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
