# PHASE 2 TOKEN AUDIT — LUMI Design Tokens

```text
Date     2026-09-14
Base     16207f6 (docs/lumi-governance-lock) · nothing committed, nothing pushed
Scope    design-token architecture + token implementation only
```

Every count below is read from a repository artefact:

- token counts from `client/design-system/foundation/generated/tokens.resolved.json`;
- migration counts from the rows of `LEGACY_TOKEN_MIGRATION.md`;
- test counts from vitest output.

Each counting instrument was checked against a control before its number was used
(Validation, V-0).

---

## Scope

**Built**

1. **One current token authority:** `client/design-system/foundation/tokens/`, in
   four layer files.
2. **A dependency-free resolver and rule checker** (`resolve.js`) and a build
   (`build.js`). The build emits `generated/tokens.css`, the `--lumi-*` custom
   properties, and `generated/tokens.resolved.json`, the resolved manifest. It
   refuses to write while any rule is broken.
3. **A 56-test validation contract** (`tokens.test.js`). It includes falsification
   tests proving each rule checker can reject a bad token set.
4. **A migration map** of every legacy token entry (`LEGACY_TOKEN_MIGRATION.md`).
5. **Wiring:** one `@import` of the generated CSS at the top of
   `client/src/index.css`, plus two npm scripts (`tokens:build`, `tokens:check`).
6. **Legacy classification in place.** The headers of the four legacy token JSON
   files, `tailwind.config.js`, the legacy `:root` section of `index.css` and the
   lint rule now state they are legacy. No legacy value changed.
7. **Documentation:** `DESIGN_TOKEN_ARCHITECTURE.md` rewritten from proposal to
   implemented architecture, keeping its section numbers so governance references
   still resolve.

**Not built:** no component, page, route, layout, app shell, navigation, API,
backend, Prisma, product logic, Tailwind utility, animation or theme switch.

## Token Layers

| Layer | File | Rule | 📏 Tokens |
|---|---|---|---|
| BRAND | `tokens/brand.json` | literal identity values; references nothing; not emitted | 7 |
| PRIMITIVE | `tokens/primitive.json` | literal, or derived from brand neutrals / brand fonts; never brand gold; verdict primitives literal; not emitted | 86 |
| SEMANTIC | `tokens/semantic.json` | primitives only, plus the single declared `color.signal.attention → brand.color.gold`; emitted as `--lumi-*` | 133 |
| COMPONENT | `tokens/component.json` | semantic only; reserved and empty until Phase 3 | 0 |
| **Total** | | | **226** |

## Implemented Tokens

📏 **Semantic tokens by namespace** (133):

| Namespace | Tokens | Contents |
|---|---|---|
| `color.surface` | 3 | base · raised · elevated |
| `color.text` | 3 | claim · body · meta |
| `color.border` | 3 | divider · subtle · strong |
| `color.signal` | 1 | attention |
| `color.interaction` | 8 | hover.surface · pressed.surface · selected.{surface, indicator} · active.indicator · focus.ring · disabled.{foreground, border} |
| `color.verdict` | 6 | `<verdict>.mark` × 6 |
| `color.state` | 17 | 16 × `<state>.foreground` + `failed.border` |
| `type` | 52 | 10 roles × 5 properties + `numeric` on the 2 metric roles |
| `space` | 5 | inline · meta · object · section · macro |
| `size` | 6 | target.{minimum, touch} · icon.{inline, standalone} · focus.{width, offset} |
| `border` | 1 | width.hairline |
| `radius` | 4 | structural · control · container · round |
| `shadow` | 1 | overlay |
| `motion` | 8 | duration.{feedback, reveal, transition, maximum} · easing.{reveal, transition, feedback} · distance.settle |
| `layer` | 6 | base · sticky · navigation · overlay · modal · announcement |
| `layout` | 9 | width × 3 · gutter × 3 · breakpoint × 3 (🧪 provisional, not emitted) |

📏 **Primitive tokens by namespace** (86):

| Namespace | Tokens |
|---|---|
| verdict colours | 6 |
| `color.light` | 11 |
| `color.shade` | 10 |
| `color.warm` | 1 |
| `color.shadow` | 1 |
| `font.stack` | 3 |
| `fontSize` | 6 |
| `lineHeight` | 6 |
| `fontWeight` | 3 |
| `letterSpacing` | 3 |
| `numeric` | 1 |
| `space` | 6 |
| `size` | 7 |
| `borderWidth` | 2 |
| `radius` | 4 |
| `duration` | 5 |
| `easing` | 3 |
| `motionDistance` | 2 |
| `zIndex` | 6 |

📏 **Emitted CSS**

- 130 custom properties: 133 semantic tokens minus 3 provisional breakpoints.
- 41 are colour roles declared per environment. 89 are invariant tokens on `:root`,
  of which 5 carry reduced-motion values.
- Environments: `[data-lumi-env="product"]`, `[data-lumi-env="marketing"]` and
  `[data-lumi-env="marketing-dark-section"]`.
- `generated/tokens.css` is 8,930 bytes in source. It adds 7,758 bytes to the
  minified app stylesheet.

📏 **State registry:** 17 states (the locked vocabulary). Full table in
DESIGN_TOKEN_ARCHITECTURE.md §4.3.

## Legacy Migration

**Legacy systems and their status**

| Legacy system | Status now | What changed in Phase 2 |
|---|---|---|
| `client/design-system/tokens/colors.json` | LEGACY; Tailwind still reads it for the existing UI | `_comment`, `_warning` rewritten; `_authority` added; values identical (V-15) |
| `client/design-system/tokens/typography.json` | LEGACY; read by no build (documentation of `index.css` roles) | `_comment` rewritten; `_authority` added; values identical |
| `client/design-system/tokens/spacing.json` | LEGACY; Tailwind reads `borderRadius` and `shadows` | as above |
| `client/design-system/tokens/motion.json` | LEGACY; Tailwind reads `animations` and `keyframes` | as above |
| `client/tailwind.config.js` | LEGACY wiring | header comment only |
| `client/src/index.css` `:root` (118 vars), `[data-theme="dark"]` (3), role and utility classes | LEGACY | a section comment added; no variable or rule changed |
| `client/src/pages/demo/Operations/Operations.module.css` (27 vars) | LEGACY local copies | untouched |
| `client/design-system/lint/no-generic-tailwind.js` | RETAIN (mechanism) | one stale "Design Bible" comment corrected; no rule changed |
| `client/scripts/checkTokenResolution.js` | RETAIN (mechanism) | untouched |
| `design-system-figma/marcom-ai/project/client/design-system/tokens/colors.json` | RETAIN (historical copy, read by no build) | untouched |

📏 **Migration map:** `client/design-system/foundation/LEGACY_TOKEN_MIGRATION.md`

**What each count means** — all four measured from the repository in the Phase 2
closure patch. The extractor is controlled: it finds `signal.kill` and `--c-kill`
and does not find an invented key.

| Count | Meaning | How it was measured |
|---|---|---|
| **341** | **Total status rows** in the map, across all nine sections A–I | every table row carrying MIGRATE / REPLACE / RETAIN / DEPRECATE / UNKNOWN |
| **289** | **Source-qualified legacy token entries**: rows for sections A–E and G, one per (source file, token name) | each source file's keys or custom properties, extracted from the file and compared with the section's rows: 0 missing, 0 extra, 0 duplicated within a section |
| **268** | **Distinct token identifier strings** among those 289 rows | 21 names are defined in two files: the `--c-*` variables in both `index.css` `:root` and `Operations.module.css` |
| **52** | **Non-token-entry rows** (341 − 289) | F: 34 (3 `[data-theme="dark"]` overrides + 31 rules and classes) · H: 13 (12 inline Tailwind values + 1 wiring row) · I: 5 (mechanisms, consumers, historical copy) |

**Not measured:** a count of unique tokens **by meaning**. Many entries restate one
value under different names (for example `surface.light`, `lumi.bg`,
`--color-surface-light` and `--c-surface-light`). Deduplicating them would be a
judgement, not a repository fact, so no such number is claimed.

Per-source coverage (source entries = rows):

| Section | Source | Entries |
|---|---|---|
| A | `colors.json` | 57 |
| B | `typography.json` | 21 |
| C | `spacing.json` | 24 |
| D | `motion.json` | 42 |
| E | `index.css` `:root` | 118 |
| G | `Operations.module.css` | 27 |
| | **total** | **289** |

| Status | Rows |
|---|---|
| MIGRATE | 78 |
| REPLACE | 99 |
| RETAIN | 6 |
| DEPRECATE | 110 |
| UNKNOWN | 48 |

**The 48 UNKNOWN rows, by the ruling each needs**

| Question needing a ruling | Rows | Legacy entries |
|---|---|---|
| What is the job of the legacy "elevated" surface (secondary panel or hover wash)? | 8 | `surface.elevated`, `lumi.elevated`, `--color-surface-elevated`, `--color-bg-tertiary`, `--c-surface-elevated`, `--c-lumi-elevated`, and `Operations.module.css` `--c-surface-elevated`, `--c-lumi-elevated` |
| Do creative lifecycle stages carry colour? | 10 | `stage.{dying, fatigued, testing, stable, scaling}`, `--color-stage-*` |
| Does trend direction carry colour? | 8 | `trend.{danger, warning, positive, neutral}`, `--c-trend-*` |
| Are there generic status tones at all? | 4 | `--color-status-{danger, warning, neutral, positive}` |
| How is published health expressed? | 2 | `radar.critical`, `radar.stable` |
| What published states do "verified" and "pending" mean? | 5 | `intel.verified`, `intel.pending`, `--color-intel-verified`, `--c-intel-verified`, `--c-intel-pending` |
| Which generic gold emphasis is a real attention signal? (per call site) | 3 | `lumi.accent`, `--color-lumi-accent`, `--c-lumi-accent` |
| Does a text-selection highlight role exist (never gold)? | 3 | `--selection-bg`, `--selection-text`, `::selection` rule |
| How is a form validation error expressed? (not in the locked state vocabulary) | 1 | `--color-border-danger` |
| What is the purpose of the horizontal slide motion? | 3 | `animations.slide-right`, `keyframes.slide-right`, `.anim-slide-right` |
| Is the rotating indicator an allowed PROCESSING indicator? | 1 | `@keyframes spin` |

None blocks Phase 3 primitives. Each blocks only the migration of the surfaces
that use it.

**Legacy finding (measured, not fixed).** `.anim-data-rise` in `index.css` animates
keyframe `data-rise`, which is defined in no stylesheet or token file under
`client/`. The class animates nothing today. It is DEPRECATE in the map.

## Accessibility

📏 **228 declared contrast checks, 0 failing.**

| Criterion | Minimum | Checks |
|---|---|---|
| WCAG 2.2 SC 1.4.3 text | 4.5 | 132 |
| SC 1.4.11 verdict marks and the attention signal | 3 | 42 |
| SC 1.4.11 focus ring, selected indicator, active indicator | 3 | 36 |
| SC 1.4.11 strong border, failed border | 3 | 12 |
| LUMI floor for inactive controls (WCAG exempts them) | 3 | 6 |

**📏 Tightest measured pairs**

| Pair | Ground | Ratio | Minimum |
|---|---|---|---|
| `color.verdict.kill.mark` on `color.interaction.pressed.surface` | Charcoal | 3.18 | 3 |
| `color.border.strong` / `color.state.failed.border` / `color.interaction.disabled.foreground` on `color.surface.raised` | Off White | 3.16 | 3 |
| the same three on `color.surface.elevated` | Charcoal | 3.46 | 3 |
| `color.text.meta` on `color.interaction.pressed.surface` | Off White | 5.31 | 4.5 |
| `color.text.meta` on `color.interaction.pressed.surface` | Charcoal | 5.39 | 4.5 |

**Known constraints and how the token roles address them.** No locked colour was
changed.

| Constraint (📏 Constitution Article 21) | How the roles address it |
|---|---|
| Gold on Off White 2.21 : 1 — not valid for text or marks | `color.signal.attention` and `color.verdict.reallocate.mark` resolve to `initial` in `marketing`; they exist only on Charcoal. |
| HOLD on Off White 2.95 : 1 | No verdict mark exists on Off White. Verdicts on marketing pages sit in `marketing-dark-section`. |
| KILL on Charcoal 4.02 : 1 — fails normal text | No verdict text token exists. Verdict words use `color.text.claim` (≥ 14 : 1). KILL is a mark only, ≥ 3.18 : 1 on every declared Charcoal surface. |
| No neutral reaches 4.5 : 1 on a KILL fill | No verdict fill or background token exists. |
| Verdict identity must not depend on colour; HOLD–REFRESH ΔE 5.1 (deutan) | Marks are the only verdict colour role, and the word is mandatory (CMP-09). Tokens cannot enforce adjacency, so this is a Phase 3 primitive obligation (DESIGN_TOKEN_ARCHITECTURE.md §15). |
| Focus must not rely on gold | `color.interaction.focus.ring` is the highest neutral step on both grounds, ≥ 14 : 1. Tested never to equal gold. |
| Verdict colours never become interaction colours | Tested: no interaction, border, text, surface or state value equals a verdict value or gold. |
| Charcoal surfaces must keep KILL ≥ 3 : 1 | Surface and interaction steps stop at `light.10`, where KILL measures 3.18. |

Also: `size.target.minimum` is 24px (SC 2.5.8); the focus ring is 2px with a 2px
offset; every type role is at least 12px; reduced motion lives in the motion
tokens themselves.

## Validation

**V-0 · instrument controls, run before any number was trusted**

| Instrument | Control | Result |
|---|---|---|
| contrast function | black/white 21.00; identical 1.00; Constitution KILL-on-Charcoal 4.02 | ✅ reproduced (tests) |
| duplicate-key scanner | detects `{"a":1,"a":2}`; no false positive on nesting or arrays | ✅ (tests) |
| rule checker | rejects REALLOCATE → brand gold, primitive → brand gold, a failing contrast pair, a missing reduced-motion value, an orphan primitive, a hue-named token, an unverified colour token | ✅ 6 mutation tests, 7 rejections, each observed |
| no-theme test | first run failed on the header comment naming `prefers-color-scheme` | ✅ proved it can fail; fixed by stripping comments before matching, not by rewording |
| name rule | first build rejected `color.state.success` and `type.metric.primary` | ✅ proved it fires; `success` excepted only as a locked state slot, `primary` renamed `headline` |
| compiled-CSS comparison | a one-byte tamper of the stripped output must report "not identical" | ✅ reported `false`. (A first tamper attempt did not apply; it was detected and re-run.) |
| legacy-value comparison | altering one colour must report "not identical" | ✅ reported `false` |
| migration-map coverage | per-section key extraction versus table first cells | ✅ 0 missing, 0 extra, 0 duplicated |

**The 21 required checks**

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Every active brand colour matches governance | ✅ | test `1 · brand colours` (4 values plus gold's means and not-means) |
| 2 | Every active verdict colour matches the locked ruling | ✅ | test `2 ·` — primitive and mark for all six; exactly six marks, no text, fill or glow token |
| 3 | Legacy verdict colours are not active | ✅ | test `3 ·` — `#EF4444 / #F59E0B / #10B981` absent from all resolved values, all four token source files and the generated CSS |
| 4 | Brand Gold and REALLOCATE remain separate tokens | ✅ | test `4 ·` — `color.verdict.reallocate.mark` references only `primitive.color.reallocate`, and its chain contains no `brand.*`; only `color.signal.attention` reaches brand gold |
| 5 | No gold focus, hover or selected token exists | ✅ | test `5 ·` — no interaction, border, text, surface or state token resolves to gold; exactly 4 tokens hold `#D4A017` |
| 6 | Verdict colours are not generic interaction tokens | ✅ | test `6 ·` — no non-verdict semantic token shares a verdict value (attention shares gold by FC-2 only) |
| 7 | Typography uses only Space Grotesk, Inter and JetBrains Mono | ✅ | test `7 ·` — every stack is one brand face plus platform generics; the generated CSS quotes exactly these three |
| 8 | State semantics remain distinct | ✅ | test `8 ·` — registry equals the 17 locked states; no shared tokens; light follows class on both grounds; no state is a verdict colour or gold |
| 9 | Dark/light context remains explicit | ✅ | test `9 ·` — three environments on two grounds; colour never on `:root`; only 7 roles absent on Off White |
| 10 | No theme switch is introduced | ✅ | test `10 ·` — no `prefers-color-scheme`, `data-theme`, `.dark` or `color-scheme` in the emitted rules; no "theme" key in token sources |
| 11 | No fabricated data exists | ✅ | test `11 ·` — no example, sample, demo, KPI, mock, placeholder or fake token; numbers exist only as `layer.*` and `primitive.zIndex` |
| 12 | No component behaviour changed | ✅ | no file under `client/src/components/` changed (`git diff --name-only`); compiled CSS identical apart from the added variables (V-16) |
| 13 | No backend behaviour changed | ✅ | no path under `src/`, `prisma/`, `packages/` changed; root `npm run check` ✅ (787 files); root `npm run lint` 0 errors (28 warnings, pre-existing; no backend file touched) |
| 14 | No routes changed | ✅ | `client/src/App.jsx`, `client/src/app/**` and `src/routes/**` untouched |
| 15 | No page implementation changed | ✅ | no file under `client/src/pages/` changed |
| 16 | No unnecessary dependencies added | ✅ | `client/package.json` diff is two `scripts` lines; no `dependencies` or `devDependencies` change; no lockfile change |
| 17 | There is one current token authority | ✅ | `client/design-system/foundation/tokens/`; every legacy source declares itself LEGACY (test `17 ·`); no legacy JSON still claims "Source of Truth" |
| 18 | Legacy token systems are clearly classified | ✅ | `LEGACY_TOKEN_MIGRATION.md`: 341 status rows in total; 289 of them are source-qualified token entries (268 distinct names), each source entry exactly once per source; 52 cover rules, classes, wiring and mechanisms (Legacy Migration) |
| 19 | Token naming is internally consistent | ✅ | build rules (camelCase segments, hue and status names, unique CSS variables) plus test `19 ·`; brand, primitive and provisional tokens never emitted |
| 20 | No unresolved accidental duplication | ✅ | test `20 ·` — the only equal colour values below semantic are the declared ones: the FC-2 gold/REALLOCATE pair, ladder endpoints equal to brand neutrals, `warm.100` = Warm Gray, and `light.80` = `shade.20` (a mathematical symmetry on different grounds). No duplicate keys; no orphan primitives. |
| 21 | Relevant lint, type and build checks | ✅ | see below |

**Commands run**

| Command | Result |
|---|---|
| `npm run tokens:build` (client) | ✅ 226 tokens · 130 CSS variables · 228 contrast checks, 0 failing |
| `npm run tokens:check` (client) | ✅ rules hold; generated output current |
| `npx vitest run design-system/foundation/tokens.test.js` | ✅ 56 passed |
| `npx vitest run` (full client suite) | ✅ 225 files, 2,990 tests passed |
| `npm run lint:ci` (client) | ✅ exit 0 |
| `npx vite build` (client) | ✅ built |
| `npm run check:tokens` (client; after build) | ✅ every colour class resolves (1,004 selectors) |
| `npm run check` (root) | ✅ 787 files syntax-valid, zero `@/` aliases |
| `npm run lint` (root, backend) | ✅ 0 errors; 28 warnings, pre-existing |

**V-16 · compiled CSS unchanged for the existing UI**

- Baseline build at `16207f6` before any change; after build with every Phase 2
  change applied.
- `index-CrJXiI_f.css` (2,941 B): byte-identical.
- Main stylesheet: 106,596 B → 114,354 B. Removing the four `--lumi-*` blocks
  (7,758 B) leaves output **identical** to the baseline. The tamper control
  reports a difference.

**V-15 · legacy token values unchanged**

- For each of `colors`, `typography`, `spacing` and `motion` `.json`, the parsed
  content without `_`-prefixed comment keys is identical between `HEAD` and the
  working tree. The control reports a difference.

**Not run, and why**

- `npm run test:fast` / `test:full` (backend): no backend file changed.
- The shell's Node was v24.15.0, not the pinned 24.20.x that the backend
  verification contract requires, so a backend claim from this shell would be
  invalid anyway.
- There is no type checker for these files: the client has no `tsc` script, and
  the new files are `.js` / `.json`.

## Files Changed

**Modified (9)**

| Path | Change |
|---|---|
| `DESIGN_TOKEN_ARCHITECTURE.md` | rewritten from proposal to implemented architecture; section numbers kept |
| `client/design-system/tokens/colors.json` | `_comment`, `_warning` rewritten; `_authority` added |
| `client/design-system/tokens/typography.json` | `_comment` rewritten; `_authority` added |
| `client/design-system/tokens/spacing.json` | `_comment` rewritten; `_authority` added |
| `client/design-system/tokens/motion.json` | `_comment` rewritten; `_authority` added |
| `client/tailwind.config.js` | header comment only |
| `client/src/index.css` | `@import` of the generated tokens (with a comment) + legacy section comment |
| `client/design-system/lint/no-generic-tailwind.js` | one stale comment line |
| `client/package.json` | scripts `tokens:build`, `tokens:check` |

**Created (11)**

| Path |
|---|
| `PHASE_2_TOKEN_AUDIT.md` |
| `client/design-system/foundation/tokens/brand.json` |
| `client/design-system/foundation/tokens/primitive.json` |
| `client/design-system/foundation/tokens/semantic.json` |
| `client/design-system/foundation/tokens/component.json` |
| `client/design-system/foundation/resolve.js` |
| `client/design-system/foundation/build.js` |
| `client/design-system/foundation/tokens.test.js` |
| `client/design-system/foundation/generated/tokens.css` |
| `client/design-system/foundation/generated/tokens.resolved.json` |
| `client/design-system/foundation/LEGACY_TOKEN_MIGRATION.md` |

## Files Intentionally Untouched

| Area | Paths |
|---|---|
| components | `client/src/components/**`, `client/src/design-system/**` (patterns, states, signals) |
| pages | `client/src/pages/**`, including `Operations.module.css` |
| routes and app shell | `client/src/App.jsx`, `client/src/app/**`, `client/src/main.jsx` (font loading unchanged) |
| API | `client/src/lib/api.js`, hooks, contexts |
| backend | `src/**`, `packages/**` |
| database | `prisma/**` |
| product logic | verdict, decision, state adapters (`absence.js`, `confidence.js`), FSM |
| governance | `design-governance/**`, `CLAUDE.md`, `LUMI_PRODUCT_TRUTH_RULINGS.md`, `GOVERNANCE_SYNC.md` in the implementation pass. The closure patch later corrected factual statements in `CLAUDE.md` and `design-governance/README.md` only (see Phase 2 Closure Patch); no rule or ruling changed. |
| legacy token values | every value in the four legacy JSON files, `index.css` and `Operations.module.css` |
| tooling | `client/scripts/checkTokenResolution.js`, `client/eslint.config.js`, `client/vite.config.js`, `client/vitest.config.ts`, lockfiles |

## Findings for Omar

1. ✅ **RESOLVED in the Phase 2 closure patch.** Stale statements in `CLAUDE.md`
   and `design-governance/README.md`: legacy token JSON described as "Source of
   Truth", and mechanisms kept "until Phase 2 re-points them". See below.
2. **Registered changes from the Phase 1 proposal:** DESIGN_TOKEN_ARCHITECTURE.md
   §14 lists 12. None contradicts the Constitution, Product Truth or a ruling.
   Two leave an obligation open instead of meeting it early: `surface.inset` and
   measured breakpoints.
3. **Authority diff against the Master Build Spec** (Review Gate Q-13, critical
   from G-2):
   - Spec §10 asks for KEEP / MERGE / RENAME / DEPRECATE / ADD. The Phase 2 spec
     set MIGRATE / REPLACE / RETAIN / DEPRECATE / UNKNOWN, which is what the map
     uses.
   - Spec §10's "preserve existing verdict colours" is overridden by 🔒 FC-13.
   - Spec §10's type roles map as follows:
     - display → `display.brand`;
     - page title → `heading.surface`;
     - section title → `heading.section`;
     - decision title → `heading.surface` or `body.claim`;
     - verdict → `body.claim`;
     - metric → `metric.*`;
     - body and supporting → `body.default`;
     - label → `label.default`;
     - metadata → `caption.default`;
     - mono/data → `technical.identifier`.
   - Spec §39 also lists iconography (only the icon size ladder is tokenized),
     imagery and illustration (not tokenized: outside the Phase 2 spec).
4. **Found by the closure consistency check, not acted on** (outside the patch's
   three corrections):
   - The `Status` header lines of the ten `design-governance/` documents still read
     "awaiting Review Gate G-1". G-1 was approved in Phase 1.5 (REVIEW_GATE.md
     RG-5.6). These are stale dated status lines; they make no claim about Phase 2.
   - Constitution Article 26 §5 keeps the existing bundle budget "until Phase 2
     states the new budget as a measured figure". Phase 2 did not state one, so the
     existing budget (`CLAUDE.md`, "bundle < 700KB target") remains in force by that
     article's own fallback. No contradiction, but the obligation is open.

## Phase 2 Closure Patch (documentation only)

Applied after Omar approved the Phase 2 implementation. Only `.md` files changed.

| File | Correction |
|---|---|
| `CLAUDE.md` · Authority rules | "Historical token files … still call themselves Source of Truth … New token values come only from Phase 2" replaced by two rules. `client/design-system/foundation/` is the current token implementation authority. The legacy token JSON (and legacy `index.css` variables) are legacy inputs that the existing UI renders with during migration; they are not the source of truth, not deleted, their values are not changed, and migration is not complete. |
| `CLAUDE.md` · Enforcement heading and text | "(legacy implementation, until Phase 2 re-points them)" and "re-pointed in Phase 2" replaced. The Phase 2 token resolver, build and tests are listed as implemented. The legacy linter and resolver still check legacy class names and are re-pointed with the first consuming surface. Phase 3 decides how primitives consume the token system. |
| `CLAUDE.md` · Styling rule | "legacy names until Phase 2" → "until its surface migrates"; new values come from `client/design-system/foundation/tokens/`. |
| `design-governance/README.md` §1 | DESIGN_TOKEN_ARCHITECTURE.md is "the implemented token architecture", no longer "a proposal for Phase 2". |
| `design-governance/README.md` §4 | The legacy token JSON row now reads LEGACY INPUTS, not the token source of truth, with the current authority named. The old "self-description is not edited" note is removed as no longer true. |
| `design-governance/README.md` §4 "Still binding" | Mechanisms "re-pointed in Phase 2" → re-pointed with the first consuming surface; Phase 3 decides consumption; the Phase 2 token system is implemented alongside. |
| `design-governance/README.md` §7 | Records that Phase 2 is implemented and legacy migration is not complete. "Next" is now Phase 3, when opened. |
| `DESIGN_TOKEN_ARCHITECTURE.md` §10, §14 row 8 | Count meanings (below). The "`CLAUDE.md` still says… not edited" note is replaced by "corrected in the closure patch". |
| `LEGACY_TOKEN_MIGRATION.md` header | Count meanings. No row, status or disposition changed. |
| `PHASE_2_TOKEN_AUDIT.md` | Legacy Migration count table; check 18 wording; finding 1 resolved; finding 4; this section. |

**Counts, as measured in the patch.** The recount was independent of the first
script and ran against a controlled extractor.

- **341** total status rows.
- **289** source-qualified token-entry rows (A–E, G), with 0 missing, 0 extra and
  0 duplicated within a section.
- **268** distinct identifier strings: 21 `--c-*` names are defined in two files.
- **52** other rows: F 34, H 13, I 5.

Neither number was changed; the difference is explained.

## Phase 2 Gate

```text
READY FOR PHASE 3 — PRIMITIVES
```

Phase 3 inherits the open items in DESIGN_TOKEN_ARCHITECTURE.md §15:

- the consumption API;
- re-pointing the linter and resolver;
- applying the environment attribute (app shell);
- `surface.inset`;
- measured breakpoints;
- verdict-word adjacency;
- the 48 UNKNOWN rulings;
- font weights.

None prevents a primitive from being built on these tokens.
