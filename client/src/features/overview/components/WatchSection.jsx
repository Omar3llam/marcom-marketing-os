// ============================================================
// MARCOM / Lumi — WatchSection (Home · the calm band)
// ------------------------------------------------------------
// Campaigns the engine is monitoring but that ask for nothing today. Collapsed
// by default on purpose: the home's job is to say what needs a call, and a
// WATCH verdict is the engine explicitly saying "not yet". Open it and the same
// DecisionCards render, with the same evidence — this hides attention, never
// information, and the header always carries the true count.
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { appRoutes } from '@/app/routeManifest.js';
import DecisionCard from './DecisionCard.jsx';

// `defaultOpen` is set by the surface plan for WATCH_CLOSELY — the one state
// where this band is the ENTIRE answer the page has. Collapsed is the right
// default under a KILL; it is the wrong default when there is nothing above it.
export default function WatchSection({ items = [], total = 0, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const plural = total === 1 ? '' : 's';

  return (
    <section className="mb-6 rounded-xl border border-lumi-border bg-lumi-surface p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-display text-sm font-semibold text-signal-watch">Keep watching</span>
          <span className="font-mono text-[11px] text-lumi-muted">
            {total} campaign{plural}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!open && (
            <span className="hidden font-mono text-[10px] text-lumi-subtle sm:inline">
              Nothing requires action yet.
            </span>
          )}
          <ChevronRight
            size={14}
            className={cn('flex-shrink-0 text-lumi-muted transition-transform duration-200', open && 'rotate-90 text-lumi-accent')}
            strokeWidth={2}
          />
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {items.map((d) => <DecisionCard key={d.entityId} {...d} />)}
          {total > items.length && (
            <Link
              to={appRoutes.campaigns}
              className="inline-block font-mono text-[11px] text-lumi-muted underline transition-colors hover:text-lumi-text"
            >
              View all {total} →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
