# Lumi Dialect Packs

Operational data, not encyclopedia content. These packs are what Lumi reads to keep marketing copy native, register-accurate, and culturally safe — so they need to be written by people who actually speak the dialect, not researched from Wikipedia.

## What's here

Each `<dialect_id>.json` is a self-contained operating manual for one dialect or register. The schema is documented below. The full reference implementation is `egyptian_arabic.json` — when in doubt, match its depth and structure.

## Schema

```jsonc
{
  "dialect_id":    "string — snake_case unique id (e.g. 'egyptian_arabic')",
  "display_name":  "Human-friendly name shown in prompts",
  "region":        ["ISO-2 country codes or 'pan-regional'"],
  "iso_base":      "ISO-639 base language code ('ar', 'en', 'es', ...)",
  "sub_dialects":  { "name": { "notes": "..." }},  // optional

  "register_levels": {
    "street":             { "description": "...", "use_when": [], "avoid_when": [] },
    "casual_social":      { ... },
    "professional_casual":{ ... },
    "corporate_formal":   { ... }
  },

  "lexicon": {
    "greetings":            ["..."],
    "agreement":            ["..."],
    "disagreement":         ["..."],
    "excitement":           ["..."],
    "frustration":          ["..."],
    "emphasis_intensifiers":["..."],
    "filler_words":         ["..."],
    "gen_z_internet_slang": ["..."],
    "millennial_slang":     ["..."],
    "loanwords_english":    ["..."],
    "loanwords_french":     ["..."],
    "religious_phatic":     ["..."]
  },

  "grammar_quirks": ["..."],

  "code_switching_patterns": {
    "english_in_arabic":   "...",
    "french_in_arabic":    "...",
    "rules":               ["..."]
  },

  "platform_register_map": {
    "instagram_caption":   "casual_social",
    "tiktok_script":       "street | casual_social",
    "linkedin_post":       "professional_casual",
    "b2b_email":           "corporate_formal",
    "whatsapp_dm":         "casual_social | street"
  },

  "do_not_use": ["specific terms or patterns to avoid, with reasons"],

  "tone_signals": {
    "<region_or_demographic>": ["voice markers — short, observable signals"]
  },

  "example_translations": [
    {
      "english":                       "...",
      "wrong_msa":                     "...",
      "wrong_translated_feel":         "...",
      "correct_<dialect>_casual":      "...",
      "correct_<dialect>_genz":        "...",
      "note":                          "Why the correct version works."
    }
  ],

  "freshness_notes": {
    "fresh_terms_2024_2026": ["..."],
    "fading_terms":          ["..."],
    "dead_terms":            ["..."]
  },

  "compiled_for":              "Lumi v2.0 — MARCOM AI",
  "last_reviewed":             "YYYY-MM-DD",
  "review_required_by_native": true
}
```

## How to add a new dialect pack

1. **Find a native speaker contributor.** Non-negotiable. Every pack must be authored or reviewed by someone who actually speaks the dialect natively. Researchers reading Wikipedia produce stereotypes, not operational data.
2. **Copy the schema** from `egyptian_arabic.json` (the reference implementation).
3. **Fill the lexicon with REAL terms in current use.** A term is current if a 26-year-old native would post it on their personal account today. If it's only used by 50+ speakers or in textbooks, mark it in `dead_terms` or `fading_terms`.
4. **Be specific in `do_not_use`.** Don't write "avoid bad slang" — write "تحفة overused by every brand since ~2012, signals lazy copywriting."
5. **Write at least 4 `example_translations`** with the wrong-translated-feel version included. The contrast is what teaches the model.
6. **Set `review_required_by_native: true`** until a second native speaker reviews and confirms.
7. **For `aave_english` and any culturally-sensitive dialect**, also set `review_required_by_cultural_consultant: true`.

## Contributor checklist (MUST be ticked before merge)

- [ ] Author is a native speaker of this dialect (state region/city in PR description)
- [ ] Reviewer is a second native speaker (state region/city in PR description)
- [ ] Every lexicon entry has been used by the author or reviewer in the last 6 months
- [ ] Every `do_not_use` entry has a reason
- [ ] At least 4 `example_translations` with realistic English source sentences
- [ ] `freshness_notes` reflect 2024-2026 reality, not 2018 reality
- [ ] No stereotypes ("samba/caipirinha", "habibi/yalla", "ándale/arriba") — voice, not caricature
- [ ] No phonetic respelling for comedic effect (Saidi accent, AAVE phonology, etc.)
- [ ] Religious / cultural / ethnic-specific terms cleared with the cultural consultant
- [ ] `last_reviewed` date set to PR-merge date
- [ ] `review_required_by_native` toggled to `false` only after second-reviewer sign-off

## Files in this directory

| Status | Pack | Notes |
| --- | --- | --- |
| ✅ Full | `egyptian_arabic.json` | Reference implementation |
| 🟡 Skeleton | `modern_standard_arabic.json` | |
| 🟡 Skeleton | `khaleeji_arabic.json` | Sub-dialects: Saudi / UAE / Kuwaiti / Qatari / Bahraini / Omani |
| 🟡 Skeleton | `levantine_arabic.json` | Sub-dialects: Lebanese / Syrian / Jordanian / Palestinian |
| 🟡 Skeleton | `maghrebi_arabic.json` | Sub-dialects: Moroccan Darija / Algerian / Tunisian |
| 🟡 Skeleton | `iraqi_arabic.json` | |
| 🟡 Skeleton | `american_english.json` | |
| 🟡 Skeleton | `aave_english.json` | Safety-critical — see Core Law 3 |
| 🟡 Skeleton | `genz_internet_english.json` | Half-life ~6-18 months — refresh quarterly |
| 🟡 Skeleton | `british_english.json` | Includes UK Gen Z / MLE |
| 🟡 Skeleton | `australian_english.json` | |
| 🟡 Skeleton | `indian_english.json` | Includes Hinglish |
| 🟡 Skeleton | `singlish.json` | |
| 🟡 Skeleton | `mexican_spanish.json` | Doubles as Spanglish base for US-Latino |
| 🟡 Skeleton | `argentinian_spanish.json` | Voseo-based Rioplatense |
| 🟡 Skeleton | `castilian_spanish.json` | |
| 🟡 Skeleton | `caribbean_spanish.json` | Sub-dialects: PR / DR / Cuban |
| 🟡 Skeleton | `colombian_spanish.json` | Sub-dialects: Paisa / Rolo / Costeño |
| 🟡 Skeleton | `french_france.json` | Includes Verlan |
| 🟡 Skeleton | `quebecois_french.json` | |
| 🟡 Skeleton | `brazilian_portuguese.json` | |
| 🟡 Skeleton | `european_portuguese.json` | |
| 🟡 Skeleton | `german.json` | Includes Kiezdeutsch |
| 🟡 Skeleton | `turkish.json` | |
| 🟡 Skeleton | `hindi_urdu.json` | Includes Hinglish/Urdlish |
| 🟡 Skeleton | `indonesian.json` | Includes bahasa gaul |
| 🟡 Skeleton | `tagalog.json` | Includes Taglish |

🟡 Skeleton = schema is complete but lexicon needs native-speaker expansion to ~100+ entries.

## Loaded by

- `src/services/dialectResolver.js` — context → pack + register selection
- `src/prompts/dialectInjector.js` — pack + register → strict prompt fragment
- `src/prompts/lumi-system.js` — Core Law 3 (Linguistic Authenticity) is the constitutional binding
