// ============================================================
// Button · IconButton
// ------------------------------------------------------------
// There is no primary / secondary / danger. Two prominences exist because the
// grammar needs two weights (PRODUCT_GRAMMAR.md §6: a platform mutation
// "carries more visual weight"; a human record "is lighter"):
//   standard  a bounded control with claim-level text
//   quiet     an unbounded control with body-level text
// Neither can take a verdict colour or gold: there is no prop to pass one.
//
// DISABLED NEVER STANDS WITHOUT ITS REASON (STATE_RULES.md §18). A disabled
// button is `aria-disabled`, stays focusable so its reason can be reached, and
// swallows activation. The reason is rendered and linked by aria-describedby.
// ============================================================
import { useId } from 'react';
import { assertOneOf, assertProps, assertText, cx } from '../contract.js';
import { useGround } from './Environment.jsx';
import { Icon } from './Icon.jsx';
import css from './controls.module.css';

const PROMINENCE = { standard: css.standard, quiet: css.quiet };

function Control({ component, props, content, label }) {
  const { prominence, onActivate, type = 'button', disabledReason, id, ...aria } = props;
  useGround(component);
  const reasonId = useId();
  assertOneOf(component, 'prominence', prominence, Object.keys(PROMINENCE));
  assertOneOf(component, 'type', type, ['button', 'submit']);
  if (type === 'button' && typeof onActivate !== 'function') {
    throw new Error(`${component}: onActivate is required for a button that is not a form submit.`);
  }
  const disabled = disabledReason !== undefined;
  if (disabled) assertText(component, 'disabledReason', disabledReason);

  const describedBy = [aria['aria-describedby'], disabled && reasonId].filter(Boolean).join(' ') || undefined;
  const onClick = (event) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onActivate?.(event);
  };

  const button = (
    <button
      {...aria}
      id={id}
      type={type}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      aria-describedby={describedBy}
      onClick={onClick}
      data-lumi-prominence={prominence}
      className={cx(css.button, PROMINENCE[prominence], label && css.iconOnly)}
    >
      {content}
    </button>
  );
  if (!disabled) return button;
  return (
    <span className={css.controlWithReason}>
      {button}
      <span id={reasonId} className={css.reason}>{disabledReason}</span>
    </span>
  );
}

const BUTTON_PROPS = ['prominence', 'onActivate', 'type', 'disabledReason', 'id'];

export function Button(props) {
  assertProps('Button', props, BUTTON_PROPS);
  assertText('Button', 'children (its visible label)', props.children);
  const { children, ...rest } = props;
  return <Control component="Button" props={rest} content={children} />;
}

/** An icon-only control. Its accessible name is mandatory, because the glyph is not one. */
export function IconButton(props) {
  assertProps('IconButton', props, [...BUTTON_PROPS, 'glyph', 'label']);
  const { glyph, label, children, ...rest } = props;
  assertText('IconButton', 'label', label);
  if (children !== undefined) throw new Error('IconButton: an icon button has no visible text; use Button.');
  return <Control component="IconButton" props={rest} label={label} content={<Icon glyph={glyph} size="standalone" />} />;
}
