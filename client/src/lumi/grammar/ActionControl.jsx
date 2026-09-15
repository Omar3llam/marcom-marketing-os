// ============================================================
// ActionControl
// ------------------------------------------------------------
// GRAMMAR OBJECT  ACTION (PRODUCT_GRAMMAR.md §6)
// CONTRACT        `decisionId` — the stored Decision the action acts on (🔒 PR-2);
//                 `kind` — platformMutation (LUMI changes the world, e.g.
//                 POST /api/execute/meta) or humanRecord (a person records what
//                 they did: PATCH /decisions/:id/{execute,dismiss,judgment});
//                 `refusal` — a published NOT_EXECUTABLE reason, rendered as the
//                 copy; `state` + `stateReason` for in-flight, 409 and role refusals.
// STATES          available · refused (NOT_EXECUTABLE) · PROCESSING (in flight) ·
//                 noLongerOpen (409) · notPermitted (role). SUCCESS and FAILED of
//                 an execution are the consumer's <ClaimState>.
// WHY LUMI        PR-2 binds every action to a Decision id; B8-03 invariant 9
//                 requires "LUMI will do this" and "I did this" to be
//                 unmistakable; 🔒 PR-5: verdict ≠ action.
// MOTION          feedback only (the Button's pressed and hover states)
//
// Refused: a target without a decisionId, and an entity target — ENTITY ACTION
// has no backend contract (⚠️ FC-8). A `verdict` prop is refused, so an action
// can never be coloured or labelled by the verdict it follows. There is no
// confirmation dialog here: a dialog needs a backdrop token that Phase 2 did not
// define (PHASE_3_PRIMITIVE_AUDIT.md, Findings).
// ============================================================
import { assertOneOf, assertProps, assertText } from '../contract.js';
import { Button } from '../primitives/Button.jsx';
import { useGround } from '../primitives/Environment.jsx';
import { ClaimState } from './ClaimState.jsx';
import css from './grammar.module.css';

const STATE = ['available', 'processing', 'noLongerOpen', 'notPermitted'];

export function ActionControl(props) {
  if ('entityId' in props) {
    throw new Error('ActionControl: an ENTITY action has no backend contract (FC-8). Actions take a decisionId.');
  }
  if ('verdict' in props) {
    throw new Error('ActionControl: verdict ≠ action (PR-5). An action is never styled or labelled by its verdict.');
  }
  assertProps('ActionControl', props, ['kind', 'decisionId', 'label', 'platform', 'onActivate', 'refusal', 'state', 'stateReason']);
  const { kind, decisionId, label, platform, onActivate, refusal, state = 'available', stateReason } = props;
  useGround('ActionControl');
  assertOneOf('ActionControl', 'kind', kind, ['platformMutation', 'humanRecord']);
  assertText('ActionControl', 'decisionId', decisionId);
  assertText('ActionControl', 'label', label);
  assertOneOf('ActionControl', 'state', state, STATE);
  if (kind === 'platformMutation') {
    assertText('ActionControl', 'platform', platform);
  } else if (platform !== undefined) {
    throw new Error('ActionControl: a human record changes no platform; it takes no platform.');
  }
  if (refusal !== undefined) {
    assertText('ActionControl', 'refusal', refusal);
    if (state !== 'available') throw new Error('ActionControl: a refused action has no lifecycle state.');
  } else if (state === 'available' && typeof onActivate !== 'function') {
    throw new Error('ActionControl: an available action needs onActivate.');
  }
  if (state === 'available') {
    if (stateReason !== undefined) throw new Error('ActionControl: an available action takes no stateReason.');
  } else {
    assertText('ActionControl', 'stateReason', stateReason);
  }

  const who = kind === 'platformMutation'
    ? `LUMI will do this on ${platform}`
    : 'You record what you did. LUMI changes nothing.';
  const prominence = kind === 'platformMutation' ? 'standard' : 'quiet';

  let control;
  if (refusal !== undefined) {
    control = <p className={css.bodyText}>{refusal}</p>;
  } else if (state === 'processing') {
    control = <ClaimState state="PROCESSING" claim={label} reason={stateReason} />;
  } else if (state === 'available') {
    control = <span><Button prominence={prominence} onActivate={() => onActivate(decisionId)}>{label}</Button></span>;
  } else {
    control = <span><Button prominence={prominence} disabledReason={stateReason} onActivate={() => {}}>{label}</Button></span>;
  }

  return (
    <div className={css.actionGroup} data-lumi-action={kind}>
      <p className={css.metaText}>{who}</p>
      {control}
    </div>
  );
}
