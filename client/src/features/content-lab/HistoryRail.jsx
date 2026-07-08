// ============================================================
// MARCOM / Lumi — Content Lab · History Rail
// ------------------------------------------------------------
// A slim rail of saved generations (GET /api/tools/content-generations). Pure +
// prop-driven so states are unit-tested directly. Honest states: skeleton while
// loading, an actionable empty state, and an error line. Clicking an item loads
// it into the output panel (the parent renders it read-only with a badge).
// ============================================================
import { History } from 'lucide-react';

const SECTION_LABELS = { copy: 'Copy', headlines: 'Headlines', cta: 'CTAs', visual: 'Visual', video: 'Video' };

export function sectionsLabel(options) {
  if (!options || typeof options !== 'object') return '';
  return Object.keys(SECTION_LABELS).filter((k) => options[k]).map((k) => SECTION_LABELS[k]).join(' · ');
}

export function relTime(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
  if (mins < 2880) return 'yesterday';
  return `${Math.round(mins / 1440)} days ago`;
}

export default function HistoryRail({ generations = [], isLoading = false, error = null, activeId = null, onSelect, multiUser = false }) {
  return (
    <aside className="bg-surface-card border border-surface-border rounded-xl p-3 shadow-card self-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-6rem)] overflow-y-auto">
      <div className="section-label mb-2.5 flex items-center gap-1.5">
        <History className="w-3 h-3 text-lumi-accent" strokeWidth={1.5} />
        Recent generations
      </div>

      {isLoading && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface-elevated animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <p className="font-mono text-[11px] text-dark-muted px-1 py-2">Couldn&apos;t load history right now.</p>
      )}

      {!isLoading && !error && generations.length === 0 && (
        <p className="text-[12px] text-dark-soft leading-relaxed px-1 py-2">
          Your generations will appear here. Start by generating some copy.
        </p>
      )}

      {!isLoading && !error && generations.length > 0 && (
        <ul className="space-y-1.5">
          {generations.map((g) => {
            const name = g.context?.campaignContext?.name || 'General brief';
            const sections = sectionsLabel(g.context?.options);
            const active = g.id === activeId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(g)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    active
                      ? 'border-lumi-accent/50 bg-lumi-accent/6'
                      : 'border-surface-border bg-surface-elevated hover:border-lumi-accent/30'
                  }`}
                >
                  <div className="font-display font-semibold text-[12px] text-dark-base truncate">{name}</div>
                  <div className="font-mono text-[10px] text-dark-muted mt-0.5">{relTime(g.createdAt)}</div>
                  {sections && <div className="font-mono text-[10px] text-dark-subtle mt-0.5 truncate">{sections}</div>}
                  {multiUser && g.createdBy?.email && (
                    <div className="font-mono text-[10px] text-dark-subtle mt-0.5 truncate">by {g.createdBy.email}</div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
