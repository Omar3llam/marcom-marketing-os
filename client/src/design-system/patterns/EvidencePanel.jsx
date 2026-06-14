import { cn } from '@/lib/utils.js';

export function EvidencePanel({ title, evidence = [], footer, className }) {
  return (
    <section className={cn('rounded-xl border border-lumi-border bg-lumi-surface p-5 shadow-card', className)}>
      <div className="section-label">{title}</div>
      <div className="mt-4 space-y-3">
        {evidence.map((item) => (
          <div key={item.label} className="rounded-lg border border-lumi-border bg-lumi-elevated p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-lumi-text">{item.label}</p>
                {item.description && <p className="mt-1 text-xs leading-5 text-lumi-muted">{item.description}</p>}
              </div>
              {item.value && <span className="font-mono text-xs text-lumi-accent">{item.value}</span>}
            </div>
          </div>
        ))}
      </div>
      {footer && <div className="mt-4 border-t border-lumi-border pt-4">{footer}</div>}
    </section>
  );
}
