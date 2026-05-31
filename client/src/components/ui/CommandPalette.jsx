// ============================================================
// MARCOM / Lumi — Command Palette (⌘K / Ctrl+K)
// ------------------------------------------------------------
// Modal search over navigation pages + recent decisions.
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
import { Search } from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette.js';
import CommandPaletteItems from './CommandPaletteItems.jsx';

export default function CommandPalette({
  open,
  onClose,
  navItems = [],
  decisions = [],
  onNavigate,
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

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

  const { activeIdx, setActiveIdx, activate, onKeyDown } = useCommandPalette({
    results,
    onNavigate,
    onClose,
  });

  // Reset state and focus the input each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, setActiveIdx]);

  // Keep the highlight in range as the result set changes.
  useEffect(() => { setActiveIdx(0); }, [query, setActiveIdx]);

  if (!open) return null;

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
          <CommandPaletteItems
            results={results}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            activate={activate}
          />
        </div>
      </div>
    </div>
  );
}
