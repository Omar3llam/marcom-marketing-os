// LUMI Primitive Lab — typography, surfaces, verdicts, environments. Illustrative fixtures only.
import { Environment, Heading, Inline, Rule, Stack, Surface, Text, VerdictMark } from '../../index.js';
import { VERDICTS } from '../../grammar/vocabulary.js';
import { LabCell, LabGrid, LabSection } from '../LabSection.jsx';

export function TypographySection() {
  return (
    <LabSection id="typography" title="Typography" note="Ten type roles. Space Grotesk only for surface and brand headings; mono only for identifiers and figures. Figures appear in the Evidence section.">
      <Stack gap="object">
        <Heading level={3} variant="surface">heading.surface — Decisions that need you</Heading>
        <Heading level={3} variant="section">heading.section — Is it working?</Heading>
        <Text variant="claim" as="p">body.claim — Pause this campaign.</Text>
        <Text variant="body" as="p">body.default — Cost per conversion stayed above the account target for the whole window.</Text>
        <Text variant="label" as="p">label.default — Include paused campaigns</Text>
        <Text variant="caption" as="p">caption.default — window, basis and clock metadata</Text>
        <Text variant="identifier" as="p">technical.identifier — dec_lab_fixture_01</Text>
        <Rule kind="divider" />
        <Text variant="body" light="claim" as="p">body.default at claim light</Text>
        <Text variant="body" light="meta" as="p">body.default at meta light</Text>
      </Stack>
    </LabSection>
  );
}

export function SurfacesSection() {
  return (
    <LabSection id="surfaces" title="Surfaces" note="Levels are roles, not height. A border appears only with a CMP-04 reason; elevated is the overlay role and the only one with a shadow.">
      <LabGrid>
        <LabCell label="level=base (unbounded)">
          <Surface level="base" padding="object"><Text variant="body" as="p">The ground.</Text></Surface>
        </LabCell>
        <LabCell label="level=raised (unbounded)">
          <Surface level="raised" padding="object"><Text variant="body" as="p">A reading region, one step of light.</Text></Surface>
        </LabCell>
        <LabCell label="level=raised boundary=object">
          <Surface level="raised" boundary="object" padding="object"><Text variant="body" as="p">One meaningful object.</Text></Surface>
        </LabCell>
        <LabCell label="level=elevated (overlay role)">
          <Surface level="elevated" padding="object"><Text variant="body" as="p">An overlay above content.</Text></Surface>
        </LabCell>
      </LabGrid>
      <Stack gap="meta">
        <Text variant="caption" as="p">Rule kind=divider, then kind=structure</Text>
        <Rule kind="divider" />
        <Rule kind="structure" />
      </Stack>
    </LabSection>
  );
}

export function VerdictsSection() {
  return (
    <LabSection id="verdicts" title="Verdicts" note="The word is the verdict and is always present; the mark sits beside it. Read the words with colour ignored: each verdict must still be identifiable.">
      <LabGrid>
        <LabCell label="context=claim">
          <Stack gap="meta">{VERDICTS.map((v) => <VerdictMark key={v} verdict={v} />)}</Stack>
        </LabCell>
        <LabCell label="context=list">
          <Stack gap="meta">{VERDICTS.map((v) => <VerdictMark key={v} verdict={v} context="list" />)}</Stack>
        </LabCell>
      </LabGrid>
    </LabSection>
  );
}

export function EnvironmentsSection() {
  return (
    <LabSection id="environments" title="Environments" note="Product is Charcoal. Marketing is Off White, where verdict marks do not exist; a verdict on a marketing page lives inside a Charcoal section. No theme switch exists.">
      <Environment env="marketing">
        <Surface level="base" padding="section">
          <Stack gap="object">
            <Text variant="caption" as="p">env=marketing</Text>
            <Heading level={3} variant="brand">Brand display role</Heading>
            <Text variant="body" as="p">Body text on Off White.</Text>
            <Environment env="marketing-dark-section">
              <Surface level="base" padding="object">
                <Stack gap="meta">
                  <Text variant="caption" as="p">env=marketing-dark-section</Text>
                  <Inline gap="object" align="center"><VerdictMark verdict="SCALE" /><VerdictMark verdict="HOLD" /></Inline>
                </Stack>
              </Surface>
            </Environment>
          </Stack>
        </Surface>
      </Environment>
    </LabSection>
  );
}
