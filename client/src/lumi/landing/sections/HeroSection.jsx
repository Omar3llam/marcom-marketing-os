// ============================================================
// Landing — header, hero statement and the hero demonstration
// ------------------------------------------------------------
// Brief question 1: what is LUMI? The statement is 🔒 Article 4's positioning.
// The demonstration (./HeroDemonstration.jsx, Phase 4.2 prototype) reads in
// PRODUCTION order, DATA → EVIDENCE → VERDICT (Article 5), and lights the
// inputs behind the evidence question the reader chooses. Its engine grounding
// is recorded in that file. It is a NOW assessment, so it carries no action
// (🔒 PR-1).
// ============================================================
import { ActionLink, Environment, Heading, Inline, Stack, Text, TextLink } from '../../index.js';
import { cx } from '../../contract.js';
import { BrandPlaceholder } from '../parts.jsx';
import { HeroDemonstration } from './HeroDemonstration.jsx';
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
                LUMI reads evidence from supported connected ad accounts and commits to a call on each
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
          <div className={css.frame}>
            <HeroDemonstration />
          </div>
        </div>
      </Environment>
    </>
  );
}
