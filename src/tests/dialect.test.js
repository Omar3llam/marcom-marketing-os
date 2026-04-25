// ============================================================
// MARCOM — Dialect Resolver + Injector Tests
// Run with:  node --test src/tests/dialect.test.js
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDialect } from '../services/dialectResolver.js';
import { compileDialectFragment } from '../prompts/dialectInjector.js';
import { extractDialectContext, MODE_PLATFORM_HINTS } from '../utils/dialectContext.js';

// ── 1. Egyptian B2C Instagram for Gen Z ──────────────────────
test('Egyptian B2C Instagram for 25yo female audience → casual_social, no MSA, EN-AR code-switch ok', () => {
  const r = resolveDialect({
    country: 'EG',
    city: 'Cairo',
    audience_age: 'gen_z',
    audience_segment: 'female 22-28 lifestyle',
    platform: 'instagram_caption',
    brand_tone: 'playful',
  });
  assert.equal(r.dialect_id, 'egyptian_arabic');
  assert.equal(r.register_level, 'casual_social');
  assert.ok(['heavy', 'moderate'].includes(r.code_switch_policy.intensity));
  assert.ok(!r.refusal_required);
  const frag = compileDialectFragment(r);
  assert.match(frag, /Egyptian Arabic/);
  assert.match(frag, /casual_social/);
  // MSA-stiff lexicon should be flagged in do_not_use, not in active lexicon
  assert.match(frag, /MSA in casual social copy/i);
});

// ── 2. Saudi LinkedIn B2B for CMOs ───────────────────────────
test('Saudi LinkedIn B2B for CMOs → MSA-leaning Khaleeji-professional, no street slang', () => {
  const r = resolveDialect({
    country: 'SA',
    city: 'Riyadh',
    audience_age: 'gen_x',
    audience_segment: 'B2B CMOs and marketing directors',
    platform: 'linkedin_post',
    brand_tone: 'professional',
  });
  assert.equal(r.dialect_id, 'khaleeji_arabic');
  assert.equal(r.register_level, 'professional_casual');
  // gen_x + professional register → minimal/moderate code-switching, never heavy
  assert.notEqual(r.code_switch_policy.intensity, 'heavy');
  const frag = compileDialectFragment(r);
  // Khaleeji fragment SHOULD warn against Egyptian dialect markers in its do_not_use list
  assert.match(frag, /Egyptian markers/i);
  // gen_z slang category should be excluded from the active lexicon block at professional_casual
  assert.doesNotMatch(frag, /^\s*•\s*gen_z_internet_slang:/m);
});

// ── 3. Mexican TikTok Gen Z ──────────────────────────────────
test('Mexican TikTok script for Gen Z → casual_social with native markers (chido/qué onda)', () => {
  const r = resolveDialect({
    country: 'MX',
    audience_age: 'gen_z',
    audience_segment: 'urban Gen Z 18-24',
    platform: 'tiktok_script',
    brand_tone: 'edgy',
  });
  assert.equal(r.dialect_id, 'mexican_spanish');
  assert.ok(['street', 'casual_social'].includes(r.register_level));
  const frag = compileDialectFragment(r);
  assert.match(frag, /chido|qué onda|neta/i);
});

// ── 4. Cross-pollination: KSA brand wants Egyptian content ───
test('Cross-pollination: KSA brand explicitly targeting Egyptian audience → Egyptian pack, NOT Khaleeji', () => {
  const r = resolveDialect({
    country: 'SA',
    audience_age: 'millennial',
    audience_segment: 'Egyptian expats in KSA — Masri-speaking community',
    platform: 'instagram_caption',
    brand_tone: 'playful',
  });
  assert.equal(r.dialect_id, 'egyptian_arabic',
    'KSA-brand-targeting-Egyptians should resolve to egyptian_arabic, not khaleeji_arabic');
  assert.equal(r.register_level, 'casual_social');
});

// ── 5. AAVE refusal ───────────────────────────────────────────
test('Refusal: US fashion brand requests AAVE without Black-audience context → refusal required', () => {
  const r = resolveDialect({
    country: 'US',
    audience_segment: 'general fashion millennials',
    platform: 'instagram_caption',
    brand_tone: 'playful',
    dialect_id_requested: 'aave_english',
    brand_owned_by: 'general LP fund',
  });
  assert.equal(r.refusal_required, true);
  assert.match(r.refusal_reason, /AAVE/);
  assert.match(r.refusal_reason, /cultural appropriation/i);
  const frag = compileDialectFragment(r);
  assert.match(frag, /REFUSAL REQUIRED/);
  assert.match(frag, /AAVE/);
});

// ── 6. AAVE allowed with Black-audience context ──────────────
test('AAVE allowed: brand explicitly targets Black audience and requests AAVE → no refusal', () => {
  const r = resolveDialect({
    country: 'US',
    audience_segment: 'Black women 25-40, beauty/haircare',
    platform: 'instagram_caption',
    brand_tone: 'playful',
    dialect_id_requested: 'aave_english',
    brand_owned_by: 'Black-owned beauty brand',
  });
  assert.notEqual(r.refusal_required, true);
  assert.equal(r.dialect_id, 'aave_english');
});

// ── 7. Pan-Arab campaign → MSA ───────────────────────────────
test('Pan-Arab campaign → MSA pack', () => {
  const r = resolveDialect({
    country: 'AE',
    audience_segment: 'pan-Arab corporate audience across GCC and Levant',
    platform: 'press_release',
    brand_tone: 'professional',
  });
  assert.equal(r.dialect_id, 'modern_standard_arabic');
});

// ── 8. US-Latino → Spanglish via Mexican Spanish pack ────────
test('US brand for Latino millennials → Mexican Spanish pack with Spanglish', () => {
  const r = resolveDialect({
    country: 'US',
    audience_segment: 'Latino millennials, Spanglish-speaking',
    platform: 'tiktok_script',
    brand_tone: 'playful',
  });
  assert.equal(r.dialect_id, 'mexican_spanish');
});

// ── 9. Fallback: unknown country → American English ──────────
test('Fallback: no country provided → American English with fallback flag set', () => {
  const r = resolveDialect({
    audience_segment: 'general consumers',
    platform: 'instagram_caption',
  });
  assert.equal(r.dialect_id, 'american_english');
  assert.equal(r.fallback_used, true);
});

// ── 10. Forbidden-terms surface in fragment ──────────────────
test('Egyptian pack do_not_use terms surface in compiled fragment', () => {
  const r = resolveDialect({
    country: 'EG',
    audience_age: 'gen_z',
    platform: 'instagram_caption',
  });
  const frag = compileDialectFragment(r);
  assert.match(frag, /Khaleeji-specific vocabulary/i,
    'Egyptian fragment should warn against Khaleeji vocab');
  assert.match(frag, /Levantine markers/i,
    'Egyptian fragment should warn against Levantine markers');
});

// ── 11. Native-feel test prompt is present ───────────────────
test('Compiled fragment includes the mandatory native-feel test', () => {
  const r = resolveDialect({
    country: 'EG',
    audience_age: 'gen_z',
    platform: 'instagram_caption',
  });
  const frag = compileDialectFragment(r);
  assert.match(frag, /NATIVE-FEEL TEST/);
  assert.match(frag, /personal account/);
});

// ── End-to-end wiring tests ──────────────────────────────────

test('Wiring: Egyptian context_summary → extract → resolve → Egyptian pack', () => {
  const session = {
    context_summary: 'Brand: Cairo-based fashion startup. Target audience: Egyptian women 22-28, Gen Z, Instagram-first. Tone: playful and youthful.',
  };
  const ctx = extractDialectContext(session, MODE_PLATFORM_HINTS.mode3);
  assert.equal(ctx.country, 'EG');
  assert.equal(ctx.audience_age, 'gen_z');
  assert.equal(ctx.brand_tone, 'playful');
  const r = resolveDialect(ctx);
  assert.equal(r.dialect_id, 'egyptian_arabic');
  assert.equal(r.register_level, 'casual_social');
});

test('Wiring: Saudi B2B context_summary → Khaleeji + professional', () => {
  const session = {
    context_summary: 'Brand: Riyadh SaaS for enterprise CMOs. Audience: B2B decision-makers, professional. Channel: LinkedIn.',
  };
  const ctx = extractDialectContext(session, MODE_PLATFORM_HINTS.mode2_default);
  assert.equal(ctx.country, 'SA');
  assert.equal(ctx.brand_tone, 'professional');
  const r = resolveDialect(ctx);
  assert.equal(r.dialect_id, 'khaleeji_arabic');
});

test('Wiring: empty context_summary → safe fallback', () => {
  const ctx = extractDialectContext({ context_summary: '' }, MODE_PLATFORM_HINTS.mode3);
  assert.equal(ctx.country, null);
  const r = resolveDialect(ctx);
  // No country → falls back to American English with fallback_used flag
  assert.equal(r.dialect_id, 'american_english');
  assert.equal(r.fallback_used, true);
});

// ── 12. Register-conflict: corporate_formal excludes gen_z slang ─
test('Corporate formal register excludes gen_z_internet_slang from active lexicon', () => {
  const r = resolveDialect({
    country: 'US',
    audience_age: 'boomer',
    platform: 'press_release',
    brand_tone: 'professional',
  });
  assert.equal(r.register_level, 'corporate_formal');
  const frag = compileDialectFragment(r);
  // gen_z slang category should not appear in the active LEXICON list
  // (it may appear in forbidden-terms but with a register-mismatch tag)
  assert.doesNotMatch(frag, /^\s*•\s*gen_z_internet_slang:/m);
});
