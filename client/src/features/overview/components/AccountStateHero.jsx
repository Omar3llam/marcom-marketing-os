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
    <header className={`mb-6 rounded-2xl border p-6 ${config.heroBg}`}>
      <p className={`section-label mb-2 ${config.color}`}>{config.label}</p>

      {/* The COUNT is the headline; the money is supporting. A figure reads as
          the point of the page when it is the biggest thing on it, and the
          decision — not the number — is what the user has to act on. */}
      {headline && <h1 className="page-title mb-2 text-dark-base">{headline}</h1>}

      {rest.map((line) => (
        <p key={line} className="mb-4 text-sm text-lumi-muted">{line}</p>
      ))}

      {/* One primary action, only where there is something to act on. The
          target is ActNowSection's own anchor, which mounts whenever this
          state does (ACTION_REQUIRED ⇒ actNowTotal > 0 ⇒ the band renders), so
          this can never be a dead link. */}
      {state === ACCOUNT_STATE.ACTION_REQUIRED && (
        <a
          href="#act-now"
          className="inline-flex items-center gap-2 rounded-xl border border-lumi-border px-4 py-2 text-sm font-semibold text-lumi-text transition-colors hover:bg-lumi-elevated focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-lumi-bg"
        >
          Review decisions →
        </a>
      )}

      {/* Provenance. The currency is the one the FIGURES above are in — sourced
          from the connector, the same value the KPI cards use, so the hero and
          the Wasted-spend card can never disagree about the unit. Omitted
          entirely when there is neither a workspace nor a currency, rather than
          rendering an empty line. */}
      {(workspace?.name || currency) && (
        <p className="section-label mt-4 text-lumi-muted">
          {workspace?.name}
          {workspace?.name && currency ? ' · ' : ''}
          {currency}
        </p>
      )}
    </header>
  );
}
