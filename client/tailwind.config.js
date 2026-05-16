// ============================================================
// MARCOM / Lumi — Tailwind Config
// ============================================================
// IMPORTANT: Do NOT edit token values here.
// Edit /client/design-system/tokens/*.json instead.
// This file imports from the JSON source of truth.
// ============================================================
import colors   from './design-system/tokens/colors.json'   assert { type: 'json' };
import motion   from './design-system/tokens/motion.json'   assert { type: 'json' };
import spacing  from './design-system/tokens/spacing.json'  assert { type: 'json' };

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'lumi':         colors.brand,
        'accent':       colors.accent,
        'surface':      colors.surface,
        'dark':         { base: colors.text.base, soft: colors.text.soft },
        'blush':        colors.blush,

        // Semantic signal tokens
        'signal-kill':        colors.signal.kill,
        'signal-kill-bg':     colors.signal['kill-bg'],
        'signal-hold':        colors.signal.hold,
        'signal-hold-bg':     colors.signal['hold-bg'],
        'signal-scale':       colors.signal.scale,
        'signal-scale-bg':    colors.signal['scale-bg'],

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

      boxShadow:  spacing.shadows,
      animation:  motion.animations,
      keyframes:  motion.keyframes,
    },
  },
  plugins: [],
};
