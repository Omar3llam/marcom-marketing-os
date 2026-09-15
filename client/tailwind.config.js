// ============================================================
// MARCOM / Lumi — Tailwind Config
// ============================================================
// LEGACY WIRING. The JSON files imported below are the LEGACY token set
// that the existing UI still renders with. They are not the current token
// authority: that is client/design-system/foundation/tokens/ (Phase 2),
// emitted as `--lumi-*` CSS variables. Change no legacy value here or there;
// a change restyles shipped UI.
// ============================================================
import colors   from './design-system/tokens/colors.json'   assert { type: 'json' };
import motion   from './design-system/tokens/motion.json'   assert { type: 'json' };
import spacing  from './design-system/tokens/spacing.json'  assert { type: 'json' };

/** @type {import('tailwindcss').Config} */
export default {
  // src/lumi/ (Phase 3 primitives) consumes --lumi-* variables through CSS
  // modules and writes no Tailwind classes, so it is not scanned: a utility
  // class written there generates nothing, and the legacy stylesheet stays
  // byte-identical while the new layer grows.
  //
  // Do not exclude a directory that still holds Tailwind classes, even an
  // unreferenced one: `npm run check:tokens` reads every source file and fails
  // on a class the compiled CSS does not define (Phase 4: excluding the legacy
  // src/pages/LandingPage/ broke it at 27 classes). Delete such code instead.
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}', '!./src/lumi/**'],
  theme: {
    extend: {
      colors: {
        'lumi':         colors.brand,
        'accent':       colors.accent,

        // Surface tokens (flat mapping for @apply compatibility)
        'surface':             colors.surface,  // nested object for surface.light, etc.
        'surface-light':       colors.surface.light,
        'surface-card':        colors.surface.card,
        'surface-border':      colors.surface.border,
        'surface-elevated':    colors.surface.elevated,
        'surface-border-strong': colors.surface['border-strong'],
        'surface-dark':          colors.surface.dark,

        // Text tokens (flat + nested for maximum compatibility)
        'dark':         { base: colors.text.base, soft: colors.text.soft, muted: colors.text.muted, subtle: colors.text.subtle },
        'dark-base':    colors.text.base,
        'dark-soft':    colors.text.soft,
        'dark-muted':   colors.text.muted,
        'dark-subtle':  colors.text.subtle,

        'blush':        colors.blush,

        // Semantic signal tokens
        'signal-kill':        colors.signal.kill,
        'signal-kill-bg':     colors.signal['kill-bg'],
        'signal-hold':        colors.signal.hold,
        'signal-hold-bg':     colors.signal['hold-bg'],
        'signal-scale':       colors.signal.scale,
        'signal-scale-bg':    colors.signal['scale-bg'],
        'signal-watch':       colors.signal.watch,
        'signal-watch-bg':    colors.signal['watch-bg'],

        // Stage tokens
        'stage-dying':        colors.stage.dying,
        'stage-fatigued':     colors.stage.fatigued,
        'stage-testing':      colors.stage.testing,
        'stage-stable':       colors.stage.stable,
        'stage-scaling':      colors.stage.scaling,

        // Trend tokens
        'trend-danger':       colors.trend.danger,
        'trend-warning':      colors.trend.warning,
        'trend-positive':     colors.trend.positive,
        'trend-neutral':      colors.trend.neutral,

        // Lumi surface/text tokens (resolves orphaned references)
        'lumi-bg':            colors.lumi.bg,
        'lumi-surface':       colors.lumi.surface,
        'lumi-elevated':      colors.lumi.elevated,
        'lumi-border':        colors.lumi.border,
        'lumi-border-strong': colors.lumi['border-strong'],
        'lumi-text':          colors.lumi.text,
        'lumi-muted':         colors.lumi.muted,
        'lumi-subtle':        colors.lumi.subtle,
        'lumi-accent':        colors.lumi.accent,
        'lumi-accent-soft':   colors.lumi['accent-soft'],

        // Intelligence system tokens
        'radar-active':   colors.radar.active,
        'radar-idle':     colors.radar.idle,
        'radar-critical': colors.radar.critical,
        'radar-stable':   colors.radar.stable,

        'intel-verified': colors.intel.verified,
        'intel-pending':  colors.intel.pending,
        'intel-muted':    colors.intel.muted,
        'intel-surface':  colors.intel.surface,

        'verdict-kill-bg':    colors.verdict['kill-bg'],
        'verdict-hold-bg':    colors.verdict['hold-bg'],
        'verdict-scale-bg':   colors.verdict['scale-bg'],
        'verdict-kill-text':  colors.verdict['kill-text'],
        'verdict-hold-text':  colors.verdict['hold-text'],
        'verdict-scale-text': colors.verdict['scale-text'],
      },

      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        'xs':   ['11px', { lineHeight: '16px', letterSpacing: '0.04em' }],
        'sm':   ['12px', { lineHeight: '18px', letterSpacing: '0.02em' }],
        'base': ['14px', { lineHeight: '22px' }],
        'md':   ['15px', { lineHeight: '24px' }],
        'lg':   ['17px', { lineHeight: '26px' }],
        'xl':   ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        '2xl':  ['24px', { lineHeight: '32px', letterSpacing: '-0.02em' }],
        '3xl':  ['30px', { lineHeight: '38px', letterSpacing: '-0.03em' }],
      },

      boxShadow:     spacing.shadows,
      borderRadius:  spacing.borderRadius,
      animation:     motion.animations,
      keyframes:     motion.keyframes,

      fontVariantNumeric: {
        'tabular-nums': 'tabular-nums',
      },
    },
  },
  plugins: [],
};
