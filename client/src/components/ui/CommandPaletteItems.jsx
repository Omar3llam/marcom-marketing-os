import { CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export default function CommandPaletteItems({ results, activeIdx, setActiveIdx, activate }) {
  if (results.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-lumi-subtle font-mono">
        No matches
      </div>
    );
  }

  return results.map((item, idx) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onMouseEnter={() => setActiveIdx(idx)}
        onClick={() => activate(item)}
        className={cn(
          'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors',
          idx === activeIdx ? 'bg-lumi-elevated' : 'hover:bg-lumi-elevated/60',
        )}
      >
        {Icon
          ? <Icon className="w-4 h-4 text-lumi-muted flex-shrink-0" strokeWidth={1.5} />
          : <span className="w-4 flex-shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block font-display text-[13px] text-lumi-text truncate">
            {item.label}
          </span>
          {item.sub && (
            <span className="block font-mono text-[10px] text-lumi-subtle truncate">
              {item.sub}
            </span>
          )}
        </span>
        <span className="font-mono text-[9px] text-lumi-subtle flex-shrink-0">
          {item.kind}
        </span>
        {idx === activeIdx && (
          <CornerDownLeft className="w-3 h-3 text-lumi-muted flex-shrink-0" strokeWidth={1.5} />
        )}
      </button>
    );
  });
}
