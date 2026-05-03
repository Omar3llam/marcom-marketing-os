// ============================================================
// MARCOM / Lumi — Placeholder shell
// ------------------------------------------------------------
// Reused by every "Under Construction" page so the design system
// is the single source of truth for empty/coming-soon states.
// ============================================================
import { Construction } from 'lucide-react';

export default function PlaceholderPage({ label, title, description }) {
  return (
    <div className="flex flex-col h-full p-8">
      <div className="section-label">{label}</div>
      <h1 className="mt-1 font-display font-bold text-2xl text-lumi-text">{title}</h1>
      <p className="mt-2 text-lumi-muted text-sm max-w-xl">{description}</p>

      <div className="mt-10 flex items-center gap-3 self-start rounded-xl border border-lumi-border bg-lumi-surface px-4 py-3 shadow-card">
        <Construction className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
        <div>
          <div className="text-sm font-display font-semibold text-lumi-text">Under construction</div>
          <div className="text-xs text-lumi-subtle">Coming in the next iteration.</div>
        </div>
      </div>
    </div>
  );
}
