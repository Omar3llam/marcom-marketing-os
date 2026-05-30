// ============================================================
// MARCOM / Lumi — Command Palette (⌘K / Ctrl+K)
// ------------------------------------------------------------
// Modal search over navigation pages + recent decisions.
// Replaces the old non-functional "Search decisions…" button,
// which set state nothing rendered.
//
// Props:
//   open       : boolean — visibility (owned by Sidebar)
//   onClose    : () => void
//   navItems   : Array<{ key, label, sub, path, icon }>
//   decisions  : Array<{ id, campaign, verdict, timestamp }>
//   onNavigate : (path: string) => void
//
// Keyboard: ↑/↓ move, Enter activate, Esc close.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export default function CommandPalette({
  open,
  onClose,
  navItems = [],
  decisions = [],
  onNavigate,
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  // Reset state and focus the input each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Flatten nav + decision matches into one selectable list.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navMatches = navItems
      .filter((t) => !q || t.label.toLowerCase().includes(q) || (t.sub || '').toLowerCase().includes(q))
      .map((t) => ({
        id:    `nav:${t.key}`,
        kind:  'Page',
        label: t.label,
        sub:   t.sub,
        path:  t.path,
        icon:  t.icon,
      }));
    const decMatches = decisions
      .filter((d) => !q || (d.campaign || '').toLowerCase().includes(q) || (d.verdict || '').toLowerCase().includes(q))
      .map((d) => ({
        id:    `dec:${d.id}`,
        kind:  'Decision',
        label: d.campaign || 'Untitled decision',
        sub:   [d.verdict, d.timestamp].filter(Boolean).join(' · '),
        path:  '/app/campaigns',
        icon:  null,
      }));
    return [...navMatches, ...decMatches];
  }, [query, navItems, decisions]);

  // Keep the highlight in range as the result set changes.
  useEffect(() => { setActiveIdx(0); }, [query]);

  if (!open) return null;

  const activate = (item) => {
    if (!item) return;
    onNavigate?.(item.path);
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(results[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-lumi-bg/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg bg-lumi-surface border border-lumi-border rounded-xl shadow-card overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-3.5 border-b border-lumi-border">
          <Search className="w-4 h-4 text-lumi-muted flex-shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decisions, campaigns, pages…"
            aria-label="Search"
            className="flex-1 bg-transparent py-3.5 text-sm text-lumi-text placeholder:text-lumi-subtle font-body outline-none"
          />
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-lumi-border text-lumi-muted tracking-wider">
            ESC
          </span>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-lumi-subtle font-mono">
              No matches
            </div>
          ) : (
            results.map((item, idx) => {
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
            })
          )}
        </div>
      </div>
    </div>
  );
}
