// ============================================================
// LUMI landing page — the public route `/` (Phase 4)
// ------------------------------------------------------------
// PAGE layer (🔒 FC-18: FOUNDATION → GENERIC PRIMITIVES → LUMI GRAMMAR →
// PRODUCT SURFACE COMPONENTS → PAGES). Composed only of Phase 3 primitives and
// grammar parts; no Tailwind, no legacy component, no dependency added.
//
// Environment (🔒 PR-9): Off White marketing ground, with Charcoal
// marketing-dark-section bands ONLY where the product is expressed — the hero
// demonstration, and the verdicts + decision band — because verdict marks do
// not exist on Off White (CMP-09 §7).
//
// The narrative answers, in order: what LUMI is · what is wrong today · how it
// thinks · what a verdict is · how evidence becomes a decision · why trust it ·
// how memory compounds · why it is different · what to do next.
// Review record: PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md.
// ============================================================
import { Environment, Inline, Rule, Stack, Text, TextLink } from '../index.js';
import { BrandMark } from './parts.jsx';
import { HeroSection, LandingHeader, SECTION_LINKS } from './sections/HeroSection.jsx';
import { ModelSection, ProblemSection } from './sections/ModelSections.jsx';
import { VerdictsSection } from './sections/VerdictsSection.jsx';
import { DecisionSection } from './sections/DecisionSection.jsx';
import { MemorySection, TrustSection } from './sections/TrustMemorySections.jsx';
import { DifferenceSection, QuestionsSection, StartSection } from './sections/CloseSections.jsx';
import css from './landing.module.css';

function LandingFooter() {
  return (
    <footer className={css.footer}>
      <div className={css.frame}>
        <Stack gap="object">
          <Inline gap="object" align="center" justify="between">
            <BrandMark />
            <nav aria-label="Legal and account">
              <ul className={css.navList}>
                <li><Text variant="label" as="span"><TextLink to="/privacy">Privacy</TextLink></Text></li>
                <li><Text variant="label" as="span"><TextLink to="/terms">Terms</TextLink></Text></li>
                <li><Text variant="label" as="span"><TextLink to="/login">Sign in</TextLink></Text></li>
                <li><Text variant="label" as="span"><TextLink to="/signup">Create an account</TextLink></Text></li>
              </ul>
            </nav>
          </Inline>
          <nav aria-label="Sections">
            <ul className={css.navList}>
              {SECTION_LINKS.map(([href, label]) => (
                <li key={href}><Text variant="label" as="span"><TextLink href={href}>{label}</TextLink></Text></li>
              ))}
            </ul>
          </nav>
          <Text variant="caption" as="p">LUMI — Decision Intelligence for Performance Marketing. Clarity turns complexity into decisions.</Text>
        </Stack>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <Environment env="marketing">
      <LandingHeader />
      <main id="main-content">
        <HeroSection />
        <ProblemSection />
        <ModelSection />
        <Environment env="marketing-dark-section">
          <VerdictsSection />
          <div className={css.frame}><Rule kind="divider" /></div>
          <DecisionSection />
        </Environment>
        <TrustSection />
        <MemorySection />
        <DifferenceSection />
        <QuestionsSection />
        <StartSection />
      </main>
      <LandingFooter />
    </Environment>
  );
}
