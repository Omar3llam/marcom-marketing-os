// ============================================================
// Icon · Announcement
// ------------------------------------------------------------
// ICON. One family (lucide, already shipped), one stroke logic, two sizes.
// An icon names a function or labels a grammar object with an established
// meaning (Constitution Article 22). The glyphs Article 22 and VISUAL_BOUNDARIES
// VB-F6 / VB-F7 / VB-F12 forbid are refused by name: sparkles, wands, robots,
// brains, bulbs, lamps and suns. An icon is decorative (hidden) unless it is
// given a label, in which case it is announced as an image.
//
// ANNOUNCEMENT. A live region. State changes that matter are announced, not
// only drawn (Article 21; MOTION_RULES.md MO-5 §6). It must stay mounted so
// that a change of its text is heard.
// ============================================================
import { assertOneOf, assertProps, assertText, cx } from '../contract.js';
import css from './type.module.css';

/** lucide displayName values the constitution forbids. */
export const FORBIDDEN_GLYPHS = Object.freeze(new Set([
  'Sparkle', 'Sparkles', 'WandSparkles', 'Wand', 'Wand2',
  'Bot', 'BotMessageSquare', 'BotOff',
  'Brain', 'BrainCircuit', 'BrainCog',
  'Lightbulb', 'LightbulbOff', 'Lamp', 'LampCeiling', 'LampDesk', 'LampFloor', 'LampWallDown', 'LampWallUp',
  'Sun', 'SunDim', 'SunMedium', 'SunMoon', 'Sunrise', 'Sunset',
]));

const SIZE = { inline: css.iconInline, standalone: css.iconStandalone };

export function Icon(props) {
  assertProps('Icon', props, ['glyph', 'size', 'label']);
  const { glyph: Glyph, size = 'inline', label } = props;
  if (!Glyph || (typeof Glyph !== 'object' && typeof Glyph !== 'function')) {
    throw new Error('Icon: glyph must be a lucide icon component.');
  }
  const name = Glyph.displayName;
  if (typeof name !== 'string') {
    throw new Error('Icon: glyph has no displayName, so it cannot be checked against the forbidden set.');
  }
  if (FORBIDDEN_GLYPHS.has(name)) {
    throw new Error(`Icon: "${name}" is forbidden iconography (Constitution Article 22).`);
  }
  assertOneOf('Icon', 'size', size, Object.keys(SIZE));
  if (label !== undefined) assertText('Icon', 'label', label);

  const semantics = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' };
  return (
    <span {...semantics} className={cx(css.icon, SIZE[size])}>
      <Glyph width="100%" height="100%" strokeWidth={1.5} aria-hidden="true" focusable="false" />
    </span>
  );
}

export function Announcement(props) {
  assertProps('Announcement', props, ['politeness']);
  const { politeness = 'polite', children } = props;
  assertOneOf('Announcement', 'politeness', politeness, ['polite', 'assertive']);

  return politeness === 'assertive'
    ? <div role="alert" aria-atomic="true">{children}</div>
    : <div role="status" aria-live="polite" aria-atomic="true">{children}</div>;
}
