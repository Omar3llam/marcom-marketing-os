// ============================================================
// Landing — header, hero statement and the hero demonstration
// ------------------------------------------------------------
// Brief question 1: what is LUMI? The statement is 🔒 Article 4's positioning.
// The demonstration reads in PRODUCTION order, DATA → EVIDENCE → VERDICT
// (Article 5), and expresses it as light: raw inputs in meta light; in the
// evidence column each question in meta light and its answer in body light;
// the call in claim light (Article 11 §3).
//
// Grounding: KILL is reached when return is below break-even AND frequency is
// past the fatigue ceiling (src/services/verdict-engine/verdictEngine.js:387-391),
// and only on measured revenue (:358-363). The demonstration shows exactly those
// grounds, in words, with no figure. It is a NOW assessment, so it carries no
// action (🔒 PR-1).
// ============================================================
import {
  ActionLink, Environment, Heading, Inline, Stack, Text, TextLink, TenseLabel, VerdictMark,
} from '../../index.js';
import { cx } from '../../contract.js';
import { BrandPlaceholder, IllustrativeNote } from '../parts.jsx';
import css from '../landing.module.css';

export const SECTION_LINKS = [
  ['#how', 'How LUMI decides'],
  ['#evidence', 'A verdict and its grounds'],
  ['#memory', 'Decision Memory'],
  ['#questions', 'Questions'],
];

export function LandingHeader() {
  return (
    <header className={css.header}>
      <div className={cx(css.frame, css.bar)}>
        <BrandPlaceholder />
        <nav aria-label="Page" className={css.pageNav}>
          <ul className={css.navList}>
            {SECTION_LINKS.map(([href, label]) => (
              <li key={href}><Text variant="label" as="span"><TextLink href={href}>{label}</TextLink></Text></li>
            ))}
          </ul>
        </nav>
        <ul className={css.navList} aria-label="Account">
          <li><ActionLink prominence="quiet" to="/login">Sign in</ActionLink></li>
          <li><ActionLink prominence="standard" to="/signup">Create an account</ActionLink></li>
        </ul>
      </div>
    </header>
  );
}

const DATA = [
  'Spend', 'Impressions', 'Frequency', 'Clicks', 'Click-through rate', 'Conversions', 'Conversion value', 'Campaign objective',
];

const EVIDENCE = [
  ['Is it earning back what it spends?', 'Return is below break-even.'],
  ['Is the audience seeing it too often?', 'Frequency is past the fatigue ceiling.'],
  ['Was revenue measured at all?', 'Yes — so a revenue verdict can be called.'],
];

function DemoColumn({ stage, question, children }) {
  return (
    <li className={css.demoColumn}>
      <Stack gap="inline">
        <Text variant="label" as="p">{stage}</Text>
        <Text variant="caption" as="p">{question}</Text>
      </Stack>
      {children}
    </li>
  );
}

export function HeroSection() {
  return (
    <>
      <section aria-labelledby="hero-title" className={css.hero}>
        <div className={css.frame}>
          <div className={css.claimColumn}>
            <Stack gap="section">
              <Stack gap="object">
                {/* The category, in the words the product is named by (Phase 4 remediation). */}
                <Text variant="label" light="meta" as="p">Decision Intelligence for Performance Marketing</Text>
                <Heading level={1} variant="brand" id="hero-title">Verdicts. Not dashboards.</Heading>
              </Stack>
              <Text variant="claim" light="body" as="p">
                LUMI reads the evidence in your Meta Ads and Google Ads accounts and commits to a call on each
                campaign it can judge — with its reason, its evidence, and what it could not measure.
              </Text>
              <Inline gap="object" align="center">
                <ActionLink prominence="standard" to="/signup" data-landing-cta="hero">Create an account</ActionLink>
                <ActionLink prominence="quiet" href="#evidence">See a verdict and its grounds</ActionLink>
              </Inline>
            </Stack>
          </div>
        </div>
      </section>

      <Environment env="marketing-dark-section">
        <div className={css.band}>
          <figure className={cx(css.frame, css.demo)}>
            <Stack gap="section">
              <figcaption>
                <Stack gap="inline">
                  <Text variant="claim" as="p">From what the platforms report to one call.</Text>
                  <IllustrativeNote>an invented campaign. No account data appears on this page.</IllustrativeNote>
                </Stack>
              </figcaption>
              <ol className={css.demoGrid} aria-label="Data, then evidence, then verdict">
                <DemoColumn stage="Data" question="What the ad platforms report">
                  <ul className={css.dataList}>
                    {DATA.map((input) => <li key={input}><Text variant="caption" as="span">{input}</Text></li>)}
                  </ul>
                </DemoColumn>
                <DemoColumn stage="Evidence" question="What LUMI asks of it">
                  <ul className={css.plainList}>
                    {EVIDENCE.map(([asked, answer]) => (
                      <li key={asked}>
                        <Stack gap="inline">
                          <Text variant="body" light="meta" as="p">{asked}</Text>
                          <Text variant="body" as="p">{answer}</Text>
                        </Stack>
                      </li>
                    ))}
                  </ul>
                </DemoColumn>
                <DemoColumn stage="Verdict" question="What LUMI concludes">
                  <Stack gap="object">
                    <TenseLabel tense="NOW" at="2026-09-14T09:00:00Z" />
                    <VerdictMark verdict="KILL" />
                    <Text variant="claim" as="p">
                      It is losing money, and the people it reaches have already seen it too often.
                    </Text>
                    <Text variant="caption" as="p">
                      A current assessment carries no action. Acting belongs to a recorded decision.
                    </Text>
                  </Stack>
                </DemoColumn>
              </ol>
            </Stack>
          </figure>
        </div>
      </Environment>
    </>
  );
}
