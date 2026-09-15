// ============================================================
// LUMI Primitive Lab — Phase 3 visual review surface (NON-PRODUCTION)
// ------------------------------------------------------------
// Renders the real Phase 3 primitives and grammar parts on the real tokens so
// they can be inspected at desktop and narrow widths. Not a route, not linked
// from the application, not part of the landing page.
//
// Every name, id, time and figure on this page is an illustrative fixture and
// is labelled as one (Constitution Article 28).
// ============================================================
import { Environment, Heading, Inline, Stack, Text, TextLink } from '../index.js';
import { ControlsSection } from './sections/ControlsSection.jsx';
import { DecisionSection, ActionsSection } from './sections/DecisionSection.jsx';
import { EnvironmentsSection, SurfacesSection, TypographySection, VerdictsSection } from './sections/FoundationSection.jsx';
import { EvidenceSection, StatesSection } from './sections/StatesSection.jsx';
import lab from './lab.module.css';

const SECTIONS = [
  ['decision', 'Decision Spine'], ['typography', 'Typography'], ['surfaces', 'Surfaces'], ['verdicts', 'Verdicts'],
  ['controls', 'Controls'], ['states', 'States'], ['evidence', 'Evidence and measurements'], ['actions', 'Actions'],
  ['environments', 'Environments'],
];

export function LumiLab() {
  return (
    <Environment env="product">
      <main className={lab.page}>
        <Stack gap="section">
          <header>
            <Stack gap="meta">
              <Text variant="caption" as="p">Phase 3 · non-production · not linked from the application</Text>
              <Heading level={1} variant="surface">LUMI Primitive Lab</Heading>
              <Text variant="body" as="p">
                A visual review surface for the Phase 3 primitives and grammar parts, rendered on the Phase 2 tokens.
              </Text>
              <Text variant="claim" as="p">
                Illustrative example — every name, id, time and figure on this page is a fixture, not product data.
              </Text>
            </Stack>
          </header>
          <nav aria-label="Lab sections">
            <Inline gap="object" as="ul">
              {SECTIONS.map(([id, label]) => (
                <li key={id}><TextLink href={`#${id}`}>{label}</TextLink></li>
              ))}
            </Inline>
          </nav>
          <DecisionSection />
          <TypographySection />
          <SurfacesSection />
          <VerdictsSection />
          <ControlsSection />
          <StatesSection />
          <EvidenceSection />
          <ActionsSection />
          <EnvironmentsSection />
        </Stack>
      </main>
    </Environment>
  );
}
