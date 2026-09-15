// ============================================================
// Text · Heading · VisuallyHidden — the one typographic API
// ------------------------------------------------------------
// Roles, not sizes (Constitution Article 20 §4). Each variant is one Phase 2
// type role; `light` is one of the three text light steps.
//
// There is no metric variant. A figure set in mono promises a measurement, and
// a measurement without its window does not appear (B8-01 L-6), so figures are
// reachable only through <Measurement>.
// ============================================================
import { assertOneOf, assertProps, cx } from '../contract.js';
import { useGround } from './Environment.jsx';
import css from './type.module.css';

const ROLE = {
  claim: css.roleClaim,           // type.body.claim — the verdict word, the decision sentence
  body: css.roleBody,             // type.body.default — reasons, operational copy
  label: css.roleLabel,           // type.label.default — controls, navigation, form labels
  caption: css.roleCaption,       // type.caption.default — windows, bases, clocks
  identifier: css.roleIdentifier, // type.technical.identifier — ids and codes
};

const DEFAULT_LIGHT = { claim: 'claim', body: 'body', label: 'body', caption: 'meta', identifier: 'meta' };
const LIGHT = { claim: css.lightClaim, body: css.lightBody, meta: css.lightMeta };

export function Text(props) {
  assertProps('Text', props, ['variant', 'light', 'as', 'id']);
  const { variant, light, as = 'span', children, ...pass } = props;
  useGround('Text');
  assertOneOf('Text', 'variant', variant, Object.keys(ROLE));
  assertOneOf('Text', 'as', as, ['span', 'p', 'div']);
  if (light !== undefined) assertOneOf('Text', 'light', light, Object.keys(LIGHT));

  const Element = as;
  return (
    <Element {...pass} className={cx(css.text, ROLE[variant], LIGHT[light ?? DEFAULT_LIGHT[variant]])}>
      {children}
    </Element>
  );
}

const HEADING = { surface: css.headingSurface, section: css.headingSection, brand: css.headingBrand };

/**
 * `brand` is Space Grotesk at display size: a marketing brand moment, so it is
 * refused in the product environment (Article 20 §2: Space Grotesk is rare).
 */
export function Heading(props) {
  assertProps('Heading', props, ['level', 'variant', 'id']);
  const { level, variant, children, ...pass } = props;
  const { env } = useGround('Heading');
  assertOneOf('Heading', 'level', level, [1, 2, 3, 4, 5, 6]);
  assertOneOf('Heading', 'variant', variant, Object.keys(HEADING));
  if (variant === 'brand' && env === 'product') {
    throw new Error('Heading: the brand display role is for marketing environments, not the product.');
  }

  const Element = `h${level}`;
  return (
    <Element {...pass} className={cx(css.text, HEADING[variant], css.lightClaim)}>
      {children}
    </Element>
  );
}

/** Text for assistive technology only. Never used to hide a fact from sight. */
export function VisuallyHidden(props) {
  assertProps('VisuallyHidden', props, []);
  return <span className={css.visuallyHidden}>{props.children}</span>;
}
