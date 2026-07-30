// ============================================================
// MARCOM / Lumi — AccountStateHero (Home · the one-line answer)
// ------------------------------------------------------------
// The page's single h1. It answers "what does this account need right now?"
// before the user scrolls, replacing the old static "Today's Decisions" header
// that said the same thing on a bleeding account and a healthy one.
//
// Every number here is a TRUE total (pre-cap), not the number of cards on
// screen: the hero says "7 decisions need your attention" while the section
// below shows the top 3. Quoting the visible count would under-report the
// account by design.
//
// The sentences come from buildHeroNarrative (pure, in overviewState.js) so the
// wording is unit-testable without a DOM, and so a line that has no data behind
// it can be dropped from the array rather than rendered blank.
// ============================================================
import { ACCOUNT_STATE, STATE_CONFIG, buildHeroNarrative } from '../overviewState.js';

export default function AccountStateHero({
  state,
  actNowTotal = 0,
  watchTotal = 0,
  healthyCount = 0,
  wastedAmount = null,  // MAJOR units — fromMinor already applied by overviewKpis
  currency = null,      // kpis.currency, NOT workspace.currency (see below)
  workspace = null,
  hasAnyData = false,
}) {
  // null === still loading. Rendering a state here would flash a claim the data
  // has not supported yet; the sections below own their own skeletons.
  if (!state) return null;

  const config = STATE_CONFIG[state] ?? STATE_CONFIG[ACCOUNT_STATE.LEARNING];
  const narrative = buildHeroNarrative({
    state, actNowTotal, watchTotal, healthyCount,
    wastedAmount, currency, hasAnyData,
    workspaceName: workspace?.name ?? null,
  });

  const [headline, ...rest] = narrative;

  return (
    <header className="mb-6">
      <p className={`mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${config.color}`}>
        {config.label}
      </p>

      {headline && <h1 className="page-title mb-1 text-dark-base">{headline}</h1>}

      {rest.map((line) => (
        <p key={line} className="text-sm text-lumi-muted">{line}</p>
      ))}

      {/* Provenance. The currency is the one the FIGURES above are in — sourced
          from the connector, the same value the KPI cards use, so the hero and
          the Wasted-spend card can never disagree about the unit. Omitted
          entirely when there is neither a workspace nor a currency, rather than
          rendering an empty line. */}
      {(workspace?.name || currency) && (
        <p className="mt-2 font-mono text-[10px] text-lumi-muted">
          {workspace?.name}
          {workspace?.name && currency ? ' · ' : ''}
          {currency}
        </p>
      )}
    </header>
  );
}
