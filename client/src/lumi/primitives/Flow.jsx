// ============================================================
// Stack · Inline · Rule — grouping by structure before containers
// ------------------------------------------------------------
// Constitution Article 14 §2 orders grouping as alignment → spacing tier →
// hairline rule → typographic change → container. These three parts are the
// first three. Gaps are named by RELATIONSHIP (inline · meta · object ·
// section · macro), never by size, so a larger tier cannot silently stand in
// for a smaller relationship.
// ============================================================
import { assertOneOf, assertProps, cx } from '../contract.js';
import { useGround } from './Environment.jsx';
import css from './layout.module.css';

/** The five relational tiers (DESIGN_TOKEN_ARCHITECTURE.md §7). */
export const GAP_TIERS = Object.freeze({
  inline: css.gapInline,
  meta: css.gapMeta,
  object: css.gapObject,
  section: css.gapSection,
  macro: css.gapMacro,
});

export function Stack(props) {
  assertProps('Stack', props, ['gap', 'as', 'align', 'id']);
  const { gap, as = 'div', align = 'stretch', children, ...pass } = props;
  assertOneOf('Stack', 'gap', gap, Object.keys(GAP_TIERS));
  assertOneOf('Stack', 'as', as, ['div', 'section', 'ul', 'ol']);
  assertOneOf('Stack', 'align', align, ['stretch', 'start']);

  const Element = as;
  return (
    <Element {...pass} className={cx(css.stack, GAP_TIERS[gap], align === 'start' && css.alignStart)}>
      {children}
    </Element>
  );
}

const CROSS = { baseline: css.crossBaseline, center: css.crossCenter, start: css.crossStart };

export function Inline(props) {
  assertProps('Inline', props, ['gap', 'as', 'align', 'justify', 'wrap', 'id']);
  const { gap, as = 'div', align = 'baseline', justify = 'start', wrap = true, children, ...pass } = props;
  assertOneOf('Inline', 'gap', gap, Object.keys(GAP_TIERS));
  assertOneOf('Inline', 'as', as, ['div', 'span', 'p', 'ul']);
  assertOneOf('Inline', 'align', align, Object.keys(CROSS));
  assertOneOf('Inline', 'justify', justify, ['start', 'between']);
  assertOneOf('Inline', 'wrap', wrap, [true, false]);

  const Element = as;
  return (
    <Element
      {...pass}
      className={cx(
        css.inline,
        GAP_TIERS[gap],
        CROSS[align],
        justify === 'between' && css.justifyBetween,
        !wrap && css.nowrap,
      )}
    >
      {children}
    </Element>
  );
}

/**
 * A hairline. `divider` is decorative and hidden from assistive technology;
 * `structure` separates distinct content and is announced as a separator.
 */
export function Rule(props) {
  assertProps('Rule', props, ['kind', 'orientation']);
  const { kind, orientation = 'horizontal', children, ...pass } = props;
  useGround('Rule');
  assertOneOf('Rule', 'kind', kind, ['divider', 'structure']);
  assertOneOf('Rule', 'orientation', orientation, ['horizontal', 'vertical']);
  if (children !== undefined) throw new Error('Rule: a rule carries no content.');

  const className = cx(
    css.rule,
    orientation === 'horizontal' ? css.ruleHorizontal : css.ruleVertical,
    kind === 'divider' ? css.ruleDivider : css.ruleStructure,
  );
  const semantics = kind === 'divider'
    ? { 'aria-hidden': 'true' }
    : { role: 'separator', 'aria-orientation': orientation };

  return orientation === 'horizontal'
    ? <hr {...pass} {...semantics} className={className} />
    : <div {...pass} {...semantics} className={className} />;
}
