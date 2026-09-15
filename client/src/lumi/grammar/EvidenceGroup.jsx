// ============================================================
// EvidenceGroup
// ------------------------------------------------------------
// GRAMMAR OBJECT  EVIDENCE (PRODUCT_GRAMMAR.md §4)
// CONTRACT        `question` — the question the evidence answers (B8-04 groups:
//                 is it working · is the creative using itself up · what is its
//                 state now · what happened after we acted); `population`,
//                 `window` and `source` — the provenance every figure shares.
// STATES          per figure, through <Measurement state>; a group whose whole
//                 read failed is a <ClaimState> in its place
// WHY LUMI        B7-05 and B8-04: evidence is entered from a claim, and a group
//                 shares ONE population and ONE window, so two populations can
//                 never be read as one series (#474).
// MOTION          none
//
// Measurements inside inherit the group's window. A Measurement that declares
// a different window is refused: it belongs to a different group.
// ============================================================
import { createContext, useContext, useId } from 'react';
import { assertOneOf, assertProps, assertText } from '../contract.js';
import { useGround } from '../primitives/Environment.jsx';
import css from './grammar.module.css';

const EvidenceWindow = createContext(null);

/** The window of the enclosing EvidenceGroup, or null outside one. */
export function useEvidenceWindow() {
  return useContext(EvidenceWindow);
}

export function EvidenceGroup(props) {
  assertProps('EvidenceGroup', props, ['question', 'headingLevel', 'population', 'window', 'source']);
  const { question, headingLevel, population, window, source, children } = props;
  useGround('EvidenceGroup');
  const headingId = useId();
  assertText('EvidenceGroup', 'question', question);
  assertOneOf('EvidenceGroup', 'headingLevel', headingLevel, [2, 3, 4, 5, 6]);
  assertText('EvidenceGroup', 'population', population);
  assertText('EvidenceGroup', 'window', window);
  assertText('EvidenceGroup', 'source', source);
  if (children === undefined || children === null) {
    throw new Error('EvidenceGroup: a group without measurements is not evidence; render its state instead.');
  }

  const Heading = `h${headingLevel}`;
  return (
    <section className={css.evidenceGroup} aria-labelledby={headingId}>
      <Heading id={headingId} className={css.evidenceHeading}>{question}</Heading>
      <p className={css.metaText}>{`${population} · ${window} · ${source}`}</p>
      <EvidenceWindow.Provider value={window}>
        <div className={css.evidenceItems}>{children}</div>
      </EvidenceWindow.Provider>
    </section>
  );
}
