// ============================================================
// TextLink — navigation written in text
// ------------------------------------------------------------
// A link is always underlined, so it is never identified by colour alone
// (WCAG 1.4.1) and never gold (CMP-08). It inherits the light of the sentence
// it sits in. `current` marks the reader's location with the active indicator
// and `aria-current`, never with a colour change alone.
//
// `to` navigates inside the app through the router; `href` leaves it.
// ============================================================
import { Link } from 'react-router-dom';
import { assertOneOf, assertProps, assertText } from '../contract.js';
import { useGround } from './Environment.jsx';
import css from './controls.module.css';

export function TextLink(props) {
  assertProps('TextLink', props, ['to', 'href', 'current', 'id']);
  const { to, href, current, children, ...pass } = props;
  useGround('TextLink');
  assertText('TextLink', 'children (its visible text)', children);
  if ((to === undefined) === (href === undefined)) {
    throw new Error('TextLink: pass exactly one of `to` (in-app route) or `href` (leaves the app).');
  }
  if (current !== undefined) assertOneOf('TextLink', 'current', current, ['page', 'location']);

  if (to !== undefined) {
    assertText('TextLink', 'to', to);
    return (
      <Link {...pass} to={to} aria-current={current} className={css.link}>
        {children}
      </Link>
    );
  }
  assertText('TextLink', 'href', href);
  return (
    <a {...pass} href={href} rel="noreferrer" aria-current={current} className={css.link}>
      {children}
    </a>
  );
}
