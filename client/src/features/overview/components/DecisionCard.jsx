// ============================================================
// MARCOM / Lumi — DecisionCard (Home · one decision in the feed)
// ------------------------------------------------------------
// One campaign that needs a call, with its evidence and — for the verdicts that
// ask for an intervention — the ad set to open first, fetched on demand.
//
// Explicit props rather than one `item` blob, deliberately. The agenda item
// (`agenticTypes.agendaItem`) carries { id, band, type, title, severity,
// rationale, humanAction, entityId, impactScore } and NO verdict, name, ctr,
// spendMinor or currency. A card that read `item.verdict` would silently render
// nothing forever. Naming what it needs makes the join the caller's job, and a
// missing field a visible one.
//
// Read + navigate only. Nothing here executes; the deep link hands off to the
// Campaigns page that owns the full context.
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { appRoutes } from '@/app/routeManifest.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { useEntityDrillDown } from '@/hooks/useEntityDrillDown.js';
import { ExecutionContext } from '@/features/campaigns/ExecutionContext.jsx';
import { ACTIONABLE_VERDICTS } from '@/features/campaigns/executionContext.js';

export default function DecisionCard({
  entityId, name, verdict,
  rationale = null, impactScore = null, humanAction = null,
  ctr = null, spendMinor = null, currency = null,
}) {
  const { byId, load } = useEntityDrillDown();
  const [expanded, setExpanded] = useState(false);

  // The same verdicts ExecutionContext itself acts on — imported rather than
  // re-listed, so the button and the panel can never disagree about which
  // decisions have somewhere to drill into.
  const canDrill = ACTIONABLE_VERDICTS.includes(verdict);
  const state = byId[entityId];

  const toggle = () => {
    if (!expanded) load(entityId); // idempotent + cached inside the hook
    setExpanded((e) => !e);
  };

  // ExecutionContext reads a campaign row, not an agenda item. Only the four
  // fields it actually uses are passed; each is null-when-absent, and it renders
  // nothing at all without a real campaign CTR to measure against.
  const campaign = { entityId, ctr, spendMinor, currency };

  return (
    <div className="rounded-xl border border-lumi-border bg-lumi-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <VerdictPill verdict={verdict} size="md" />
        {impactScore != null && (
          <span
            className="flex-shrink-0 font-mono text-[10px] text-lumi-muted"
            title={`Impact ${impactScore}/10 — priority to act`}
          >
            Impact {impactScore}/10
          </span>
        )}
      </div>

      <p className="font-display text-sm font-semibold text-lumi-text">{name || 'Unnamed campaign'}</p>

      {rationale && <p className="mt-0.5 text-xs leading-relaxed text-lumi-muted">{rationale}</p>}

      {humanAction && (
        <p className="mt-3 text-xs text-lumi-muted">
          <span className="font-medium text-lumi-text">Next step: </span>
          {humanAction}
        </p>
      )}

      {canDrill && (
        <div className="mt-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="flex items-center gap-1 font-mono text-[11px] text-lumi-muted transition-colors hover:text-lumi-text"
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform duration-200', expanded && 'rotate-90 text-lumi-accent')}
            />
            {expanded ? 'Hide execution context' : 'Show execution context'}
          </button>

          {/* Honest intermediate states: the panel itself renders nothing when
              the data cannot support a pick, which is indistinguishable from
              "still loading" unless we say so. */}
          {expanded && state?.loading && (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> Loading ad sets…
            </p>
          )}
          {expanded && state?.error && (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-trend-danger">
              <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Couldn&apos;t load ad sets — collapse and try again.
            </p>
          )}
          {expanded && state?.adSets && (
            <ExecutionContext campaign={campaign} adSets={state.adSets} verdict={verdict} />
          )}
        </div>
      )}

      <Link
        to={`${appRoutes.campaigns}?entity=${encodeURIComponent(entityId)}`}
        className="mt-3 inline-block font-mono text-[11px] text-lumi-muted underline transition-colors hover:text-lumi-text"
      >
        View in Decision Queue →
      </Link>
    </div>
  );
}
