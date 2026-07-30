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
import { formatCurrency } from '@/lib/money';
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
      {/* Verdict + impact */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <VerdictPill verdict={verdict} size="md" />
        {impactScore != null && (
          <span
            className="section-label flex-shrink-0 text-lumi-muted"
            title={`Impact ${impactScore}/10 — priority to act`}
          >
            Impact {impactScore}/10
          </span>
        )}
      </div>

      {/* Campaign + what it has cost. The spend was already being passed in for
          ExecutionContext but never shown, so the card asked for a decision
          without saying how much was riding on it. spendMinor is MINOR units —
          formatCurrency (money.ts) is the matching formatter; the hero's
          formatCurrencyWhole takes MAJOR and would be 100x wrong here. */}
      <div className="mb-2">
        <p className="font-display text-sm font-semibold text-lumi-text">{name || 'Unnamed campaign'}</p>
        {spendMinor != null && (
          <p className="section-label mt-0.5 text-lumi-muted">
            {formatCurrency(spendMinor, currency || 'USD')} spent
          </p>
        )}
      </div>

      {/* Why */}
      {rationale && <p className="mb-3 text-xs leading-relaxed text-lumi-muted">{rationale}</p>}

      {/* What to do about it */}
      {humanAction && (
        <div className="mb-3">
          <p className="section-label mb-0.5 text-lumi-muted">Do this</p>
          <p className="text-xs text-lumi-text">{humanAction}</p>
        </div>
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
        className="section-label mt-3 inline-block text-lumi-muted underline transition-colors hover:text-lumi-text"
      >
        View in Decision Queue →
      </Link>
    </div>
  );
}
