// ============================================================
// Landing — the problem, and how LUMI thinks
// ------------------------------------------------------------
// Brief questions 2–4. The model is drawn as ONE axis (Article 8 §1), in
// production order (Article 5), with its narrow feedback edge stated in words:
// memory adjusts confidence, never the verdict (Constitution R-1).
//
// Claims and their sources:
//   connectors      Meta Ads · Google Ads · GA4 (src/services/connectors/connectorRegistry.js:19-23)
//   decision        written when the verdict changes (B7-01)
//   budget          allocation is a plan artifact, not a Decision (Constitution R-3)
//   tests           experiment and holdout readouts; INCONCLUSIVE is a finding (B8-05)
// ============================================================
import { Heading, Stack, Text } from '../../index.js';
import { cx } from '../../contract.js';
import { Axis, LandingSection } from '../parts.jsx';
import css from '../landing.module.css';

const HANDED_COLUMNS = ['What a dashboard hands you', 'What is still left to you'];
const HANDED = [
  ['A chart for every metric', 'Deciding which of them matters for this campaign.'],
  ['A zero where a number is missing', 'Finding out whether it was zero, or never measured.'],
  ['This week’s numbers', 'Remembering what was decided last time — and whether it worked.'],
];

export function ProblemSection() {
  return (
    <LandingSection
      id="problem"
      title="Dashboards report everything and decide nothing."
      lead="Every platform reports its own numbers, over its own window, in its own words. The work that spends the budget starts after the dashboard: reading them together, making the call, and remembering what happened last time."
    >
      <div className={css.ledgerTwo}>
        <div className={css.ledgerHeader}>
          <Text variant="caption" as="p">{HANDED_COLUMNS[0]}</Text>
          <Text variant="caption" as="p">{HANDED_COLUMNS[1]}</Text>
        </div>
        <ul className={css.ledger}>
          {HANDED.map(([handed, left]) => (
            <li key={handed} className={css.ledgerRow}>
              <p className={css.cell}>
                <span className={css.cellCaption}><Text variant="caption" as="span">{HANDED_COLUMNS[0]}</Text></span>
                <Text variant="body" as="span">{handed}</Text>
              </p>
              <p className={css.cell}>
                <span className={css.cellCaption}><Text variant="caption" as="span">{HANDED_COLUMNS[1]}</Text></span>
                <Text variant="claim" as="span">{left}</Text>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </LandingSection>
  );
}

const MODEL = [
  ['Data', 'What Meta Ads, Google Ads and Google Analytics 4 report.'],
  ['Evidence', 'Measurements over a stated window, with anything unmeasured named.'],
  ['Verdict', 'One of six calls on a campaign.'],
  ['Decision', 'The call LUMI commits to, recorded with its reason and evidence.'],
  ['Action', 'What you confirm. Not every verdict has one.'],
  ['Outcome', 'What was measured after acting — or why it could not be.'],
  ['Memory', 'What keeps holding across decisions on your account.'],
];

const SUBJECTS = [
  ['Campaigns', 'A verdict on each campaign it can judge, and a recorded decision whenever that call changes.'],
  ['Budget', 'Allocation plans across campaigns. A plan is something you approve; it is not a verdict.'],
  ['Tests', 'Experiments and holdouts, read out as whether the change caused the result — including when the honest answer is inconclusive.'],
];

export function ModelSection() {
  return (
    <LandingSection
      id="how"
      title="LUMI reasons in one direction."
      lead="From the data to a decision it can defend — and from what happened afterwards into memory."
    >
      <Stack gap="section">
        <Axis label="How LUMI moves from data to memory" stops={MODEL} />
        <div className={css.claimColumn}>
          <Text variant="body" as="p">
            Memory can make LUMI more or less confident in a new assessment. It never changes the verdict.
          </Text>
        </div>
      </Stack>
      <Stack gap="object">
        <Heading level={3} variant="section">What LUMI decides about</Heading>
        <ul className={cx(css.ledgerTwo, css.ledger)}>
          {SUBJECTS.map(([subject, description]) => (
            <li key={subject} className={css.ledgerRow}>
              <Text variant="claim" as="p">{subject}</Text>
              <Text variant="body" as="p">{description}</Text>
            </li>
          ))}
        </ul>
      </Stack>
    </LandingSection>
  );
}
