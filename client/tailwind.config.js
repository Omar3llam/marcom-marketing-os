/** @type {import('tailwindcss').Config} */
// ============================================================
// MARCOM / Lumi — Tailwind theme
// ------------------------------------------------------------
// All design tokens live here. Components must reference these
// (e.g. text-lumi-text, bg-lumi-surface). Raw hex in component
// code is a code-review block.
// ============================================================
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Lumi Gold Brand Palette (Premium Glowing Intelligence OS) ────
        'lumi': {
          'gold':  '#F6C945',  // Primary brand gold
          'deep':  '#E0A800',  // Deep gold for hover states
          'glow':  '#FFD95A',  // Bright glow for accents and highlights
        },

        // ── Accent Colors (Warm & Premium) ────────────────────
        'accent': {
          'warm':  '#F59E0B',  // Warm amber for secondary actions
          'amber': '#FBBF24',  // Soft amber for tertiary elements
        },

        // ── Surface Colors (Light & Premium) ──────────────────
        'surface': {
          'light':  '#F8F6F2',  // Light warm background
          'card':   '#FFFFFF',  // Pure white for cards
          'border': '#EDEAE4',  // Soft warm border
        },

        // ── Dark Colors (Professional & Warm) ─────────────────
        'dark': {
          'base': '#2B2B2B',    // Primary dark text
          'soft': '#3A3A3A',    // Secondary dark text (lighter than base)
        },

        // ── Accent Blush ─────────────────────────────────────
        'blush': '#F8B4B4',     // Warm blush for selected/hover states

        // ── Decision-system semantic signals (UNCHANGED) ──────────────────
        'signal-kill':        '#EF4444',   // Red for KILL verdicts
        'signal-kill-bg':     'rgba(239,68,68,0.10)',
        'signal-hold':        '#F59E0B',   // Amber for HOLD verdicts
        'signal-hold-bg':     'rgba(245,158,11,0.10)',
        'signal-scale':       '#10B981',   // Green for SCALE verdicts
        'signal-scale-bg':    'rgba(16,185,129,0.10)',

        // ── Campaign stages ───────────────────────────────────
        'stage-dying':        '#EF4444',
        'stage-fatigued':     '#F59E0B',
        'stage-testing':      '#6366F1',
        'stage-stable':       '#10B981',
        'stage-scaling':      '#06B6D4',

        // ── Metric trends ─────────────────────────────────────
        'trend-danger':       '#EF4444',
        'trend-warning':      '#F59E0B',
        'trend-positive':     '#10B981',
        'trend-neutral':      '#8A93A4',
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

      boxShadow: {
        'card':        '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover':  '0 8px 24px rgba(0,0,0,0.10)',
        'panel':       '0 12px 40px rgba(0,0,0,0.12)',
        'modal':       '0 24px 64px rgba(0,0,0,0.16)',
        'gold-glow':   '0 0 24px rgba(246,201,69,0.20), 0 0 48px rgba(246,201,69,0.10)',
        'accent-glow': '0 0 24px rgba(245,158,11,0.15)',
        'kill-glow':   '0 0 20px rgba(239,68,68,0.25), 0 0 40px rgba(239,68,68,0.10)',
        'scale-glow':  '0 0 20px rgba(16,185,129,0.25), 0 0 40px rgba(16,185,129,0.10)',
        'hold-glow':   '0 0 20px rgba(245,158,11,0.20)',
        'optimize-glow': '0 0 20px rgba(99,102,241,0.20)',
        'active-ring': '0 0 0 2px rgba(246,201,69,0.3), 0 0 16px rgba(246,201,69,0.1)',
      },

      animation: {
        'fade-in':     'fadeIn 400ms ease-out both',
        'scale-in':    'scaleIn 350ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-up':    'slideUp 350ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-right': 'slideRight 350ms cubic-bezier(0.16,1,0.3,1) both',
        'pulse-slow':     'pulse 3s ease-in-out infinite',
        'shimmer':        'shimmer 1.5s ease-in-out infinite',
        'progress-sweep': 'progressSweep 1.6s cubic-bezier(0.65,0.05,0.36,1) infinite',
        'blink':          'blink 1.1s steps(2,start) infinite',
      },

      transitionDuration: {
        DEFAULT: '250ms',
        fast:    '150ms',
        slow:    '400ms',
      },

      keyframes: {
        fadeIn:     { from: { opacity: 0 }, to: { opacity: 1 } },
        scaleIn:    {
          from: { opacity: 0, transform: 'scale(0.95)' },
          to:   { opacity: 1, transform: 'scale(1)' },
        },
        slideUp:    {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        slideRight: {
          from: { opacity: 0, transform: 'translateX(-6px)' },
          to:   { opacity: 1, transform: 'translateX(0)' },
        },
        shimmer: {
          '0%, 100%': { opacity: 0.4 },
          '50%':      { opacity: 0.8 },
        },
        // Theatre progress sweep: 0 → 100% width loop
        progressSweep: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // Block-cursor blink for terminal aesthetic
        blink: {
          '0%, 49%':   { opacity: 1 },
          '50%, 100%': { opacity: 0 },
        },
      },
    },
  },
  plugins: [],
};
