// ============================================================
// Spine · SpineStage — the Decision Spine
// ------------------------------------------------------------
// GRAMMAR OBJECT  DECISION (stored) or a current assessment, read in sequence:
//                 VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY
//                 (Constitution Article 8)
// CONTRACT        `tense` + `at` (see TenseLabel); children are SpineStages only
// STATES          a stage renders only with a fact or a measured absence; a
//                 stage with no content does not render (no empty headings,
//                 B8-03). Absences inside a stage are <ClaimState>s.
// WHY LUMI        Article 8: six stages are one object on one axis, not six
//                 cards. 🔒 PR-1: an assessment (NOW) has no ACTION, and OUTCOME
//                 and MEMORY belong to a stored Decision.
// MOTION          none — the spine does not move to show progress (MO-6 §2)
//
// Enforced here, not left to review:
//   - the stages appear in canonical order, each at most once;
//   - a NOW spine refuses ACTION, OUTCOME and MEMORY;
//   - the spine always states its tense, so a live verdict cannot pass as the
//     stored one.
// The axis is a continuous hairline formed by adjacent stages; no stage is a
// bordered box.
// ============================================================
import { Children, isValidElement, useId } from 'react';
import { assertOneOf, assertProps } from '../contract.js';
import { useGround } from '../primitives/Environment.jsx';
import { TenseLabel } from './Tense.jsx';
import css from './grammar.module.css';

export const SPINE_STAGES = Object.freeze(['VERDICT', 'WHY', 'EVIDENCE', 'ACTION', 'OUTCOME', 'MEMORY']);
const ASSESSMENT_STAGES = Object.freeze(['VERDICT', 'WHY', 'EVIDENCE']);
const STAGE_WORD = {
  VERDICT: 'Verdict', WHY: 'Why', EVIDENCE: 'Evidence', ACTION: 'Action', OUTCOME: 'Outcome', MEMORY: 'Memory',
};

export function SpineStage(props) {
  assertProps('SpineStage', props, ['stage', 'headingLevel']);
  const { stage, headingLevel, children } = props;
  useGround('SpineStage');
  const headingId = useId();
  assertOneOf('SpineStage', 'stage', stage, SPINE_STAGES);
  assertOneOf('SpineStage', 'headingLevel', headingLevel, [2, 3, 4, 5, 6]);
  if (children === undefined || children === null || children === false) return null;

  const Heading = `h${headingLevel}`;
  return (
    <section className={css.stage} aria-labelledby={headingId} data-lumi-stage={stage}>
      <Heading id={headingId} className={css.stageLabel}>{STAGE_WORD[stage]}</Heading>
      {children}
    </section>
  );
}

export function Spine(props) {
  assertProps('Spine', props, ['tense', 'at']);
  const { tense, at, children } = props;
  useGround('Spine');
  assertOneOf('Spine', 'tense', tense, ['NOW', 'AT_DECISION']);

  let previous = -1;
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child) || child.type !== SpineStage) {
      throw new Error('Spine: its children are SpineStages only, so the axis stays one object.');
    }
    const stage = child.props.stage;
    assertOneOf('Spine', 'stage', stage, SPINE_STAGES);
    const index = SPINE_STAGES.indexOf(stage);
    if (index <= previous) {
      throw new Error(`Spine: "${stage}" is out of order or repeated. The order is ${SPINE_STAGES.join(' → ')}.`);
    }
    if (tense === 'NOW' && !ASSESSMENT_STAGES.includes(stage)) {
      throw new Error(`Spine: a NOW assessment has no ${stage} stage. Actions attach only to a stored Decision (PR-1).`);
    }
    previous = index;
  });

  return (
    <div className={css.spine} data-lumi-spine={tense}>
      <div className={css.spineTense}>
        <TenseLabel tense={tense} at={at} />
      </div>
      {children}
    </div>
  );
}
