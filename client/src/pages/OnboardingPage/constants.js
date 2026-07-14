// ============================================================
// MARCOM / Lumi — Onboarding Reference Data
// ============================================================
// Market, audience, channel, and plan definitions for the
// comprehensive 9-step onboarding wizard.
//
// Ported from Claude Design handoff (marcom-ai/onboarding.jsx)
// ============================================================

export const MARKETS = [
  { id: 'eg', label: 'Egypt',        currency: 'EGP', cities: ['Cairo', 'Alexandria', 'Giza', 'Mansoura', 'Other'] },
  { id: 'sa', label: 'Saudi Arabia', currency: 'SAR', cities: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Other'] },
  { id: 'ae', label: 'UAE',          currency: 'AED', cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Other'] },
  { id: 'kw', label: 'Kuwait',       currency: 'KWD', cities: ['Kuwait City', 'Hawalli', 'Other'] },
  { id: 'jo', label: 'Jordan',       currency: 'JOD', cities: ['Amman', 'Zarqa', 'Irbid', 'Other'] },
  { id: 'ma', label: 'Morocco',      currency: 'MAD', cities: ['Casablanca', 'Rabat', 'Marrakech', 'Fes', 'Other'] },
];

export const AGE_BANDS = [
  { id: '18-24', label: '18 – 24' },
  { id: '25-34', label: '25 – 34' },
  { id: '35-44', label: '35 – 44' },
  { id: '45-54', label: '45 – 54' },
  { id: '55+',   label: '55+' },
];

export const GENDERS = [
  { id: 'all',    label: 'All' },
  { id: 'female', label: 'Female-leaning' },
  { id: 'male',   label: 'Male-leaning' },
];

export const INTERESTS = [
  'Fashion', 'Beauty', 'Tech', 'Food & dining', 'Travel',
  'Fitness', 'Home', 'Auto', 'Finance', 'Gaming', 'Family',
  'Lifestyle', 'B2B'
];

export const LANGUAGES = [
  { id: 'ar',   label: 'Arabic' },
  { id: 'en',   label: 'English' },
  { id: 'both', label: 'Bilingual' },
];

export const DIALECTS = [
  { id: 'egy',  label: 'Egyptian',         sub: 'Masri' },
  { id: 'gulf', label: 'Gulf',             sub: 'Khaleeji' },
  { id: 'lev',  label: 'Levantine',        sub: 'Shami' },
  { id: 'mag',  label: 'Maghrebi',         sub: 'Darija' },
  { id: 'msa',  label: 'Modern Standard',  sub: 'Fusha' },
  { id: 'none', label: 'English only',     sub: '—' },
];

export const TONES = [
  { id: 'playful', label: 'Playful & casual',    sub: 'Approachable, witty, lower-case-friendly' },
  { id: 'premium', label: 'Premium & refined',   sub: 'Editorial, considered, restrained' },
  { id: 'trusted', label: 'Trusted authority',   sub: 'Direct, evidence-led, expert' },
  { id: 'bold',    label: 'Bold & rebellious',   sub: 'Punchy, provocative, opinionated' },
  { id: 'warm',    label: 'Warm & familial',     sub: 'Personal, story-led, MENA-rooted' },
];

// Only platforms with a real connector are offered — Meta and Google. TikTok,
// Snap, and LinkedIn were removed: no connector exists for them anywhere in the
// product, so presenting them was a promise the backend couldn't keep. Re-add
// each one alongside its connector, not before it.
export const CHANNELS = [
  { id: 'meta',   label: 'Meta',   sub: 'Facebook + Instagram', primary: true },
  { id: 'google', label: 'Google', sub: 'Ads + PMax' },
];

// Business vertical, chosen at onboarding. Drives the revenue-source guidance
// shown on the Campaigns page when connected campaigns lack revenue data —
// `revenueSource` is read there (CampaignsView) to tailor the message, so it is
// a real input, not decorative reference data.
export const INDUSTRIES = [
  { id: 'ecommerce',    label: 'E-commerce / Retail', sub: 'Online store · DTC · marketplace',  revenueSource: 'GA4_SHOPIFY' },
  { id: 'real_estate',  label: 'Real Estate',         sub: 'Brokerage · developer · listings',  revenueSource: 'CRM' },
  { id: 'services_b2b', label: 'Services / B2B',      sub: 'Agency · consulting · B2B services', revenueSource: 'CRM' },
  { id: 'saas',         label: 'SaaS / Subscription', sub: 'Software · app · recurring revenue', revenueSource: 'CRM' },
  { id: 'other',        label: 'Other',               sub: 'Something else',                     revenueSource: 'MANUAL' },
];

export const SPEND_TIERS = [
  { id: 't1', label: 'Under 50k / mo',  bar: 0.18 },
  { id: 't2', label: '50k – 250k / mo', bar: 0.40 },
  { id: 't3', label: '250k – 1M / mo',  bar: 0.68 },
  { id: 't4', label: '1M+ / mo',        bar: 1.00 },
];

export const OBJECTIVES = [
  {
    id: 'roas',
    label: 'Maximize ROAS, minimize bleed',
    sub: 'Default for e-commerce + DTC'
  },
  {
    id: 'conversions',
    label: 'Maximize new conversions',
    sub: 'Volume-focused. Tolerates higher CPA.'
  },
  {
    id: 'ltv',
    label: 'Maximize lifetime value',
    sub: 'Lumi factors in repeat-purchase signal.'
  },
  {
    id: 'custom',
    label: 'Custom objective',
    sub: 'Describe what success looks like.'
  },
];

export const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tag: 'For solo operators',
    prices:  { USD: 39,  EGP: 1800,  SAR: 149,  AED: 144,  KWD: 12,  JOD: 28,  MAD: 390 },
    yearly:  { USD: 390, EGP: 18000, SAR: 1490, AED: 1440, KWD: 120, JOD: 280, MAD: 3900 },
    bullets: [
      '1 workspace',
      '20 verdicts / mo',
      'Content Lab limited',
      'Email alerts'
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tag: 'For media buyers + small teams',
    badge: 'Recommended',
    prices:  { USD: 149,  EGP: 6900,  SAR: 559,  AED: 548,  KWD: 46,  JOD: 106,  MAD: 1490 },
    yearly:  { USD: 1490, EGP: 69000, SAR: 5590, AED: 5480, KWD: 460, JOD: 1060, MAD: 14900 },
    bullets: [
      '3 workspaces · all channels',
      'Unlimited verdicts',
      'Full Content Lab + Calendar',
      '90-day memory layer',
      'Slack + WhatsApp alerts'
    ],
  },
  {
    id: 'agency',
    name: 'Agency',
    tag: 'For agencies + holdcos',
    prices:  { USD: 499,  EGP: 22500, SAR: 1869, AED: 1832, KWD: 154, JOD: 354,  MAD: 4990 },
    yearly:  { USD: 4990, EGP: 225000, SAR: 18690, AED: 18320, KWD: 1540, JOD: 3540, MAD: 49900 },
    bullets: [
      'Unlimited workspaces',
      'Unlimited seats',
      'White-label + custom domain',
      'SSO + audit log',
      'Custom Lumi fine-tuning'
    ],
  },
];

export const STEP_DEFINITIONS = [
  { key: 'welcome',   label: 'Welcome' },
  { key: 'identity',  label: 'Workspace' },
  { key: 'industry',  label: 'Industry' },
  { key: 'audience',  label: 'Audience' },
  { key: 'voice',     label: 'Brand voice' },
  { key: 'channels',  label: 'Ad channels' },
  { key: 'spend',     label: 'Spend tier' },
  { key: 'objective', label: 'Objective' },
  { key: 'review',    label: 'Review' },
];

export const DEFAULTS = {
  name: '',
  industry: '',
  market: 'eg',
  city: 'Cairo', // collected + shown in ReviewStep, but no downstream consumer (dialect derives city from message text)
  tag: '', // deprecated — no step sets it, nothing reads it
  ages: { '25-34': true, '35-44': true },
  gender: 'all',
  interests: { Fashion: true },
  language: 'both',
  dialect: 'egy',
  tone: 'warm',
  channels: { meta: true },
  spendTier: 't2',
  currency: 'EGP',
  objective: 'roas',
  customObjective: '',
};
