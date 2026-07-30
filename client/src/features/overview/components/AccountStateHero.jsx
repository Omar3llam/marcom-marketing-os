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
// PLACEHOLDER NARRATIVE: the sentences below are templated from counts. The
// narrative engine (PR#300) replaces the sentence, not the state machine.
// ============================================================
import { ACCOUNT_STATE, STATE_CONFIG } from '../overviewState.js';

// One sentence per state. Singular/plural is handled per branch rather than by a
// shared helper, because only two branches carry a count at all.
function headline({ state, actNowTotal, watchTotal }) {
  switch (state) {
    case ACCOUNT_STATE.ACTION_REQUIRED:
      return actNowTotal === 1
        ? '1 decision needs your attention.'
        : `${actNowTotal} decisions need your attention.`;
    case ACCOUNT_STATE.WATCH_CLOSELY:
      return watchTotal === 1
        ? '1 campaign needs monitoring.'
        : `${watchTotal} campaigns need monitoring.`;
    case ACCOUNT_STATE.PERFORMING_WELL:
      return 'Everything is running smoothly today.';
    default:
      return 'Building confidence in this workspace.';
  }
}

export default function AccountStateHero({
  state,
  actNowTotal = 0,
  watchTotal = 0,
  workspace = null,
}) {
  // null === still loading. Rendering a state here would flash a claim the data
  // has not supported yet; the sections below own their own skeletons.
  if (!state) return null;

  const config = STATE_CONFIG[state] ?? STATE_CONFIG[ACCOUNT_STATE.LEARNING];

  return (
    <header className="mb-6">
      <p className={`mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${config.color}`}>
        {config.label}
      </p>

      <h1 className="page-title text-dark-base">
        {headline({ state, actNowTotal, watchTotal })}
      </h1>

      {workspace?.name && (
        <p className="mt-1 text-xs text-lumi-muted">{workspace.name}</p>
      )}
    </header>
  );
}
