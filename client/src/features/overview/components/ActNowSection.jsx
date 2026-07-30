// ============================================================
// MARCOM / Lumi — ActNowSection (Home · the band that costs money)
// ------------------------------------------------------------
// KILL and REALLOCATE, ranked. Lifted verbatim out of OverviewView so the page
// component stops carrying markup for four bands at once; behaviour is
// unchanged.
//
// Two invariants the copy depends on:
//   · the header quotes `total` (the TRUE count), never items.length — capping
//     at SECTION_CAP must not shrink how much the account is told it has
//   · "Highest impact first" is rendered by THIS component, which only mounts
//     when there are cards — so the ordering claim cannot outlive the order
// ============================================================
import { Link } from 'react-router-dom';
import { appRoutes } from '@/app/routeManifest.js';
import DecisionCard from './DecisionCard.jsx';

export default function ActNowSection({ items = [], total = 0 }) {
  return (
    // id is the target of the hero's "Review decisions →" CTA. That link only
    // renders in ACTION_REQUIRED, which implies actNowTotal > 0, which is
    // exactly when this section mounts — so the anchor is never dangling.
    <section id="act-now" className="mb-6 scroll-mt-6">
      <div className="flex items-center gap-2">
        <h2 className="section-label text-signal-kill">Act now</h2>
        <span className="font-mono text-[11px] text-lumi-subtle">
          {total} decision{total === 1 ? '' : 's'}
        </span>
      </div>
      {/* The ordering claim, made only where there is an order to claim. */}
      <p className="mb-3 mt-1 font-mono text-[10px] text-lumi-subtle">Highest impact first</p>

      <div className="space-y-3">
        {items.map((d) => <DecisionCard key={d.entityId} {...d} />)}
      </div>

      {total > items.length && (
        <Link
          to={appRoutes.campaigns}
          className="mt-3 inline-block font-mono text-[11px] text-lumi-muted underline transition-colors hover:text-lumi-text"
        >
          View all {total} decisions →
        </Link>
      )}
    </section>
  );
}
