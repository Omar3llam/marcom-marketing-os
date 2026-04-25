// ============================================================
// MARCOM — Dialect Prompt Injector
// Compiles a resolved dialect pack into a strict prompt fragment
// that gets prepended to LUMI_SYSTEM_PROMPT at runtime.
// ============================================================
//
// Usage:
//   import { resolveDialect } from '../services/dialectResolver.js';
//   import { compileDialectFragment } from './dialectInjector.js';
//   const resolved = resolveDialect(ctx);
//   const fragment = compileDialectFragment(resolved);
//   const finalSystemPrompt = LUMI_SYSTEM_PROMPT + '\n' + fragment + '\n' + modeSpecificPrompt;
// ============================================================

// Curate lexicon by register — we don't dump every term every time,
// because that confuses the model and overfits to register-mismatched slang.
function curateLexicon(pack, registerLevel) {
  const lex = pack.lexicon || {};
  const include = {};

  // Always-on categories
  include.greetings              = lex.greetings || [];
  include.agreement              = lex.agreement || [];
  include.disagreement           = lex.disagreement || [];
  include.emphasis_intensifiers  = lex.emphasis_intensifiers || [];
  include.filler_words           = lex.filler_words || [];
  include.loanwords_english      = lex.loanwords_english || [];

  // Register-gated categories
  if (['street', 'casual_social'].includes(registerLevel)) {
    include.excitement          = lex.excitement || [];
    include.frustration         = lex.frustration || [];
    include.gen_z_internet_slang= lex.gen_z_internet_slang || [];
    include.millennial_slang    = lex.millennial_slang || [];
  } else if (registerLevel === 'professional_casual') {
    include.excitement          = (lex.excitement || []).slice(0, 6);
    include.millennial_slang    = (lex.millennial_slang || []).slice(0, 4);
  }
  // corporate_formal: no slang categories at all

  // Religious/phatic only when register allows (and brand-fit is the model's call)
  if (lex.religious_phatic && registerLevel !== 'street') {
    include.religious_phatic = lex.religious_phatic;
  }

  // French loanwords for Arabic/French-influenced dialects
  if (lex.loanwords_french) include.loanwords_french = lex.loanwords_french;

  return include;
}

// Curate example translations for the active register
function curateExamples(pack, registerLevel) {
  const all = pack.example_translations || [];
  if (!all.length) return [];
  // Keep up to 4 — model gets the pattern from a few well-chosen examples
  return all.slice(0, 4);
}

function lexiconBlock(curated) {
  const lines = [];
  for (const [cat, items] of Object.entries(curated)) {
    if (!items || !items.length) continue;
    lines.push(`  • ${cat}: ${items.slice(0, 12).join(' / ')}`);
  }
  return lines.join('\n');
}

function examplesBlock(examples) {
  if (!examples.length) return '';
  return examples.map((ex, i) => {
    const lines = [`  Example ${i + 1}:`];
    if (ex.english)                     lines.push(`    EN: ${ex.english}`);
    if (ex.wrong_msa)                   lines.push(`    ✗ MSA-stiff: ${ex.wrong_msa}`);
    if (ex.wrong_translated_feel)       lines.push(`    ✗ Translated-feel: ${ex.wrong_translated_feel}`);
    if (ex.correct_egyptian_casual)     lines.push(`    ✓ Casual native: ${ex.correct_egyptian_casual}`);
    if (ex.correct_egyptian_genz)       lines.push(`    ✓ Gen Z native: ${ex.correct_egyptian_genz}`);
    if (ex.correct_native_casual)       lines.push(`    ✓ Casual native: ${ex.correct_native_casual}`);
    if (ex.correct_native_genz)         lines.push(`    ✓ Gen Z native: ${ex.correct_native_genz}`);
    if (ex.note)                        lines.push(`    Note: ${ex.note}`);
    return lines.join('\n');
  }).join('\n\n');
}

// ── Main compiler ────────────────────────────────────────────
export function compileDialectFragment(resolved) {
  // Refusal path — short, clear, hands the user a usable alternative
  if (resolved.refusal_required) {
    return `### DIALECT POLICY — REFUSAL REQUIRED
${resolved.refusal_reason}

Respond to the user briefly explaining why you cannot produce that copy in that dialect, then offer the alternative path. Do not produce the requested copy.`;
  }

  if (!resolved.dialect_pack) {
    return `### DIALECT LOCK FOR THIS SESSION
No dialect pack resolved. Default to neutral, market-agnostic English. Avoid slang or culturally-specific phrasing.`;
  }

  const pack             = resolved.dialect_pack;
  const registerLevel    = resolved.register_level;
  const curated          = curateLexicon(pack, registerLevel);
  const examples         = curateExamples(pack, registerLevel);
  const grammar          = (pack.grammar_quirks || []).slice(0, 8);
  const csPolicy         = resolved.code_switch_policy || {};
  const csPatterns       = csPolicy.patterns || {};
  const forbidden        = resolved.forbidden_terms || [];

  // City/regional tone hint — prefers the most populous variant if no city given
  const toneSignals = pack.tone_signals || {};
  const toneKey     = Object.keys(toneSignals)[0] || null;
  const toneHint    = toneKey ? `${toneKey}: ${(toneSignals[toneKey] || []).slice(0, 6).join(', ')}` : '';

  // Native-feel test prompt — anchored to a city if we have one
  const cityRef = (pack.region && pack.region[0]) || 'native';
  const nativeTestAge = registerLevel === 'corporate_formal' ? '38' : '26';

  return `### DIALECT LOCK FOR THIS SESSION
You are writing for: ${pack.display_name}  |  Register: ${registerLevel}
Region(s): ${(pack.region || []).join(', ')}  |  ISO base: ${pack.iso_base}
${resolved.fallback_used ? `(Fallback in use: ${resolved.fallback_reason})\n` : ''}
LEXICON YOU MAY USE (register-curated):
${lexiconBlock(curated) || '  • (no lexicon available — use neutral phrasing)'}

GRAMMAR & SYNTAX RULES:
${grammar.length ? grammar.map(g => `  • ${g}`).join('\n') : '  • (use standard grammar of the target language)'}

CODE-SWITCHING POLICY: ${csPolicy.intensity || 'none'}
${csPatterns.english_in_arabic ? `  • EN-in-AR: ${csPatterns.english_in_arabic}` : ''}
${csPatterns.english_in_spanish ? `  • EN-in-ES (Spanglish): ${csPatterns.english_in_spanish}` : ''}
${csPatterns.french_in_arabic ? `  • FR-in-AR: ${csPatterns.french_in_arabic}` : ''}
${(csPolicy.rules || []).map(r => `  • ${r}`).join('\n')}

REGIONAL TONE HINT: ${toneHint || '(none specified)'}

LEXICON / PATTERNS YOU MUST AVOID:
${forbidden.length ? forbidden.map(f => `  ✗ ${f}`).join('\n') : '  ✗ (none specified beyond global Lumi rules)'}

EXAMPLE TRANSLATIONS (study the pattern, don't copy verbatim):
${examplesBlock(examples) || '  (none provided)'}

NATIVE-FEEL TEST (mandatory before sending any copy):
Ask yourself: "Would a ${nativeTestAge}-year-old ${cityRef} native post this on their personal account today?"
If the answer is "no" — or if it sounds translated, dated, or like a foreigner wrote it — rewrite it before responding.

REGISTER-SWITCHING RULES:
  • Never mix dialects of the same language family unless the brand explicitly serves a pan-regional audience.
  • If the brand serves multiple regions, produce SEPARATE versions per market — never a hybrid.
  • Slang older than ~3 years should be flagged as "verify freshness" before use.
  • If the user asks for content in a register that conflicts with brand_tone, surface the conflict before producing.
`;
}

// Convenience: prepend the fragment to a base prompt
export function injectDialect(basePrompt, resolved) {
  const fragment = compileDialectFragment(resolved);
  return `${basePrompt}\n\n${fragment}`;
}
