import { Check } from 'lucide-react';

export function OptToggle({ on, onToggle, label, sub }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2.5 p-2 rounded-lg transition-all text-left ${
        on
          ? 'bg-lumi-accent/4 border border-lumi-accent/30'
          : 'border border-transparent hover:bg-surface-elevated'
      }`}
    >
      <span
        className={`w-4.5 h-4.5 rounded flex-shrink-0 border-2 flex items-center justify-center ${
          on
            ? 'border-lumi-accent bg-lumi-accent'
            : 'border-surface-border-strong bg-transparent'
        }`}
      >
        {on && <Check className="w-2.5 h-2.5 text-dark-base" strokeWidth={3} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="font-display text-xs font-semibold text-dark-base">{label}</span>
        <span className="font-mono text-[10px] text-dark-muted ml-1.5">{sub}</span>
      </span>
    </button>
  );
}
