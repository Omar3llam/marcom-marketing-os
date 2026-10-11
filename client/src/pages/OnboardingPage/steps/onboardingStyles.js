// Shared class strings for the connect-first onboarding.
//
// The flow renders on the SAME light surface as the app (bg-lumi-bg) and
// AuthPage (bg-surface-light). It previously used `bg-dark-base` — which is
// colors.text.base (#2B2B2B), a TEXT token — while styling its copy with the
// lumi-* palette, whose text tokens are also #2B2B2B. Every heading was
// therefore #2B2B2B on #2B2B2B: a 1:1 contrast ratio, i.e. invisible, and body
// copy at #6B6B6B was 2.66:1 (below the 4.5:1 AA floor). On bg-lumi-bg the same
// tokens read 13.1:1 and 4.9:1 — which is what they were designed for.
export const PAGE = 'bg-lumi-bg';

// An outline survives the legacy shadow cascade. Keep keyboard focus neutral
// and immediate; the gold glow must not carry or obscure the indicator.
// Feedback is static in both motion modes (MO-2/MO-5/MO-7). No transition,
// press transform or new FC-20 exception is needed for these native controls.
const KEYBOARD_FOCUS =
  'focus-visible:outline focus-visible:outline-dark-base ' +
  'focus-visible:outline-offset-4 focus-visible:shadow-none';

export const PRIMARY_BTN =
  'w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-lumi-gold px-6 py-3 ' +
  'font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:bg-lumi-deep ' +
  `transition-none shadow-none ${KEYBOARD_FOCUS} disabled:opacity-50 disabled:cursor-not-allowed`;

export const GHOST_BTN =
  'w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-lumi-border ' +
  'bg-lumi-surface px-6 py-3 font-display text-sm text-lumi-text hover:bg-lumi-elevated active:bg-lumi-elevated ' +
  `transition-none shadow-none ${KEYBOARD_FOCUS}`;

export const INPUT =
  'w-full rounded-xl border border-lumi-border bg-lumi-surface px-4 py-3 text-sm text-lumi-text ' +
  'placeholder:text-lumi-muted transition-none shadow-none focus:outline ' +
  'focus:outline-dark-base focus:outline-offset-4 focus:shadow-none';

// The name typed in step 1 must survive the OAuth full-page redirect, so it lives
// in localStorage — NOT in the backend context, which is written only after
// connect+sync (writing it early makes OnboardingRoute bounce us to /app).
export const ONBOARDING_NAME_KEY = 'marcom:onboarding:name';
