// ============================================================
// ActionLink — navigation that carries a control's weight
// ------------------------------------------------------------
// Added in Phase 4 (PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md §4.8).
//
// A step to another page ("Create an account", "Open decision") is navigation,
// so it must be a real link: it has an address, opens in a new tab, and is read
// as a link by assistive technology and crawlers. `Button` is the wrong element
// for it (it has no address) and `TextLink` is the wrong weight for it (it lives
// inside a sentence). ActionLink is the link element with Button's two
// prominences, drawn by the same controls stylesheet, so there is still exactly
// one look for a control and one focus ring (CMP-01 §1; no second button style).
//
// Consumers with the same behaviour: the landing's account CTAs, and the product
// surfaces' "open the decision" steps from Attention (PRODUCT_GRAMMAR.md §9).
// Neither prominence can take gold or a verdict colour: there is no prop to pass one.
// ============================================================
import { Link } from 'react-router-dom';
import { assertOneOf, assertProps, assertText, cx } from '../contract.js';
import { useGround } from './Environment.jsx';
import css from './controls.module.css';

const PROMINENCE = { standard: css.standard, quiet: css.quiet };

export function ActionLink(props) {
  assertProps('ActionLink', props, ['prominence', 'to', 'href', 'id']);
  const { prominence, to, href, children, ...pass } = props;
  useGround('ActionLink');
  assertOneOf('ActionLink', 'prominence', prominence, Object.keys(PROMINENCE));
  assertText('ActionLink', 'children (its visible label)', children);
  if ((to === undefined) === (href === undefined)) {
    throw new Error('ActionLink: pass exactly one of `to` (in-app route) or `href` (leaves the app).');
  }

  const className = cx(css.button, PROMINENCE[prominence]);
  if (to !== undefined) {
    assertText('ActionLink', 'to', to);
    return <Link {...pass} to={to} data-lumi-prominence={prominence} className={className}>{children}</Link>;
  }
  assertText('ActionLink', 'href', href);
  return <a {...pass} href={href} rel="noreferrer" data-lumi-prominence={prominence} className={className}>{children}</a>;
}
