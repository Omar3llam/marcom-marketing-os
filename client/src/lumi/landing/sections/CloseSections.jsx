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
//   connectors   connectorRegistry.js:19-23
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

const WAYS = ['A dashboard', 'A chat assistant', 'LUMI'];
const COMPARISON = [
  ['What you get', 'Charts of what happened.', 'An answer to the question you asked.',
    'A call on each campaign, with its reason and evidence.'],
  ['When data is missing', 'A zero or an empty chart.', 'A fluent answer, whether or not the data supports it.',
    'The absence, named, with its reason.'],
  ['What it remembers', 'Nothing between visits.', 'The conversation.',
    'Every decision, and what happened after it.'],
  ['Who acts', 'You, after interpreting it.', 'No one.',
    'You confirm. After a KILL, LUMI can pause the campaign on Meta; nothing changes on its own.'],
];

export function DifferenceSection() {
  return (
    <LandingSection id="difference" title="Not a dashboard. Not a chat window." lead="Three ways to work with the same account data.">
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
    'Keep them. A dashboard shows what happened; LUMI commits to what each campaign needs and shows its grounds. Where there is no revenue to judge return on, LUMI says so instead of showing a return of zero.'],
  ['What if my data is incomplete?',
    'Where revenue, conversions or delivery were not measured, LUMI says so, and why. A campaign whose revenue was never measured is judged on engagement alone, and its verdict says so — including when it is compared with similar campaigns in your account.'],
  ['Does LUMI change my campaigns on its own?',
    'No. Today one action can be carried out from a verdict: pausing a campaign on Meta after a KILL, when you confirm it. SCALE, REFRESH and REALLOCATE need a figure or a creative from you, so LUMI does not pretend to act on them.'],
  ['Which platforms does it connect to?',
    'Meta Ads and Google Ads, plus Google Analytics 4 for revenue the ad platforms do not report.'],
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
      lead="Create an account, then connect Meta Ads or Google Ads. LUMI makes its calls from your account’s own data — and tells you where that data is not enough yet."
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
