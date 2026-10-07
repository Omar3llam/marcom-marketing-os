// ============================================================
// Landing — the problem, and how LUMI thinks
// ------------------------------------------------------------
// Brief questions 2–4. The model is drawn as ONE axis (Article 8 §1), in
// production order (Article 5), as the reader-driven spine in ./ModelSpine.jsx
// (Phase 4.2 prototype). Its narrow feedback edge is stated in words there:
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
import { LandingSection } from '../parts.jsx';
import { ModelSpine } from './ModelSpine.jsx';
import css from '../landing.module.css';

const HANDED_COLUMNS = ['What reporting can give you', 'What is still left to you'];
const HANDED = [
  ['Reported metrics over a chosen window', 'Deciding which of them matters for this campaign.'],
  ['A metric without enough context', 'Deciding whether the value is real, comparable, or usable.'],
  ['This week’s numbers', 'Remembering what was decided last time — and whether it worked.'],
];

export function ProblemSection() {
  return (
    <LandingSection
      id="problem"
      title="Dashboards can show what happened. The decision about what to do next is still yours."
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

const SUBJECTS = [
  ['Campaigns', 'A verdict on each campaign it can judge, and a recorded decision whenever that call changes.'],
  ['Budget', 'Allocation plans across campaigns. A plan is something you approve; it is not a verdict.'],
  ['Tests', 'A/B experiments compare variants and identify a supported winner — a correlational comparison. Holdouts evaluate incremental causal lift. Either can remain inconclusive when evidence is insufficient.'],
];

export function ModelSection() {
  return (
    <LandingSection
      id="how"
      title="LUMI reasons in one direction."
      lead="From the data to a decision it can defend — and from what happened afterwards into memory."
    >
      <ModelSpine />
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
