// ============================================================
// Landing — a decision keeps its grounds (Charcoal band)
// ------------------------------------------------------------
// Brief question 6, shown with the real grammar parts, not a screenshot.
//   - The RECORDED decision is an AT DECISION spine: verdict, why, evidence and
//     the action group for that decision id (🔒 PR-2). Its OUTCOME stage appears
//     only once something was done (Article 8 §4).
//   - TODAY'S assessment of the same campaign is a NOW spine with no action
//     (🔒 PR-1). It disagrees, and the disagreement is named in words by
//     AgreementNote — no arrow, strikethrough or delta (FC-5, B7-06).
//
// NOW = REFRESH is the engine's creative-fatigue branch once return is back
// above break-even (verdictEngine.js:429-433). Every name, id and time here is an
// illustrative fixture, labelled as one (Article 28). "Its call and reasons are
// never rewritten" is the Phase 4.2 ruled form: a superseded row gets status and
// outcome fields, never a new verdict or reasons (PHASE_4_1_VISUAL_MOTION_RESEARCH.md
// §18.16 S4). Activating an action
// changes only this page: nothing is sent, and the confirmation says so.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import {
  ActionControl, ActionLink, AgreementNote, ClaimState, DecisionIdentity, EvidenceGroup, Heading, Inline, Spine,
  SpineStage, Stack, Text, VerdictMark,
} from '../../index.js';
import { IllustrativeNote, LandingSection } from '../parts.jsx';
import css from '../landing.module.css';

const DECISION_ID = 'dec_illustrative_01';

function Grounds({ question, population, window, facts }) {
  return (
    <EvidenceGroup question={question} headingLevel={5} population={population} window={window} source="Meta Ads">
      {facts.map(([claim, value]) => (
        <ClaimState key={claim} state="AVAILABLE" claim={claim}>
          <Text variant="body" light="claim" as="p">{value}</Text>
        </ClaimState>
      ))}
    </EvidenceGroup>
  );
}

function RecordedDecision() {
  // null → open · 'paused' → LUMI paused it on Meta · 'recorded' → you recorded doing it yourself
  const [done, setDone] = useState(null);
  // The activated control leaves the page, so focus moves to what replaced it.
  const result = useRef(null);
  useEffect(() => { if (done) result.current?.focus(); }, [done]);
  const confirmation = {
    paused: 'Paused on Meta. Illustrative example: nothing was sent to Meta.',
    recorded: 'Recorded: you paused it yourself. Illustrative example: nothing was saved.',
  }[done];

  return (
    <Stack gap="object">
      <Heading level={3} variant="section">The recorded decision</Heading>
      <Spine tense="AT_DECISION" at="2026-09-01T09:00:00Z">
        <SpineStage stage="VERDICT" headingLevel={4}>
          <VerdictMark verdict="KILL" />
          <DecisionIdentity decisionClass="SIGNAL" status={done ? 'EXECUTED' : 'PROPOSED'} decisionId={DECISION_ID} />
        </SpineStage>
        <SpineStage stage="WHY" headingLevel={4}>
          <Text variant="body" as="p">
            Return stayed below break-even while frequency passed the fatigue ceiling. Revenue was measured, so a
            revenue verdict could be called.
          </Text>
        </SpineStage>
        <SpineStage stage="EVIDENCE" headingLevel={4}>
          <Grounds
            question="Is it working?"
            population="Illustrative campaign"
            window="Verdict window at decision"
            facts={[['Return on ad spend', 'Below break-even'], ['Frequency', 'Past the fatigue ceiling']]}
          />
        </SpineStage>
        <SpineStage stage="ACTION" headingLevel={4}>
          {done
            ? <div ref={result} tabIndex={-1} className={css.focusTarget}><ClaimState state="SUCCESS" claim={done === 'paused' ? 'Pause campaign on Meta' : 'Your record'} reason={confirmation} /></div>
            : (
              <Stack gap="object">
                <ActionControl kind="platformMutation" platform="Meta" decisionId={DECISION_ID} label="Pause campaign"
                  onActivate={() => setDone('paused')} />
                <ActionControl kind="humanRecord" decisionId={DECISION_ID} label="I paused it myself"
                  onActivate={() => setDone('recorded')} />
              </Stack>
            )}
        </SpineStage>
        <SpineStage stage="OUTCOME" headingLevel={4}>
          {done && (
            <ClaimState state="NOT_MEASURED" claim="What happened after acting"
              reason="Not observed yet: the window after the pause has not closed." />
          )}
        </SpineStage>
      </Spine>
    </Stack>
  );
}

function TodaysAssessment() {
  return (
    <Stack gap="object">
      <Heading level={3} variant="section">Today’s assessment of the same campaign</Heading>
      <Spine tense="NOW" at="2026-09-14T09:00:00Z">
        <SpineStage stage="VERDICT" headingLevel={4}>
          <VerdictMark verdict="REFRESH" />
          <AgreementNote knowledge="KNOWN" value="DIVERGES" storedVerdict="KILL" />
        </SpineStage>
        <SpineStage stage="WHY" headingLevel={4}>
          <Text variant="body" as="p">
            Return is back above break-even. The audience is still seeing the same creative too often, so the
            creative is what needs to change.
          </Text>
        </SpineStage>
        <SpineStage stage="EVIDENCE" headingLevel={4}>
          <Grounds
            question="Is it working?"
            population="Illustrative campaign"
            window="Current verdict window"
            facts={[['Return on ad spend', 'Above break-even'], ['Frequency', 'Past the fatigue ceiling']]}
          />
        </SpineStage>
      </Spine>
      <Text variant="caption" light="body" as="p">
        Its call and reasons are never rewritten. LUMI states the difference and leaves the call to you.
      </Text>
    </Stack>
  );
}

export function DecisionSection() {
  return (
    <LandingSection
      id="evidence"
      title="A decision keeps its grounds."
      lead="When LUMI commits to a verdict, its reason and evidence are recorded with it. Its call and reasons are never rewritten when a later assessment disagrees. If the two disagree, LUMI says so in words."
    >
      <IllustrativeNote>an invented campaign and decision. Nothing on this page is sent anywhere.</IllustrativeNote>
      <div className={css.split}>
        <RecordedDecision />
        <TodaysAssessment />
      </div>
      {/* Phase 4.4: the page's one mid-page next step, at its proof peak. Same quiet
          ActionLink and destination as the hero; `data-landing-cta` is a hook only. */}
      <Inline gap="object" align="center">
        <ActionLink prominence="quiet" to="/signup" data-landing-cta="proof">Create an account</ActionLink>
      </Inline>
    </LandingSection>
  );
}
