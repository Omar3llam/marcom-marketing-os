// ============================================================
// MARCOM / Lumi — AgendaItem (Phase 9 · one proposal in a band)
// ------------------------------------------------------------
// A single agenda item from either band. Lumi DETECTS, the human CONFIRMS — so
// the item shows the backend's own human verb (HUMAN_ACTION: confirm/review/
// adjust — never an invented label) and, when a real row backs it, a small
// "backed by {type}" evidence chip. Clicking NAVIGATES to the surface that owns
// the full context; it NEVER executes from the home screen.
// ============================================================
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';

// Severity → the design-system verdict tone. HIGH bleeds (kill), MEDIUM holds,
// LOW is healthy (scale). The agenda severity enum tops out at HIGH; CRITICAL is
// mapped defensively in case the engine ever raises one.
const SEVERITY_TONE = { CRITICAL: 'kill', HIGH: 'kill', MEDIUM: 'hold', LOW: 'scale' };

// The human verb comes straight from the backend HUMAN_ACTION enum.
const ACTION_LABEL = { confirm: 'Confirm', review: 'Review', adjust: 'Adjust' };

// What real row backs the claim — derived from the item type, shown only when an
// evidenceRef actually exists (no ref ⇒ no chip; we never imply backing we lack).
const EVIDENCE_LABEL = {
  VERDICT: 'guardrail', FATIGUE: 'forecast', TEST: 'test',
  PACING: 'pacing', PLAN_ADJUSTMENT: 'plan', REALLOCATION: 'budget',
};

// Where the full context for an item lives. The agenda navigates — never acts.
// (No `/app/decisions` route exists; the guardrail verdict's full alert lives on
// the Campaigns decision feed, and the agenda has removed it from Overview.)
export function agendaItemRoute(item) {
  if (item.type === 'PLAN_ADJUSTMENT' && String(item.id).startsWith('blended')) return appRoutes.blendedTruth;
  switch (item.type) {
    case 'VERDICT': return appRoutes.campaigns;
    case 'TEST':    return appRoutes.testing;
    case 'FATIGUE':
    case 'PACING':
    case 'PLAN_ADJUSTMENT':
    case 'REALLOCATION':
    default:        return appRoutes.insights;
  }
}

export default function AgendaItem({ item }) {
  const navigate = useNavigate();
  const tone = SEVERITY_TONE[item.severity] || 'hold';
  const actionLabel = ACTION_LABEL[item.humanAction] || 'Review';
  const evidence = item.evidenceRef ? EVIDENCE_LABEL[item.type] : null;

  return (
    <button
      onClick={() => navigate(agendaItemRoute(item))}
      aria-label={`${actionLabel}: ${item.title}`}
      className="w-full flex items-start gap-3 p-3 bg-surface-elevated border border-surface-border hover:bg-surface-card
                 rounded-lg transition-colors text-left focus:outline-none focus:ring-2 focus:ring-lumi-accent
                 focus:ring-offset-2 focus:ring-offset-surface-dark"
      style={{ borderLeft: `3px solid var(--c-${tone})` }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ color: `var(--c-${tone}-text)`, background: `var(--c-${tone}-bg)` }}
          >
            {item.severity}
          </span>
          <span className="font-display font-semibold text-xs text-dark-base truncate">{item.title}</span>
        </div>
        {item.rationale && (
          <p className="font-mono text-[10px] text-dark-muted line-clamp-2">{item.rationale}</p>
        )}
        {evidence && (
          <span className="mt-1.5 inline-flex items-center font-mono text-[9px] text-dark-subtle" title={item.evidenceRef}>
            backed by {evidence}
          </span>
        )}
      </div>
      <span
        className="flex items-center gap-1 flex-shrink-0 font-display font-semibold text-[11px]"
        style={{ color: 'var(--c-text-soft)' }}
      >
        {actionLabel}
        <ChevronRight className="w-3 h-3" strokeWidth={1.5} />
      </span>
    </button>
  );
}
