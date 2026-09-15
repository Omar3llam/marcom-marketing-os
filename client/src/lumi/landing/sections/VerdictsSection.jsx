// ============================================================
// Landing — the six verdicts (Charcoal band)
// ------------------------------------------------------------
// Brief question 5. 🔒 PR-5: six distinct verdicts, and Verdict ≠ Action, so each
// row states WHEN LUMI calls it and, separately, WHAT CAN HAPPEN NEXT.
// Verdict marks exist only on Charcoal (CMP-09 §7; 📏 Gold 2.21:1, HOLD 2.95:1 on
// Off White), which is why this section lives in a marketing-dark-section.
//
// Every sentence is traced:
//   when   src/services/verdict-engine/verdictEngine.js:358-474
//   next   src/services/execution/decisionExecutability.js:47-126
//          (KILL → PAUSE_CAMPAIGN on META is the only self-contained action;
//           SCALE / REFRESH / REALLOCATE → NEEDS_OPERATOR_INPUT;
//           HOLD / WATCH → NO_ACTION_FOR_VERDICT; Google → UNSUPPORTED_CHANNEL)
//   no revenue → engagement only   verdictEngine.js:358-363 (no revenue verdict on the
//          campaign's own numbers), then relativeRanking.js, run on every connector
//          sweep (connectorVerdictService.js:358): a no-revenue HOLD / WATCH with real
//          spend, in a cohort of ≥ 3 comparable campaigns, becomes KILL (bottom) or
//          SCALE (top) by CTR, its rationale saying "Based on engagement signals only"
// ============================================================
import { Text, VerdictMark } from '../../index.js';
import { cx } from '../../contract.js';
import { LandingSection } from '../parts.jsx';
import css from '../landing.module.css';

const VERDICT_ROWS = [
  ['KILL', 'Return is below break-even and the audience is past the fatigue ceiling — or, where revenue was never measured, its engagement is among the weakest of comparable campaigns in the account.',
    'LUMI can pause the campaign on Meta once you confirm. It is the one verdict LUMI can carry out today.'],
  ['HOLD', 'No change is warranted now.', 'Nothing to do, so no action is offered.'],
  ['SCALE', 'Return is strong and engagement is above the bar for the campaign’s objective — or, where revenue was never measured, its engagement is among the strongest of comparable campaigns in the account.',
    'Needs a budget figure from you. LUMI does not guess how much.'],
  ['WATCH', 'Something needs a person’s attention that no ad change fixes: a weak funnel stage, rising frequency, or too little signal to diagnose.',
    'No platform action. The verdict names what to look at.'],
  ['REFRESH', 'The creative is wearing out, or its hook is weak.', 'Needs a new creative from you.'],
  ['REALLOCATE', 'Budget is not converting where it is being spent.', 'Needs your call on where it goes next.'],
];

export function VerdictsSection() {
  return (
    <LandingSection
      id="verdicts"
      title="Six verdicts. Each one is a call, not a colour."
      lead="A verdict says what a campaign needs. Whether LUMI can act on it is a separate question — and the answer is always stated."
    >
      <div className={css.ledgerThree}>
        <div className={css.ledgerHeader} aria-hidden="true">
          <Text variant="caption" as="p">Verdict</Text>
          <Text variant="caption" as="p">When LUMI calls it</Text>
          <Text variant="caption" as="p">What can happen next</Text>
        </div>
        <ul className={css.ledger} aria-label="The six verdicts">
          {VERDICT_ROWS.map(([verdict, when, next]) => (
            <li key={verdict} className={css.ledgerRow}>
              <p className={css.cell}><VerdictMark verdict={verdict} /></p>
              <Text variant="body" as="p">{when}</Text>
              <Text variant="body" light="meta" as="p">{next}</Text>
            </li>
          ))}
        </ul>
      </div>
      <div className={cx(css.claimColumn)}>
        <Text variant="body" as="p">
          Where a campaign’s revenue was never measured, LUMI judges it on engagement alone and says so. It can
          still call KILL or SCALE when that engagement is among the weakest or strongest of comparable campaigns
          in your account.
        </Text>
      </div>
    </LandingSection>
  );
}
