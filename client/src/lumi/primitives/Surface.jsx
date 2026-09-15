// ============================================================
// Surface — a region of ground that holds one question
// ------------------------------------------------------------
// Levels are roles, never taste (Constitution Article 16):
//   base      the ground
//   raised    a reading region — one step of light, not physical height
//   elevated  an overlay above content; the only surface with a shadow
//
// A BORDERED container is the last resort (Article 14 §2). `boundary` must name
// the CMP-04 question that earned it; without one, a Surface is unbounded, so a
// card grid cannot be built from this part by accident.
// ============================================================
import { assertOneOf, assertProps, cx } from '../contract.js';
import { useGround } from './Environment.jsx';
import css from './layout.module.css';

const LEVEL = { base: css.levelBase, raised: css.levelRaised, elevated: css.levelElevated };
const PADDING = { meta: css.paddingMeta, object: css.paddingObject, section: css.paddingSection };
const ELEMENTS = ['div', 'section', 'article', 'aside'];

/** COMPONENT_RULES.md CMP-04 — the only reasons a bounded container may exist. */
export const BOUNDARY_REASONS = Object.freeze([
  'object',            // one meaningful object: one Decision, one experiment, one belief
  'evidenceGroup',     // measurements sharing one population and window
  'decisionGroup',     // Decisions sharing one Attention partition
  'actionGroup',       // the controls that act on one Decision
  'independentState',  // a region that can be unavailable or failed on its own
]);

export function Surface(props) {
  assertProps('Surface', props, ['level', 'boundary', 'padding', 'as', 'id']);
  const { level, boundary, padding, as = 'div', children, ...pass } = props;
  useGround('Surface');
  assertOneOf('Surface', 'level', level, Object.keys(LEVEL));
  assertOneOf('Surface', 'as', as, ELEMENTS);
  if (padding !== undefined) assertOneOf('Surface', 'padding', padding, Object.keys(PADDING));
  if (boundary !== undefined) {
    if (level === 'elevated') {
      throw new Error('Surface: an elevated surface is already an overlay container; boundary does not apply.');
    }
    assertOneOf('Surface', 'boundary', boundary, BOUNDARY_REASONS);
  }

  const Element = as;
  return (
    <Element
      {...pass}
      className={cx(css.surface, LEVEL[level], boundary && css.bounded, padding && PADDING[padding])}
    >
      {children}
    </Element>
  );
}
