// Shared class strings for the connect-first onboarding (dark surface). Real
// design tokens only — lumi-gold/lumi-deep are colors.brand keys; lumi-*
// surface/text tokens read correctly on the dark bg-dark-base container.
export const PRIMARY_BTN =
  'w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-lumi-gold px-6 py-3 ' +
  'font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] ' +
  'shadow-gold-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed';

export const GHOST_BTN =
  'w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-lumi-border ' +
  'bg-lumi-elevated px-6 py-3 font-display text-sm text-lumi-text hover:bg-lumi-border transition-all';

export const DARK_INPUT =
  'w-full rounded-lg border border-lumi-border bg-lumi-surface px-4 py-3 text-sm text-lumi-text ' +
  'placeholder:text-lumi-muted focus:border-lumi-gold focus:outline-none focus:ring-2 ' +
  'focus:ring-lumi-gold/20 transition-all';

// The name typed in step 1 must survive the OAuth full-page redirect, so it lives
// in localStorage — NOT in the backend context, which is written only after
// connect+sync (writing it early makes OnboardingRoute bounce us to /app).
export const ONBOARDING_NAME_KEY = 'marcom:onboarding:name';
