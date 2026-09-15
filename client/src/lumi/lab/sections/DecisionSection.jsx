// LUMI Primitive Lab — the Decision Spine and actions. Illustrative fixtures only.
import { useState } from 'react';
import {
  ActionControl, AgreementNote, ClaimState, DecisionIdentity, EvidenceGroup, Heading, Measurement, Rule, Spine,
  SpineStage, Stack, Text, VerdictMark,
} from '../../index.js';
import { LabCell, LabGrid, LabSection } from '../LabSection.jsx';
import lab from '../lab.module.css';

export function DecisionSection() {
  const [paused, setPaused] = useState(false);
  return (
    <LabSection id="decision" title="Decision Spine" note="One subject, two tenses. The current assessment and the stored decision disagree; the disagreement is stated in words, never drawn as a diff.">
      <div className={lab.claimColumn}>
        <Stack gap="section">
          <Stack gap="object">
            <Heading level={3} variant="section">Current assessment</Heading>
            <Spine tense="NOW" at="2026-09-14T09:20:00Z">
              <SpineStage stage="VERDICT" headingLevel={4}>
                <VerdictMark verdict="SCALE" />
                <AgreementNote knowledge="KNOWN" value="DIVERGES" storedVerdict="KILL" />
              </SpineStage>
              <SpineStage stage="WHY" headingLevel={4}>
                <Text variant="body" as="p">Cost per conversion fell below the account target and held there for the whole window.</Text>
              </SpineStage>
              <SpineStage stage="EVIDENCE" headingLevel={4}>
                <EvidenceGroup question="Is it working?" headingLevel={5} population="Campaign lab_fixture" window="8–14 Sep 2026 · UTC" source="Meta Ads">
                  <Measurement label="Spend" state="AVAILABLE" figure={{ amountMinor: 845500, currency: 'KWD' }} />
                  <Measurement label="Cost per conversion" state="NO_CONVERSIONS" reason="Conversion tracking reported none this window." />
                </EvidenceGroup>
              </SpineStage>
            </Spine>
          </Stack>

          <Rule kind="structure" />

          <Stack gap="object">
            <Heading level={3} variant="section">Stored decision</Heading>
            <Spine tense="AT_DECISION" at="2026-09-01T12:00:00Z">
              <SpineStage stage="VERDICT" headingLevel={4}>
                <VerdictMark verdict="KILL" />
                <DecisionIdentity decisionClass="SIGNAL" status={paused ? 'EXECUTED' : 'PROPOSED'} decisionId="dec_lab_fixture_01" />
              </SpineStage>
              <SpineStage stage="WHY" headingLevel={4}>
                <Text variant="body" as="p">At commitment, spend was rising with no conversions reported for fourteen days.</Text>
              </SpineStage>
              <SpineStage stage="ACTION" headingLevel={4}>
                {paused
                  ? <ClaimState state="SUCCESS" claim="Pause campaign" reason="Lab only: nothing was sent. The decision now reads Executed." />
                  : <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_lab_fixture_01" label="Pause campaign" onActivate={() => setPaused(true)} />}
              </SpineStage>
              <SpineStage stage="OUTCOME" headingLevel={4}>
                <ClaimState state="NOT_MEASURED" claim="Outcome after acting" reason="No action has been measured on this decision yet." />
              </SpineStage>
              <SpineStage stage="MEMORY" headingLevel={4}>{null}</SpineStage>
            </Spine>
          </Stack>

          <Stack gap="meta">
            <Text variant="caption" as="p">When agreement could not be checked, the assessment says so instead of assuming it agrees:</Text>
            <AgreementNote knowledge="COULD_NOT_LOOK" />
          </Stack>
        </Stack>
      </div>
    </LabSection>
  );
}

export function ActionsSection() {
  return (
    <LabSection id="actions" title="Actions" note="An action belongs to one stored decision. “LUMI will do this” is heavier than “I did this”; neither takes a verdict colour.">
      <LabGrid>
        <LabCell label="platformMutation · available">
          <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_lab_fixture_02" label="Pause campaign" onActivate={() => {}} />
        </LabCell>
        <LabCell label="humanRecord · available">
          <ActionControl kind="humanRecord" decisionId="dec_lab_fixture_02" label="I paused it myself" onActivate={() => {}} />
        </LabCell>
        <LabCell label="refused (NOT_EXECUTABLE copy)">
          <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_lab_fixture_03" label="Pause campaign" refusal="A HOLD verdict has no platform action." />
        </LabCell>
        <LabCell label="processing">
          <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_lab_fixture_04" label="Pause campaign" state="processing" stateReason="Executing on Meta" />
        </LabCell>
        <LabCell label="noLongerOpen (409)">
          <ActionControl kind="humanRecord" decisionId="dec_lab_fixture_05" label="Dismiss" state="noLongerOpen" stateReason="This decision is no longer open." onActivate={() => {}} />
        </LabCell>
        <LabCell label="notPermitted (role)">
          <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_lab_fixture_06" label="Pause campaign" state="notPermitted" stateReason="Your role cannot pause campaigns." onActivate={() => {}} />
        </LabCell>
      </LabGrid>
    </LabSection>
  );
}
