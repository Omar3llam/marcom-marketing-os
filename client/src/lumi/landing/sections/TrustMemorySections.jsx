// ============================================================
// Landing — honest absence, and Decision Memory (Off White)
// ------------------------------------------------------------
// TRUST (brief question 6, "why believe it"): real states rendered by the real
// <ClaimState>, each with its own words and reason (STATE_RULES.md §4, §12–§15):
//   failed ≠ empty · missing ≠ zero · unknown ≠ healthy.
//   NOT_MEASURED / no revenue verdict   verdictEngine.js:358-363
//   INSUFFICIENT_DATA                    C-07 NO_MEASURABLE_DELIVERY: no measured revenue
//                                        and no spend or impressions → gated out, no
//                                        verdict (connectorVerdictService.js:213). Some
//                                        delivery below the sample gate is a WATCH
//                                        (verdictEngine.js:290), so this is "nothing".
//   NO_CONVERSIONS · MIXED_CURRENCY      AccountAggregateService.js:70-78
// The lead speaks only for the states shown: an unreported metric can still be read
// as 0 by the engine (PHASE_4_1_VISUAL_MOTION_RESEARCH.md §18.16, Finding A).
//
// MEMORY (brief question 7): institutional memory of decisions and outcomes,
// never chat memory. One belief with the four temporal facts C-14 / B8-05
// publish — since when, how often tested, how often it held, what it replaced.
// The constitutional edge (memory can adjust confidence, never the verdict;
// Constitution R-1) is stated once, in the #how spine's Memory stage (Phase 4.4
// removed the axis here that repeated it). Its figures are an illustrative fixture, labelled.
// ============================================================
import {
  ClaimState, EvidenceGroup, Heading, Measurement, Stack, Surface, Text,
} from '../../index.js';
import { IllustrativeNote, LandingSection } from '../parts.jsx';
import css from '../landing.module.css';

const ABSENCES = [
  ['NOT_MEASURED', 'Conversion value',
    'The account does not report conversion value, so LUMI does not call KILL or SCALE on revenue.'],
  ['NO_CONVERSIONS', 'Cost per conversion',
    'Spend is known, but no conversions were reported, so there is no cost per conversion to show.'],
  ['INSUFFICIENT_DATA', 'Verdict',
    'The campaign delivered nothing measurable in its window. No verdict is issued; this reason is.'],
  ['MIXED_CURRENCY', 'Account spend',
    'Campaigns report in more than one currency. LUMI does not add them together.'],
  ['FAILED', 'Google Ads campaigns',
    'The last read did not complete. That is not the same as having no campaigns.'],
];

export function TrustSection() {
  return (
    <LandingSection
      id="trust"
      title="When LUMI cannot know, it says so."
      lead="These are the absences LUMI names. Each has its own words and its own reason, and none is shown as a zero."
    >
      <Stack gap="object">
        <IllustrativeNote>how these states read in LUMI. The claims are invented.</IllustrativeNote>
        <ul className={css.stateGrid}>
          {ABSENCES.map(([state, claim, reason]) => (
            <li key={state}>
              <ClaimState state={state} claim={claim} reason={reason} />
            </li>
          ))}
        </ul>
      </Stack>
    </LandingSection>
  );
}

function Belief() {
  return (
    <Surface level="raised" boundary="object" padding="section" as="article" aria-labelledby="belief-title">
      <Stack gap="object">
        <IllustrativeNote>an invented belief and record.</IllustrativeNote>
        <Stack gap="inline">
          <Heading level={3} variant="section" id="belief-title">
            On this account, creative wears out before the audience does.
          </Heading>
          <Text variant="caption" as="p">Established</Text>
        </Stack>
        <EvidenceGroup
          question="What this belief has been through"
          headingLevel={4}
          population="Illustrative account"
          window="Since 2026-06-02"
          source="LUMI decisions and their outcomes"
        >
          <Measurement label="Tested on later decisions" state="AVAILABLE" figure={{ number: 6, fractionDigits: 0, unit: 'decisions' }} />
          <Measurement label="Held when tested" state="AVAILABLE" figure={{ number: 5, fractionDigits: 0, unit: 'of 6' }} />
          <ClaimState state="AVAILABLE" claim="What it replaced">
            <Text variant="body" light="claim" as="p">An earlier belief that audience size was the limit.</Text>
          </ClaimState>
        </EvidenceGroup>
      </Stack>
    </Surface>
  );
}

export function MemorySection() {
  return (
    <LandingSection
      id="memory"
      title="Decisions compound into memory."
      lead="Recorded decisions keep the grounds captured when the call was made. When an outcome can be observed safely, LUMI measures it against the recorded decision. Patterns that keep holding can become account beliefs. Each shows its record."
    >
      <div className={css.claimColumn}>
        <Stack gap="section">
          <Stack gap="object">
            <Heading level={3} variant="section" id="proof-learning-title">Proof of Learning</Heading>
            <Text variant="body" light="body" as="p">
              When evidence is sufficient, Proof of Learning compares the confidence of qualifying scored decisions
              with observed outcomes. When it is not, LUMI withholds a calibrated claim.
            </Text>
          </Stack>
          <Belief />
        </Stack>
      </div>
    </LandingSection>
  );
}
