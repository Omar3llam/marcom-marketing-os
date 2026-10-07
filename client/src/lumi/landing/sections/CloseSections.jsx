// ============================================================
// Landing — why this is different, questions, and the next step
// ------------------------------------------------------------
// Brief questions 8 and 9. Named categories, never named products (REFERENCE_POLICY
// RP-2). Light follows the claim here too: the LUMI column is lit, the other two
// ways of working are body light.
//
// Every answer is traced:
//   execution    decisionExecutability.js (KILL → pause on Meta, on confirmation;
//                SCALE / REFRESH / REALLOCATE need operator input; no auto-execution
//                path exists in src/)
//   connectors   registry capability differs from self-service reachability:
//                onboarding ConnectStep, connectors/services.js and auth/google.js
//   verdicts     verdictEngine.js is a pure function of the evidence, not a chat model
//   no revenue   verdictEngine.js:358-363 (roas null, engagement only), and relativeRanking.js
//                can still rank a no-revenue campaign KILL / SCALE against comparable ones
// No price, plan or market claim is made: none has a source (audit §3C).
// ============================================================
import { ChevronDown } from 'lucide-react';
import { ActionLink, Heading, Icon, Inline, Stack, Text } from '../../index.js';
import { cx } from '../../contract.js';
import { LandingSection } from '../parts.jsx';
import css from '../landing.module.css';

const WAYS = ['A reporting workflow', 'A question-answer workflow', 'LUMI'];
const COMPARISON = [
  ['What you get', 'Read the reported metrics and choose the next step.', 'Ask a question and assess the answer.',
    'A call on each campaign it can judge, with its reason and evidence.'],
  ['When data is missing', 'Check what was measured and over which window.', 'Check what evidence supports the answer.',
    'Supported absences, named with their reasons.'],
  ['What it remembers', 'Keep a record of the call and the grounds you used.', 'Keep the answer and the grounds you relied on.',
    'Recorded decisions, captured grounds, and outcomes where safely observable.'],
  ['Who acts', 'Choose and confirm the change you intend to make.', 'Decide whether to act on the answer.',
    'You confirm. After a KILL, LUMI can pause the campaign on Meta; nothing changes on its own.'],
];

export function DifferenceSection() {
  return (
    <LandingSection id="difference" title="Not a dashboard. Not a chat window." lead="The operator’s tasks in reporting and question-answer workflows, alongside what LUMI records and supports.">
      <div className={css.ledgerFour}>
        <div className={css.ledgerHeader}>
          <span />
          {WAYS.map((way) => <Text key={way} variant="caption" as="p">{way}</Text>)}
        </div>
        <ul className={css.ledger}>
          {COMPARISON.map(([aspect, ...answers]) => (
            <li key={aspect} className={css.ledgerRow}>
              <Heading level={3} variant="section">{aspect}</Heading>
              {answers.map((answer, index) => (
                <p key={WAYS[index]} className={css.cell}>
                  <span className={css.cellCaption}><Text variant="caption" as="span">{WAYS[index]}</Text></span>
                  <Text variant={index === 2 ? 'claim' : 'body'} light={index === 2 ? 'claim' : 'body'} as="span">{answer}</Text>
                </p>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </LandingSection>
  );
}

const QUESTIONS = [
  ['I already have dashboards. Why add LUMI?',
    'Keep them. In a reporting workflow, you read what happened and choose the next step. LUMI commits to a call on each campaign it can judge and shows its grounds. Where there is no revenue to judge return on, LUMI says so instead of showing a return of zero.'],
  ['What if my data is incomplete?',
    'Where revenue, conversions or delivery were not measured, LUMI says so, and why. A campaign whose revenue was never measured is judged on engagement alone, and its verdict says so — including when it is compared with similar campaigns in your account.'],
  ['Does LUMI change my campaigns on its own?',
    'No. Today one action can be carried out from a verdict: pausing a campaign on Meta after a KILL, when you confirm it. SCALE, REFRESH and REALLOCATE need a figure or a creative from you, so LUMI does not pretend to act on them.'],
  ['Which platforms does it connect to?',
    'Meta Ads is available through self-service connection. Google Ads reporting is supported for configured accounts; first-time Google setup is not currently available through the self-service connection flow. Google Analytics 4 data support exists, but self-service connection is not currently available.'],
  ['Is LUMI a chatbot?',
    'No. Verdicts are computed from your account’s evidence the same way every time; they are not written by a chat model.'],
  ['Who is LUMI for?',
    'People who run paid media on Meta Ads or Google Ads and have to decide, week after week, what to stop, keep, fund or change — in-house teams and agencies.'],
];

export function QuestionsSection() {
  return (
    <LandingSection id="questions" title="Before you connect" lead="The questions people ask before they give LUMI access to an ad account.">
      <ul className={css.ledger}>
        {QUESTIONS.map(([question, answer]) => (
          <li key={question}>
            <details className={cx(css.disclosure)}>
              <summary className={css.question}>
                <span>{question}</span>
                <span className={css.disclosureGlyph}><Icon glyph={ChevronDown} /></span>
              </summary>
              <div className={css.answer}>
                <Text variant="body" as="p">{answer}</Text>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}

export function StartSection() {
  return (
    <LandingSection
      id="start"
      title="Start from your own evidence."
      lead="Create an account, then connect Meta Ads. LUMI makes its calls from your account’s own data — and tells you where that data is not enough yet."
    >
      <Stack gap="object">
        <Inline gap="object" align="center">
          <ActionLink prominence="standard" to="/signup" data-landing-cta="start">Create an account</ActionLink>
          <ActionLink prominence="quiet" to="/login">Sign in</ActionLink>
        </Inline>
      </Stack>
    </LandingSection>
  );
}
