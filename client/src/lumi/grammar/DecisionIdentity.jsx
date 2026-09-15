// ============================================================
// DecisionIdentity
// ------------------------------------------------------------
// GRAMMAR OBJECT  DECISION — its identity metadata (PRODUCT_GRAMMAR.md §5)
// CONTRACT        `decisionClass` ∈ DECISION_CLASS (runtime-contracts, C-10),
//                 `status` ∈ DecisionStatusSchema, `decisionId` (string)
// STATES          AVAILABLE only; an unreadable Decision is a <ClaimState>
// WHY LUMI        Constitution R-3 and B7-01: a Decision is quiet metadata
//                 beneath its verdict, PROPOSED means "still open" (never "new"),
//                 and an ALLOCATION row never receives a Decision presentation.
// MOTION          none
//
// The committed time is not here: it belongs to the AT DECISION <TenseLabel>,
// so the tense and its clock never separate.
// ============================================================
import { assertOneOf, assertProps, assertText } from '../contract.js';
import { useGround } from '../primitives/Environment.jsx';
import { VisuallyHidden } from '../primitives/Text.jsx';
import { DECISION_CLASS, DECISION_STATUSES } from './vocabulary.js';
import css from './grammar.module.css';

const CLASS_WORD = {
  [DECISION_CLASS.SIGNAL]: 'Signal',
  [DECISION_CLASS.GUARDRAIL]: 'Guardrail',
  [DECISION_CLASS.EXPERIMENT]: 'Experiment',
};

/** PROPOSED reads as "Open": it means still open, never new (B7-01). */
const STATUS_WORD = {
  PROPOSED: 'Open',
  EXECUTED: 'Executed',
  DISMISSED: 'Dismissed',
  SUPERSEDED: 'Superseded',
  RESOLVED: 'Resolved',
};

// Exhaustive at module load (the C-06 pattern): a new status in the contract
// fails loudly here instead of rendering without words.
for (const status of DECISION_STATUSES) {
  if (!STATUS_WORD[status]) throw new Error(`DecisionIdentity: status "${status}" has no words; it needs a ruling.`);
}

export function DecisionIdentity(props) {
  assertProps('DecisionIdentity', props, ['decisionClass', 'status', 'decisionId']);
  const { decisionClass, status, decisionId } = props;
  useGround('DecisionIdentity');
  if (decisionClass === DECISION_CLASS.ALLOCATION) {
    throw new Error('DecisionIdentity: ALLOCATION is a plan artifact, not a Decision (Constitution R-3).');
  }
  assertOneOf('DecisionIdentity', 'decisionClass', decisionClass, Object.keys(CLASS_WORD));
  assertOneOf('DecisionIdentity', 'status', status, DECISION_STATUSES);
  assertText('DecisionIdentity', 'decisionId', decisionId);

  return (
    <p className={css.identity}>
      <span className={css.metaText}><VisuallyHidden>Class: </VisuallyHidden>{CLASS_WORD[decisionClass]}</span>
      <span className={css.metaText}><VisuallyHidden>Status: </VisuallyHidden>{STATUS_WORD[status]}</span>
      <span className={css.identifier}><VisuallyHidden>Decision ID: </VisuallyHidden>{decisionId}</span>
    </p>
  );
}
