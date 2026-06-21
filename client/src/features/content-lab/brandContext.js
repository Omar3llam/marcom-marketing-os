// ============================================================
// MARCOM / Lumi — Content Lab · brand-context resolver
// ------------------------------------------------------------
// Turns the raw onboarding blob (user.context, persisted verbatim by the
// onboarding wizard) into the readable strings Content Lab sends to the AI
// gateway. The wizard stores ids ('warm', 'roas', 'ecommerce', …); the AI
// prompt wants human descriptors, and the id→label maps already live in the
// onboarding constants — so we resolve through THOSE, never a second copy.
//
// HONESTY: every field is null when the onboarding signal is genuinely absent.
// A null is sent as nothing (the backend then applies its own last-resort
// default) — we never fabricate a plausible-looking value here.
//
// Note: brand voice is the onboarding *tone* (the wizard's only voice signal),
// enriched with language/dialect. There is no separate free-text brandVoice
// field in the structured wizard — tone + language/dialect IS the brand voice.
// ============================================================
import {
  TONES, OBJECTIVES, INDUSTRIES, AGE_BANDS, GENDERS, LANGUAGES, DIALECTS,
} from '@/pages/OnboardingPage/constants.js';

const byId = (list, id) => list.find((x) => x.id === id) || null;

// Composite audience descriptor from the wizard's structured audience step
// (ages map + gender + interests map). Returns null when nothing was picked.
function resolveAudience(ctx) {
  const ages = AGE_BANDS.filter((b) => ctx.ages?.[b.id]).map((b) => b.label);
  const gender = byId(GENDERS, ctx.gender)?.label;
  const interests = Object.keys(ctx.interests || {}).filter((k) => ctx.interests[k]);

  const parts = [];
  if (ages.length) parts.push(ages.join(', '));
  if (gender) parts.push(gender);
  if (interests.length) parts.push(`interested in ${interests.join(', ')}`);
  return parts.length ? parts.join(' · ') : null;
}

// Full brand-voice descriptor: tone label + its one-line character, plus the
// language/dialect the brand publishes in (skipped for English-only).
function resolveBrandVoice(ctx) {
  const tone = byId(TONES, ctx.tone);
  if (!tone) return null;
  let voice = `${tone.label} — ${tone.sub}`;
  const lang = byId(LANGUAGES, ctx.language);
  if (lang) {
    const dialect = ctx.language !== 'en' ? byId(DIALECTS, ctx.dialect) : null;
    voice += dialect && dialect.id !== 'none'
      ? ` · ${lang.label}, ${dialect.label} dialect`
      : ` · ${lang.label}`;
  }
  return voice;
}

function resolveObjective(ctx) {
  if (ctx.objective === 'custom') {
    const custom = (ctx.customObjective || '').trim();
    return custom || byId(OBJECTIVES, 'custom')?.label || null;
  }
  return byId(OBJECTIVES, ctx.objective)?.label || null;
}

/**
 * @param {object|null} context  raw user.context from /api/campaigns/me/context
 * @returns {{ brandVoice, toneLabel, industry, objective, audience }} readable
 *          strings, each null when the underlying onboarding signal is absent.
 */
export function resolveBrandContext(context) {
  const empty = { brandVoice: null, toneLabel: null, industry: null, objective: null, audience: null };
  if (!context || typeof context !== 'object') return empty;

  return {
    brandVoice: resolveBrandVoice(context),
    toneLabel:  byId(TONES, context.tone)?.label ?? null,
    industry:   byId(INDUSTRIES, context.industry)?.label ?? null,
    objective:  resolveObjective(context),
    audience:   resolveAudience(context),
  };
}
