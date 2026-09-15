// ============================================================
// ClaimState — the state of one claim
// ------------------------------------------------------------
// GRAMMAR OBJECT  MEASUREMENT — the epistemic envelope of a claim
//                 (PRODUCT_GRAMMAR.md §10; STATE_RULES.md)
// CONTRACT        `state` — one of the locked states, RECEIVED from the consumer,
//                 which received it from the backend or the locked
//                 `absenceState()` adapter. `claim` names what was looked at;
//                 `reason` is the domain copy (token for shape, reason for copy).
// STATES          16 of the 17: every state except DISABLED, which is an
//                 interaction state expressed by a control's `disabledReason`.
// WHY LUMI        🔒 PR-3, Constitution R-4, B8-02: failed ≠ empty, missing ≠
//                 zero, unknown ≠ healthy — and a state is published, never
//                 derived from the shape of data.
// MOTION          none — no spinner, pulse or shimmer (MO-8)
//
// Name: "StateBlock" is taken by a legacy tone-based component
// (client/src/design-system/patterns/StateBlock.jsx), and states are per
// claim, not per page (STATE_RULES.md §17 §1).
//
// Rules enforced:
//   - AVAILABLE, STALE and PARTIAL render the value (children); every absence
//     renders NO value, so a zero or a dash cannot stand in for one.
//   - every state but AVAILABLE and LOADING carries its reason.
//   - an instruction (remedy) is accepted only where STATE_RULES.md permits
//     one; it still renders only when the consumer's reason names it.
//   - PROCESSING and SUCCESS are announced; LOADING marks the region busy.
// ============================================================
import { Lock } from 'lucide-react';
import { assertAbsent, assertOneOf, assertProps, assertText, cx } from '../contract.js';
import { Button } from '../primitives/Button.jsx';
import { useGround } from '../primitives/Environment.jsx';
import { Icon } from '../primitives/Icon.jsx';
import { STATE_LABEL, stateKey, STATES } from './vocabulary.js';
import css from './grammar.module.css';

export const CLAIM_STATES = Object.freeze(STATES.filter((state) => state !== 'DISABLED'));

const VALUE_REQUIRED = new Set(['AVAILABLE', 'STALE', 'PARTIAL']);
const VALUE_OPTIONAL = new Set(['LOADING']);
const REASON_OPTIONAL = new Set(['LOADING']);
const REMEDY_ALLOWED = new Set(['FAILED', 'UNAVAILABLE', 'NOT_CONNECTED', 'NOT_PERMITTED', 'NO_CONVERSIONS', 'EMPTY']);
const ANNOUNCED = new Set(['PROCESSING', 'SUCCESS']);

export function ClaimState(props) {
  assertProps('ClaimState', props, ['state', 'claim', 'reason', 'remedy', 'requiredPlan']);
  const { state, claim, reason, remedy, requiredPlan, children } = props;
  useGround('ClaimState');
  if (state === 'DISABLED') {
    throw new Error('ClaimState: DISABLED is an interaction state; give the control a disabledReason.');
  }
  assertOneOf('ClaimState', 'state', state, CLAIM_STATES);
  assertText('ClaimState', 'claim', claim);

  const hasValue = children !== undefined && children !== null && children !== false;
  if (VALUE_REQUIRED.has(state) && !hasValue) {
    throw new Error(`ClaimState: ${state} renders the value itself; pass it as children.`);
  }
  if (!VALUE_REQUIRED.has(state) && !VALUE_OPTIONAL.has(state) && hasValue) {
    throw new Error(`ClaimState: ${state} is an absence or a result; it renders no value beside it.`);
  }
  if (state === 'AVAILABLE') {
    assertAbsent('ClaimState', 'reason', reason, 'an available value speaks for itself; a qualifier makes it PARTIAL or STALE.');
  } else if (!REASON_OPTIONAL.has(state) || reason !== undefined) {
    assertText('ClaimState', 'reason', reason);
  }
  if (remedy !== undefined) {
    if (!REMEDY_ALLOWED.has(state)) {
      throw new Error(`ClaimState: ${state} carries no instruction (STATE_RULES.md). Remove the remedy.`);
    }
    assertText('ClaimState', 'remedy.label', remedy?.label);
    if (typeof remedy.onActivate !== 'function') throw new Error('ClaimState: remedy.onActivate is required.');
  }
  if (requiredPlan !== undefined) {
    if (state !== 'NOT_PERMITTED') throw new Error('ClaimState: requiredPlan belongs to NOT_PERMITTED only.');
    assertText('ClaimState', 'requiredPlan', requiredPlan);
  }

  const tone = css[`state${stateKey(state)}`];
  return (
    <div
      className={cx(css.claimState, state === 'FAILED' && css.failedBoundary)}
      data-lumi-state={state}
      role={ANNOUNCED.has(state) ? 'status' : undefined}
      aria-busy={state === 'LOADING' ? 'true' : undefined}
    >
      <p className={css.metaText}>{claim}</p>
      {hasValue && <div className={tone}>{children}</div>}
      {state !== 'AVAILABLE' && (
        <p className={cx(css.stateLabel, tone)}>
          {state === 'NOT_PERMITTED' && <Icon glyph={Lock} size="inline" />}
          {STATE_LABEL[state]}
          {requiredPlan && ` · Requires ${requiredPlan}`}
        </p>
      )}
      {reason !== undefined && <p className={css.bodyText}>{reason}</p>}
      {remedy && (
        <span>
          <Button prominence="quiet" onActivate={remedy.onActivate}>{remedy.label}</Button>
        </span>
      )}
    </div>
  );
}
