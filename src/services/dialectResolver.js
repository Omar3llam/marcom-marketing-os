// ============================================================
// MARCOM — Dialect Resolver
// Maps onboarding context → correct dialect pack + register level
// + code-switching policy + forbidden-terms list.
// ============================================================
//
// Inputs (from Mode 1 onboarding + the active request):
//   country         — ISO-2 ("EG", "SA", "US", "MX", ...)
//   city            — optional ("Cairo", "Damanhur", "Riyadh")
//   audience_age    — "gen_z" | "millennial" | "gen_x" | "boomer" | "mixed"
//   audience_segment— freeform string e.g. "B2B CMOs", "Latino millennials"
//   platform        — "instagram_caption" | "tiktok_script" | "linkedin_post"
//                     | "b2b_email" | "whatsapp_dm" | "facebook_post"
//                     | "x_post" | "youtube_script"
//   brand_tone      — "playful" | "professional" | "luxury" | "edgy" | "neutral"
//   target_dialect  — optional override (e.g. brand explicitly says "Khaleeji")
//
// Output:
//   { dialect_id, dialect_pack, register_level, code_switch_policy,
//     forbidden_terms, fallback_used, refusal_required, refusal_reason }
//
// Fallback hierarchy:
//   1. explicit target_dialect (operator override)
//   2. country + audience_segment cross-pollination rules
//   3. country default
//   4. iso_base default (e.g. unknown Arab country → MSA)
//
// Register hierarchy:
//   street → casual_social → professional_casual → corporate_formal
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIALECT_DIR = path.resolve(__dirname, '../data/dialects');

// ── Country → default dialect lookup ─────────────────────────
const COUNTRY_DEFAULTS = {
  EG: 'egyptian_arabic',
  SA: 'khaleeji_arabic',
  AE: 'khaleeji_arabic',
  KW: 'khaleeji_arabic',
  QA: 'khaleeji_arabic',
  BH: 'khaleeji_arabic',
  OM: 'khaleeji_arabic',
  LB: 'levantine_arabic',
  SY: 'levantine_arabic',
  JO: 'levantine_arabic',
  PS: 'levantine_arabic',
  MA: 'maghrebi_arabic',
  TN: 'maghrebi_arabic',
  DZ: 'maghrebi_arabic',
  IQ: 'iraqi_arabic',
  US: 'american_english',
  GB: 'british_english',
  AU: 'australian_english',
  IN: 'indian_english',
  SG: 'singlish',
  MX: 'mexican_spanish',
  AR: 'argentinian_spanish',
  ES: 'castilian_spanish',
  CO: 'colombian_spanish',
  PR: 'caribbean_spanish',
  DO: 'caribbean_spanish',
  CU: 'caribbean_spanish',
  FR: 'french_france',
  CA: 'quebecois_french', // assumes Quebec — refine via city if needed
  BR: 'brazilian_portuguese',
  PT: 'european_portuguese',
  DE: 'german',
  TR: 'turkish',
  PK: 'hindi_urdu',
  ID: 'indonesian',
  PH: 'tagalog',
};

// ── Cross-pollination rules ─────────────────────────────────
// "Country X but audience is Y" → override default
function applyCrossPollinationRules(ctx) {
  const { country, audience_segment = '', city = '' } = ctx;
  const seg = audience_segment.toLowerCase();
  const ct  = (city || '').toLowerCase();

  // Pan-Arab brand → MSA (checked FIRST so it wins over country-specific rules)
  if (/pan-arab|pan arab|gcc-wide|all arab|arab world|عرب/i.test(seg)) {
    return { dialect_id: 'modern_standard_arabic', reason: 'Pan-Arab audience — MSA only' };
  }

  // KSA brand wants Egyptian content (huge EG diaspora in Gulf)
  if (country === 'SA' && /egyptian|masri|مصري/i.test(seg)) {
    return { dialect_id: 'egyptian_arabic', reason: 'KSA brand targeting Egyptian audience' };
  }
  // UAE brand serving Levantines
  if (country === 'AE' && /levant|lebanese|syrian|jordan|شامي|لبنان/i.test(seg)) {
    return { dialect_id: 'levantine_arabic', reason: 'UAE brand targeting Levantine audience' };
  }
  // US brand for Latino markets → Spanglish via Mexican Spanish pack with code-switching
  if (country === 'US' && /latino|hispanic|spanish-speaking|mexican-american/i.test(seg)) {
    return {
      dialect_id: 'mexican_spanish',
      reason: 'US-Latino market — Spanglish via Mexican Spanish pack',
      override_code_switch: { english_in_spanish: 'heavy', natural_pattern: 'spanglish' },
    };
  }
  // US brand for Black-audience-focused — only allow AAVE if explicit (handled in safety check)
  // Quebec — francophone Canadian
  if (country === 'CA' && /quebec|québec|francais|french/i.test(seg + ct)) {
    return { dialect_id: 'quebecois_french', reason: 'Francophone Canadian audience' };
  }
  if (country === 'CA' && !/quebec|francais|french/i.test(seg + ct)) {
    return { dialect_id: 'american_english', reason: 'Anglophone Canada — defaulting to American English' };
  }

  return null;
}

// ── Register selection ───────────────────────────────────────
// Picks register_level from dialect.platform_register_map + brand_tone + age.
function pickRegister(pack, ctx) {
  const { platform, brand_tone = 'neutral', audience_age = 'mixed' } = ctx;
  const map = pack.platform_register_map || {};
  let raw = map[platform] || 'casual_social';

  // map can list multiple options separated by " | " — pick by audience
  const options = raw.split('|').map(s => s.trim());
  if (options.length > 1) {
    if (audience_age === 'gen_z') return options[0]; // earliest = most casual
    if (audience_age === 'boomer' || audience_age === 'gen_x') return options[options.length - 1];
    return options[Math.floor(options.length / 2)] || options[0];
  }

  // brand_tone overrides
  if (brand_tone === 'luxury' && raw === 'street') return 'casual_social';
  if (brand_tone === 'professional' && raw === 'street') return 'professional_casual';
  if (brand_tone === 'edgy' && raw === 'corporate_formal') return 'professional_casual';

  return raw;
}

// ── Code-switching policy ────────────────────────────────────
function buildCodeSwitchPolicy(pack, ctx, registerLevel) {
  const { audience_age = 'mixed' } = ctx;
  const base = pack.code_switching_patterns || {};
  let intensity = 'none';

  // Gen Z + casual register → heavy code-switching for most modern dialects
  if (audience_age === 'gen_z' && ['street', 'casual_social'].includes(registerLevel)) {
    intensity = 'heavy';
  } else if (['casual_social', 'professional_casual'].includes(registerLevel)) {
    intensity = 'moderate';
  } else if (registerLevel === 'corporate_formal') {
    intensity = 'minimal';
  }

  return {
    intensity,
    patterns: base,
    rules: base.rules || [
      'Code-switching must follow natural local patterns — never random word substitution.',
      'When unsure, write the dominant language and only switch for a culturally-anchored term.',
    ],
  };
}

// ── Safety / refusal checks ──────────────────────────────────
// Per Core Law 3: AAVE may only be produced when brand is Black-owned or
// Black-audience-focused AND user explicitly requests it.
function safetyCheck(ctx) {
  const { dialect_id_requested, audience_segment = '', brand_owned_by = '' } = ctx;
  const seg = audience_segment.toLowerCase();
  const owner = (brand_owned_by || '').toLowerCase();

  if (dialect_id_requested === 'aave_english') {
    const blackAudience = /black|african-american|aave|hbcu/.test(seg);
    const blackOwned    = /black-owned|black owned|aave|african-american-owned/.test(owner);
    if (!blackAudience && !blackOwned) {
      return {
        refusal_required: true,
        refusal_reason:
          'AAVE was requested without a Black-owned brand or Black-audience context. ' +
          'Lumi will not produce AAVE for general-market campaigns to avoid cultural appropriation. ' +
          'Recommend: write in standard American English, or partner with Black creators if AAVE is essential to the campaign.',
      };
    }
  }
  return { refusal_required: false };
}

// ── Loader ───────────────────────────────────────────────────
function loadPack(dialectId) {
  const file = path.join(DIALECT_DIR, `${dialectId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    logger.error({ file, err: err.message }, '[dialectResolver] Failed to parse dialect pack');
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────
export function resolveDialect(ctx = {}) {
  // 1. Safety check first — refusals short-circuit
  const safety = safetyCheck(ctx);
  if (safety.refusal_required) {
    return {
      dialect_id: null,
      dialect_pack: null,
      register_level: null,
      code_switch_policy: null,
      forbidden_terms: [],
      fallback_used: false,
      refusal_required: true,
      refusal_reason: safety.refusal_reason,
    };
  }

  // 2. Resolution priority: explicit override > cross-pollination > country default > MSA fallback
  let dialectId = ctx.target_dialect || ctx.dialect_id_requested;
  let fallbackUsed = false;
  let fallbackReason = null;

  if (!dialectId) {
    const cross = applyCrossPollinationRules(ctx);
    if (cross) {
      dialectId = cross.dialect_id;
      fallbackReason = cross.reason;
      ctx._crossOverrides = cross.override_code_switch || null;
    }
  }

  if (!dialectId && ctx.country) {
    dialectId = COUNTRY_DEFAULTS[ctx.country.toUpperCase()];
    if (dialectId) fallbackReason = `Country default for ${ctx.country}`;
  }

  // Last-resort fallbacks by language family hint
  if (!dialectId) {
    if (/arab|عرب|msa/i.test(ctx.audience_segment || '')) {
      dialectId = 'modern_standard_arabic';
      fallbackReason = 'No country — defaulting to MSA for Arabic-language request';
      fallbackUsed = true;
    } else {
      dialectId = 'american_english';
      fallbackReason = 'No country provided — defaulting to American English';
      fallbackUsed = true;
    }
  }

  // 3. Load the pack
  let pack = loadPack(dialectId);
  if (!pack) {
    // pack file missing — fall back to MSA or American English
    const familyFallback = dialectId.includes('arabic') ? 'modern_standard_arabic' : 'american_english';
    pack = loadPack(familyFallback);
    fallbackUsed = true;
    fallbackReason = `Pack ${dialectId} not found — using ${familyFallback} fallback`;
    dialectId = familyFallback;
  }
  if (!pack) {
    return {
      dialect_id: null,
      dialect_pack: null,
      register_level: 'casual_social',
      code_switch_policy: { intensity: 'none' },
      forbidden_terms: [],
      fallback_used: true,
      refusal_required: false,
      fallback_reason: 'No dialect packs available — operating without dialect lock.',
    };
  }

  // 4. Pick register
  const registerLevel = pickRegister(pack, ctx);

  // 5. Build code-switching policy
  const codeSwitch = buildCodeSwitchPolicy(pack, ctx, registerLevel);
  if (ctx._crossOverrides) Object.assign(codeSwitch, ctx._crossOverrides);

  // 6. Forbidden terms = pack.do_not_use + register-specific exclusions
  const forbidden = [...(pack.do_not_use || [])];
  if (registerLevel === 'corporate_formal' && pack.lexicon?.gen_z_internet_slang) {
    forbidden.push(...pack.lexicon.gen_z_internet_slang.map(t => `[register-mismatch] ${t}`));
  }

  return {
    dialect_id: dialectId,
    dialect_pack: pack,
    register_level: registerLevel,
    code_switch_policy: codeSwitch,
    forbidden_terms: forbidden,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
    refusal_required: false,
  };
}

// ── Helpers exposed for tests ────────────────────────────────
export const _internals = { COUNTRY_DEFAULTS, applyCrossPollinationRules, pickRegister, safetyCheck, loadPack };
