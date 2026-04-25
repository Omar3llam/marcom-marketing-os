// ============================================================
// MARCOM — Dialect Context Extractor
// Parses session.context_summary (free-text) into the structured
// input that dialectResolver.js expects. Best-effort regex parsing
// with explicit-override hooks.
// ============================================================
//
// Why this lives here, not in the resolver:
//   • The resolver takes a clean, typed context object.
//   • Sessions store context_summary as free text from Mode 1.
//   • This module bridges the two without making the resolver
//     responsible for parsing free-form English.
// ============================================================

// ── Country detection ───────────────────────────────────────
// Maps free-text country names → ISO-2 codes. Order matters:
// longer phrases first to avoid premature matches.
const COUNTRY_PATTERNS = [
  // GCC
  [/saudi arabia|kingdom of saudi|ksa\b|riyadh|jeddah|mecca|medina|dammam/i, 'SA'],
  [/united arab emirates|\buae\b|emirates|dubai|abu dhabi|sharjah/i, 'AE'],
  [/\bkuwait\b|kuwait city/i,                         'KW'],
  [/\bqatar\b|doha/i,                                 'QA'],
  [/\bbahrain\b/i,                                    'BH'],
  [/\boman\b/i,                                       'OM'],
  // Levant
  [/\blebanon\b|beirut/i,                             'LB'],
  [/\bsyria\b|damascus/i,                             'SY'],
  [/\bjordan\b|amman/i,                               'JO'],
  [/\bpalestine\b|ramallah|gaza/i,                    'PS'],
  // Maghreb
  [/\bmorocco\b|casablanca|rabat/i,                   'MA'],
  [/\balgeria\b|algiers/i,                            'DZ'],
  [/\btunisia\b|tunis/i,                              'TN'],
  // Egypt + Iraq
  [/\begypt\b|cairo|alexandria|damanhur|mansoura|tanta/i, 'EG'],
  [/\biraq\b|baghdad/i,                               'IQ'],
  // Anglosphere
  [/\bunited states\b|\busa\b|\bu\.s\.\b|\bamerica\b/i, 'US'],
  [/\bunited kingdom\b|\buk\b|\bbritain\b|\bengland\b|london/i, 'GB'],
  [/\baustralia\b|sydney|melbourne/i,                 'AU'],
  [/\bindia\b|mumbai|delhi|bangalore/i,               'IN'],
  [/\bsingapore\b/i,                                  'SG'],
  [/\bpakistan\b|karachi|lahore|islamabad/i,          'PK'],
  // LATAM + Iberia
  [/\bmexico\b|cdmx|monterrey|guadalajara/i,          'MX'],
  [/\bargentina\b|buenos aires/i,                     'AR'],
  [/\bspain\b|madrid|barcelona/i,                     'ES'],
  [/\bcolombia\b|bogot|medell|cali/i,                 'CO'],
  [/\bpuerto rico\b|san juan/i,                       'PR'],
  [/dominican republic|santo domingo/i,               'DO'],
  [/\bcuba\b|havana/i,                                'CU'],
  // Lusophone
  [/\bbrazil\b|brasil|s[aã]o paulo|rio de janeiro/i,  'BR'],
  [/\bportugal\b|lisbon|porto/i,                      'PT'],
  // Europe + others
  [/\bfrance\b|paris/i,                               'FR'],
  [/\bquebec\b|qu[ée]bec|montr[ée]al/i,               'CA'],
  [/\bgermany\b|berlin|munich|hamburg/i,              'DE'],
  [/\bturkey\b|istanbul|ankara/i,                     'TR'],
  [/\bindonesia\b|jakarta/i,                          'ID'],
  [/\bphilippines\b|manila/i,                         'PH'],
];

// ── City detection (lightweight — only the ones we map regionally)
const CITY_KEYWORDS = [
  'cairo','alexandria','damanhur','mansoura','tanta','asyut','aswan',
  'riyadh','jeddah','dubai','abu dhabi','kuwait city','doha','manama',
  'beirut','damascus','amman','baghdad',
  'casablanca','rabat','algiers','tunis',
  'london','manchester','sydney','melbourne',
  'mumbai','delhi','bangalore','chennai','hyderabad',
  'cdmx','mexico city','monterrey','guadalajara',
  'buenos aires','madrid','barcelona','bogota','medellin',
  'sao paulo','rio de janeiro','lisbon','porto',
  'paris','montreal','quebec city','berlin','munich','istanbul','ankara',
  'jakarta','manila','singapore','karachi','lahore',
];

// ── Audience age detection
const AGE_PATTERNS = [
  [/\bgen[\s-]?z\b|18[-–]2[5-9]|19[-–]?2[0-9]|under 25/i, 'gen_z'],
  [/\bmillennial|25[-–]39|26[-–]40|30[-–]39/i,          'millennial'],
  [/\bgen[\s-]?x\b|40[-–]55|45[-–]60/i,                  'gen_x'],
  [/\bboomer\b|60\+|55\+|elderly|senior/i,               'boomer'],
  [/\bb2b\b|cmo|director|executive|enterprise/i,         'gen_x'], // B2B decision-makers skew gen_x
];

// ── Brand tone detection
const TONE_PATTERNS = [
  [/playful|fun|witty|cheeky|youthful/i,                  'playful'],
  [/professional|corporate|b2b|enterprise|formal/i,       'professional'],
  [/luxury|premium|heritage|sophisticated|elegant/i,      'luxury'],
  [/edgy|bold|disruptive|provocative/i,                   'edgy'],
];

// ── Mode → default platform hint ────────────────────────────
export const MODE_PLATFORM_HINTS = {
  // Mode 2 (tools) — varies by tool; default to neutral
  mode2_default:        'instagram_caption',
  mode2_tool_3:         'instagram_caption',     // social media strategy
  mode2_tool_11:        'b2c_email',             // email marketing
  mode2_tool_13:        'landing_page_hero',     // brand positioning
  mode2_tool_14:        'press_release',         // crisis comms
  // Mode 3 — social calendar (mixed platforms; instagram is most common anchor)
  mode3:                'instagram_caption',
  // Mode 4 — content interrogation; platform inferred from user message but defaults safe
  mode4:                'instagram_caption',
  // Mode 5 — campaign analysis; output is decisional/strategic, not consumer-facing
  mode5:                'b2b_email',
};

// ── Main extractor ──────────────────────────────────────────
/**
 * Build a dialect-resolver context object from a session.
 * @param {Object} session         — session row (must include context_summary)
 * @param {string} platformHint    — one of the keys in MODE_PLATFORM_HINTS values
 * @param {Object} overrides       — explicit overrides (highest priority)
 * @returns {Object} context for resolveDialect()
 */
export function extractDialectContext(session, platformHint, overrides = {}) {
  const summary = (session?.context_summary || '').toString();

  // Country
  let country = null;
  for (const [pattern, code] of COUNTRY_PATTERNS) {
    if (pattern.test(summary)) { country = code; break; }
  }

  // City — first match
  let city = null;
  const lowered = summary.toLowerCase();
  for (const c of CITY_KEYWORDS) {
    if (lowered.includes(c)) { city = c; break; }
  }

  // Audience age — first strong match
  let audience_age = 'mixed';
  for (const [pattern, label] of AGE_PATTERNS) {
    if (pattern.test(summary)) { audience_age = label; break; }
  }

  // Brand tone
  let brand_tone = 'neutral';
  for (const [pattern, label] of TONE_PATTERNS) {
    if (pattern.test(summary)) { brand_tone = label; break; }
  }

  // Audience segment — pull a short slice that mentions audience-related keywords
  let audience_segment = '';
  const audMatch = summary.match(
    /(target audience|audience|customers?|buyers?|users?|icp)[^.]*\./i
  );
  if (audMatch) audience_segment = audMatch[0].slice(0, 240);

  return {
    country:          overrides.country          ?? country,
    city:             overrides.city             ?? city,
    audience_age:     overrides.audience_age     ?? audience_age,
    audience_segment: overrides.audience_segment ?? audience_segment,
    platform:         overrides.platform         ?? platformHint,
    brand_tone:       overrides.brand_tone       ?? brand_tone,
    target_dialect:   overrides.target_dialect   ?? null,
    dialect_id_requested: overrides.dialect_id_requested ?? null,
    brand_owned_by:   overrides.brand_owned_by   ?? null,
  };
}
