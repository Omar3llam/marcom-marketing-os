// Shared class strings for the connect-first onboarding.
//
// OnboardingRoute requires authentication: PR-9 / Article 13 already assign it
// the product environment. These classes consume existing foundation tokens
// inside data-lumi-env="product"; they introduce no token, theme or primitive.
export const PAGE = 'bg-[var(--lumi-color-surface-base)]';

// An outline survives the legacy shadow cascade. Keep keyboard focus neutral
// and immediate; the gold glow must not carry or obscure the indicator.
// Feedback is static in both motion modes (MO-2/MO-5/MO-7). No transition,
// press transform or new FC-20 exception is needed for these native controls.
const KEYBOARD_FOCUS =
  'focus-visible:outline focus-visible:outline-[var(--lumi-color-interaction-focus-ring)] ' +
  'focus-visible:outline-offset-4 focus-visible:shadow-none';

export const PRIMARY_BTN =
  'w-full inline-flex items-center justify-center gap-1.5 rounded-[var(--lumi-radius-control)] border border-[var(--lumi-color-border-strong)] px-6 py-3 ' +
  'font-body text-[length:var(--lumi-type-label-default-size)] font-semibold text-[var(--lumi-color-text-claim)] ' +
  'bg-[var(--lumi-color-surface-raised)] hover:bg-[var(--lumi-color-interaction-hover-surface)] active:bg-[var(--lumi-color-interaction-pressed-surface)] ' +
  `transition-none shadow-none ${KEYBOARD_FOCUS} disabled:opacity-50 disabled:cursor-not-allowed`;

export const GHOST_BTN =
  'w-full inline-flex items-center justify-center gap-1.5 rounded-[var(--lumi-radius-control)] border border-[var(--lumi-color-border-strong)] ' +
  'bg-[var(--lumi-color-surface-base)] px-6 py-3 font-body text-[length:var(--lumi-type-label-default-size)] text-[var(--lumi-color-text-body)] ' +
  'hover:bg-[var(--lumi-color-interaction-hover-surface)] active:bg-[var(--lumi-color-interaction-pressed-surface)] ' +
  `transition-none shadow-none ${KEYBOARD_FOCUS}`;

export const INPUT =
  'w-full rounded-[var(--lumi-radius-control)] border border-[var(--lumi-color-border-strong)] bg-[var(--lumi-color-surface-base)] px-4 py-3 ' +
  'font-body text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)] ' +
  'placeholder:text-[var(--lumi-color-text-meta)] transition-none shadow-none focus:outline ' +
  'focus:outline-[var(--lumi-color-interaction-focus-ring)] focus:outline-offset-4 focus:shadow-none';

// The name typed in step 1 must survive the OAuth full-page redirect, so it lives
// in localStorage — NOT in the backend context, which is written only after
// connect+sync (writing it early makes OnboardingRoute bounce us to /app).
export const ONBOARDING_NAME_KEY = 'marcom:onboarding:name';
