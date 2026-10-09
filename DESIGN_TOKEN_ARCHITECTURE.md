# LUMI DESIGN TOKEN ARCHITECTURE

```text
Status        IMPLEMENTED — Phase 2 (Design Tokens), 2026-09-14, on 16207f6.
              Supersedes the Phase 1 proposal of the same name. Section numbers are kept,
              so governance references (§4, §6, §7, §8, §9, §10, §11) still resolve.
              Every change from the proposal is registered in §14.
Governed by   design-governance/LUMI_DESIGN_CONSTITUTION.md
Source        client/design-system/foundation/tokens/*.json   ← the ONE current token authority
Audit         PHASE_2_TOKEN_AUDIT.md
```

**Markers:**

| Marker | Meaning |
|---|---|
| 🔒 | a locked value from a ruling |
| 📏 | a measurement produced by the token build |
| 🧪 | provisional; must be re-measured in a later phase |
| ⚠️ FC-n | a foundation conflict (Constitution Appendix A) |

Every 📏 number is read from
`client/design-system/foundation/generated/tokens.resolved.json`, which the build
produces from the source. None is estimated.

---

## 1. Goals

1. **Brand and product state never share a name**, even when they share a value.
   REALLOCATE and LUMI Gold are equal in value, and they are separate tokens with
   separate reference chains (⚠️ FC-2).
2. **Components never touch raw values.** Brand and primitive tokens are not
   emitted as CSS variables at all, so no component can consume one.
3. **Two environments, one language** (🔒 PR-9). Colour roles resolve per ground.
   There is no user theme switch.
4. **Enforceable.** Every rule here is checked by the token build or by
   `tokens.test.js`. The build refuses to write output while any rule is broken.
5. **Contrast is a property of declared token pairs, verified at build time**
   (📏 §8), not a review comment.

## 2. Layers

```text
LAYER 1  BRAND       brand.color.{gold, charcoal, offWhite, warmGray} · brand.font.{display, ui, data}
            │        literal · references nothing · never emitted as CSS
            ▼
LAYER 2  PRIMITIVE   primitive.color.{kill, hold, scale, watch, refresh, reallocate, light.*, shade.*,
            │        warm.*, shadow.*} · primitive.{font.stack, fontSize, lineHeight, fontWeight,
            │        letterSpacing, numeric, space, size, borderWidth, radius, duration, easing,
            │        motionDistance, zIndex}
            │        literal, or derived from brand NEUTRALS / brand fonts · never emitted as CSS
            ▼
LAYER 3  SEMANTIC    color.* · type.* · space.* · size.* · border.* · radius.* · shadow.* ·
            │        motion.* · layer.* · layout.*
            │        references primitives only · emitted as --lumi-* CSS variables
            ▼
LAYER 4  COMPONENT   component.*  — empty in Phase 2 · references semantic only
```

The semantic layer holds both the **system** roles (surfaces, text, borders,
interaction, type, space, motion…) and the **product-state** roles (verdict marks,
state expression). Both obey the same rule: primitives only.

**Reference rules — enforced by `resolve.js`**

| Layer | May reference | May NOT reference |
|---|---|---|
| brand | nothing | anything |
| primitive | `brand.color.charcoal` · `brand.color.offWhite` · `brand.color.warmGray` · `brand.font.*` | `brand.color.gold` · other primitives · semantic · component |
| verdict primitives `primitive.color.{kill, hold, scale, watch, refresh, reallocate}` | nothing (literal) | anything |
| semantic | primitive, plus **one** declared exception: `color.signal.attention → brand.color.gold` | any other brand token · semantic · component |
| component | semantic | brand · primitive · component |
| code (components, pages) | `--lumi-*` variables | brand and primitive (not emitted, so unreachable) |

**The exception, and why it is the only one.** The attention signal is one of
gold's three permitted jobs (Constitution Article 12 §2). It is the one semantic
role that *is* the brand colour doing its brand job. Every role that could be
tempted towards gold (focus, selection, hover, success, verdict) has no path to
brand at all. 📏 `tokens.test.js` asserts that `color.signal.attention` is the only
token below brand whose reference chain contains `brand.color.gold`.

**Further build rules**

- Every primitive is referenced by at least one semantic token. An unused
  primitive fails the build.
- Every token has a known `$type`.
- No token file can hide a duplicate key. The text is scanned before `JSON.parse`,
  which would otherwise keep the last key silently.

## 3. Source of truth, files and categories

```text
client/design-system/foundation/
├── tokens/
│   ├── brand.json            LAYER 1  literal identity values
│   ├── primitive.json        LAYER 2  raw scales and derived neutral steps
│   ├── semantic.json         LAYER 3  named jobs · $environments · $states · $contrast
│   └── component.json        LAYER 4  reserved, empty until Phase 3
├── resolve.js                resolves references and derivations; returns every broken rule
├── build.js                  writes generated/*; `--check` fails when output is stale
├── tokens.test.js            the Phase 2 validation contract, including falsification tests
├── generated/
│   ├── tokens.css            `--lumi-*` custom properties (semantic + component only)
│   └── tokens.resolved.json  every token resolved, its reference chain, contrast results, counts
└── LEGACY_TOKEN_MIGRATION.md every legacy token → new token → status
```

| Command (in `client/`) | What it does |
|---|---|
| `npm run tokens:build` | resolve, validate, write `generated/*` |
| `npm run tokens:check` | resolve, validate, fail if `generated/*` differs from the source |
| `npx vitest run design-system/foundation/tokens.test.js` | the validation contract |

- **Format.** JSON in the W3C Design Tokens style (`$value`, `$type`,
  `$description`, `{path}` references), with no dependency. Derivations:
  - `$mix` — a colour at an alpha over another, emitted solid;
  - `$stack` — a font stack;
  - `$sum` — a px sum;
  - `$shadow` — composes the single shadow.
- **Wiring.** `client/src/index.css` imports `generated/tokens.css`. The file
  declares custom properties only and styles no element. 📏 The compiled CSS for
  the existing UI is byte-identical to the pre-Phase 2 build once the four
  `--lumi-*` blocks are removed (PHASE_2_TOKEN_AUDIT.md, Validation).

**Categories**

| Category | Layers | Semantic tokens 📏 |
|---|---|---|
| colour | brand · primitive · semantic `color.*` | 41 |
| typography | brand fonts · primitive scales · semantic `type.*` | 52 |
| spacing | primitive · semantic `space.*` | 5 |
| sizing | primitive · semantic `size.*` | 6 |
| radius | primitive · semantic `radius.*` | 4 |
| border width | primitive · semantic `border.*` | 1 |
| elevation | primitive shadow colour · semantic `shadow.*` | 1 |
| motion | primitive · semantic `motion.*` | 8 |
| stacking | primitive · semantic `layer.*` | 6 |
| layout | primitive · semantic `layout.*` | 9 (3 🧪 provisional) |

📏 **Totals:** brand 7 · primitive 86 · semantic 133 · component 0 → **226 tokens**.
**130** are emitted as CSS variables (133 semantic − 3 provisional breakpoints).

## 4. Brand tokens vs product-state tokens

### 4.1 Brand palette and verdict primitives 🔒

```text
brand.color.gold              #D4A017
brand.color.charcoal          #0B0F14
brand.color.offWhite          #F7F7F3
brand.color.warmGray          #E6E2DA

primitive.color.kill          #C74646
primitive.color.hold          #D97732
primitive.color.scale         #3D9B6D
primitive.color.watch         #3B82F6
primitive.color.refresh       #B7791F
primitive.color.reallocate    #D4A017   ← equal VALUE to brand.color.gold, separate literal (FC-2)
```

`primitive.color.reallocate` is a literal, not a reference to brand. The build
rejects any reference from a verdict primitive, and any primitive reference to
brand gold (📏 falsification tests prove both rejections fire).

### 4.2 Brand tokens

| Token | Value | `$means` | `$notMeans` |
|---|---|---|---|
| `brand.color.gold` | `#D4A017` | signal · attention · decision · meaningful emphasis | generic success · generic interaction · universal focus · universal selection · decoration |
| `brand.color.charcoal` | `#0B0F14` | depth · focus · stability | |
| `brand.color.offWhite` | `#F7F7F3` | clarity · clean space | |
| `brand.color.warmGray` | `#E6E2DA` | balance · structure · background | |
| `brand.font.display` | Space Grotesk | display · headlines · brand expression; never dense UI, table cells or verdict words | |
| `brand.font.ui` | Inter | UI · body · navigation · forms | |
| `brand.font.data` | JetBrains Mono | metrics · identifiers · technical values | |

**Where gold may resolve.** 📏 Exactly four tokens hold `#D4A017`:

- `brand.color.gold`
- `primitive.color.reallocate`
- `color.verdict.reallocate.mark`
- `color.signal.attention`

```text
brand.color.gold ─────────────────────────────► color.signal.attention          (gold's attention job)
primitive.color.reallocate (literal #D4A017) ──► color.verdict.reallocate.mark   (never through brand)
```

If a future ruling changes brand gold, REALLOCATE does not move, and the reverse
also holds. 📏 The legacy implementation colours `#EF4444 / #F59E0B / #10B981`
appear in no token value, no token source file and no generated CSS (🔒 FC-13).

Brand gold is never an interaction colour (🔒 FC-14). Interaction roles are
defined independently in §6.2 and are tested never to resolve to gold.

### 4.3 Product-state tokens

**Verdict marks** — one per verdict, Charcoal only:

```text
color.verdict.kill.mark         → primitive.color.kill
color.verdict.hold.mark         → primitive.color.hold
color.verdict.scale.mark        → primitive.color.scale
color.verdict.watch.mark        → primitive.color.watch
color.verdict.refresh.mark      → primitive.color.refresh
color.verdict.reallocate.mark   → primitive.color.reallocate      (never → brand.color.gold)
```

A mark sits **beside** the verdict word. It is never text, never a fill with text
inside, never on an action control, never a category palette, and never used to
show change between two verdicts (COMPONENT_RULES.md CMP-09).

**State expression.** The backend decides **which** state is true
(STATE_RULES.md §0). State tokens decide only how much light its statement gets.
The registry is `semantic.json` → `$states`.

| State | Class | Tokens | Charcoal | Off White |
|---|---|---|---|---|
| LOADING | absence | `color.state.loading.foreground` | `light.60` | `shade.68` |
| AVAILABLE | value | `color.state.available.foreground` | `light.80` | `shade.84` |
| EMPTY | value | `color.state.empty.foreground` | `light.80` | `shade.84` |
| FAILED | claim | `color.state.failed.foreground` · `color.state.failed.border` | `light.100` · `light.44` | `shade.100` · `shade.52` |
| UNAVAILABLE | absence | `color.state.unavailable.foreground` | `light.60` | `shade.68` |
| NOT_CONNECTED | absence | `color.state.notConnected.foreground` | `light.60` | `shade.68` |
| NOT_PERMITTED | absence | `color.state.notPermitted.foreground` | `light.60` | `shade.68` |
| NOT_SUPPORTED | absence | `color.state.notSupported.foreground` | `light.60` | `shade.68` |
| STALE | value | `color.state.stale.foreground` | `light.80` | `shade.84` |
| PROCESSING | value | `color.state.processing.foreground` | `light.80` | `shade.84` |
| SUCCESS | value | `color.state.success.foreground` | `light.80` | `shade.84` |
| NOT_MEASURED | absence | `color.state.notMeasured.foreground` | `light.60` | `shade.68` |
| INSUFFICIENT_DATA | absence | `color.state.insufficientData.foreground` | `light.60` | `shade.68` |
| NO_CONVERSIONS | absence | `color.state.noConversions.foreground` | `light.60` | `shade.68` |
| MIXED_CURRENCY | absence | `color.state.mixedCurrency.foreground` | `light.60` | `shade.68` |
| DISABLED | interaction | `color.interaction.disabled.foreground` · `color.interaction.disabled.border` | `light.44` · `light.20` | `shade.52` · `shade.20` |
| PARTIAL | value | `color.state.partial.foreground` | `light.80` | `shade.84` |

**What keeps states distinct** (📏 each is asserted by `tokens.test.js`):

1. The registry is exactly the locked vocabulary of 17 states.
2. Every state owns its tokens, and no token is shared by two states. Two states
   may share a *value*, but no state can be restyled by editing another.
3. **Light follows the class.**
   - A `value` state renders exactly at AVAILABLE's light, so STALE and PARTIAL
     are never faded.
   - An `absence` state renders below it: structure without light.
   - A `claim` state (FAILED) is never dimmer than AVAILABLE, so a failure never
     reads as calm absence.
4. The spec's pairs differ in class: FAILED ≠ EMPTY, UNAVAILABLE ≠ EMPTY, and
   DISABLED is an interaction state, not UNAVAILABLE.
5. No state token is a verdict colour or gold, and no state has a tint, wash,
   fill or icon token.

Colour never distinguishes one state from another. The state's words, reason and
structure do that (STATE_RULES.md §17, rule 3). What the tokens guarantee is that
no state can be **lit** as something it is not. The illumination class is
expression only: it never picks a state. The backend and the locked B8 adapter
`absenceState()` do.

**Deliberately absent**

| Absent | Why |
|---|---|
| `verdict.*.text` · `.fill` · `.background` · `.glow` | Verdict words are neutral text (📏 KILL 4.02 : 1 on Charcoal). No neutral reaches 4.5 : 1 on a KILL fill. Glow is forbidden. |
| `verdict.unknown` | An unknown verdict is a refusal, not a colour (audit P0-14). |
| any verdict mark or attention signal on Off White | 📏 Gold 2.21 : 1 and HOLD 2.95 : 1 on Off White. |
| `color.success` / `danger` / `warning` / `info` | These names invite verdict colours to be reused. SUCCESS is a neutral state token. |
| gold focus, hover, selected, active or pressed | 🔒 FC-14. |
| state tint, wash, fill or icon tokens | No state owns a colour; an icon takes its state's foreground. |
| `tense.now.*`, `tense.atDecision.*` | 🔒 FC-5: NOW vs AT DECISION is stated in language, never as a visual diff. The labels use type and text roles; no system colour role exists. |
| `action.platform.*`, `action.record.*` | The weight difference between "LUMI will do this" and "I did this" is a component decision (Phase 3). No system role is defensible yet. |
| `surface.inset` | See §14 item 4 and §15. |
| compact-density tokens | Compact is one tier down (§7). |
| shadow scale · glow · blur · glass · gradient · neon | Constitution Articles 16 and 18; VISUAL_BOUNDARIES.md. |
| animation · keyframe · loop tokens | MOTION_RULES.md MO-8, MO-9. |
| component tokens | Phase 3. |

### 4.4 Naming rules

| Rule | Example |
|---|---|
| Path segments are camelCase words or integers (build error otherwise) | `color.state.notMeasured.foreground`, `primitive.color.light.44` |
| CSS variable = `--lumi-` + path in kebab-case, unique (build error on collision) | `--lumi-color-state-not-measured-foreground` |
| Semantic names state a **job**, never an appearance | `color.border.strong`, never `color.border.gray` |
| No hue or effect names in semantic or component paths (build error) | `red`, `blue`, `gold`, `gray`, `white`, `black`, `glow`, `gradient`, `glass`, `neon` … |
| No ordinal or generic-status names in colour paths (build error)… | `primary`, `secondary`, `tertiary`, `accent`, `success`, `danger`, `warning`, `info`, `error` |
| …except a locked state name in its own slot | `color.state.success.foreground` is the SUCCESS state (STATE_RULES.md §11), not a tone |
| Primitive steps are named by their measure | `light.60` = Off White at 60% over Charcoal; `space.16` = 16px |
| Verdicts are named by verdict, never by hue | `color.verdict.watch.mark`; WATCH equals a stock framework blue (ANTI_CONVERGENCE.md F-16) |

**"Primitive token" ≠ "primitive component".** A primitive token is a raw scale
value. The Phase 3 primitive components are unrelated, and they consume semantic
tokens.

## 5. Environments (🔒 PR-9)

Colour roles resolve per **ground**. An **environment** is a product context
that selects a ground.

| Environment | Selector | Ground | Chosen by |
|---|---|---|---|
| `product` | `[data-lumi-env="product"]` | charcoal | the authenticated route family |
| `marketing` | `[data-lumi-env="marketing"]` | offWhite | the public route family |
| `marketing-dark-section` | `[data-lumi-env="marketing-dark-section"]` | charcoal | a controlled Charcoal section inside marketing |

- **No theme switch.** There is no `prefers-color-scheme` branch, no `data-theme`,
  no `.dark` class and no user preference (📏 tested).
- **`:root` holds invariant tokens only** (type, space, size, radius, shadow,
  motion, layer, layout). **Colour is never declared on `:root`** (📏 tested), so
  colour exists only inside an explicit environment.
- **Absent roles.** A role that does not exist on a ground is `null` in the source
  and emitted as `initial`, the guaranteed-invalid value, so it cannot be used
  there. 📏 Exactly seven roles are absent on Off White: the six verdict marks and
  `color.signal.attention`.
- **Nesting** scopes: a `marketing-dark-section` element inside a `marketing`
  element redeclares the Charcoal values for its subtree.
- **Applying** the attribute to real routes is app-shell work (Phase 7). Phase 2
  changes no route, layout or page.

## 6. Light steps and system colour roles

### 6.1 Light steps — derived, never invented

No grey has an identity of its own (Constitution Article 11). Every neutral step is
a brand neutral composited over the other brand neutral and emitted as a **solid**
colour, so no glass effect is possible. The only translucent value is the one
shadow colour (§9).

| `primitive.color.light.n` — Off White at n% over Charcoal | 📏 | `primitive.color.shade.n` — Charcoal at n% over Off White | 📏 |
|---|---|---|---|
| `0` | `#0B0F14` | `0` | `#F7F7F3` |
| `4` | `#14181D` | `6` | `#E9E9E6` |
| `6` | `#191D21` | `8` | `#E4E4E1` |
| `8` | `#1E2226` | `10` | `#DFE0DD` |
| `10` | `#23262A` | `12` | `#DBDBD8` |
| `12` | `#272B2F` | `20` | `#C8C9C6` |
| `20` | `#3A3D41` | `52` | `#7C7E7F` |
| `44` | `#737576` | `68` | `#57595B` |
| `60` | `#999A9A` | `84` | `#313438` |
| `80` | `#C8C9C6` | `100` | `#0B0F14` |
| `100` | `#F7F7F3` | | |

`primitive.color.warm.100` is Warm Gray over Off White (`#E6E2DA`), the
structural background of marketing pages.

**Why Charcoal surfaces stop at `light.10`.** 📏 KILL measures 3.18 : 1 on
`light.10`. In the Phase 2 derivation run it measured 2.98 : 1 on `light.12`. Every
Charcoal surface a verdict mark can sit on (base, raised, elevated, hover,
selected, pressed) therefore stays at or below `light.10`.

### 6.2 Roles

| Token | Charcoal | Off White | Job |
|---|---|---|---|
| `color.surface.base` | `light.0` | `shade.0` | the ground |
| `color.surface.raised` | `light.4` | `warm.100` | a reading region; one step of light, not physical height (Article 11 §5) |
| `color.surface.elevated` | `light.8` | `shade.0` | an overlay above content, with `shadow.overlay` |
| `color.text.claim` | `light.100` | `shade.100` | the verdict word and the decision sentence |
| `color.text.body` | `light.80` | `shade.84` | reasons, operational copy |
| `color.text.meta` | `light.60` | `shade.68` | windows, bases, clocks, identifiers |
| `color.border.divider` | `light.12` | `shade.12` | separates; decorative |
| `color.border.subtle` | `light.20` | `shade.20` | structural outline, never the only indicator |
| `color.border.strong` | `light.44` | `shade.52` | the only indicator of a control boundary (inputs) |
| `color.signal.attention` | `brand.color.gold` | — | the single attention signal in a region |
| `color.interaction.hover.surface` | `light.6` | `shade.6` | pointer over |
| `color.interaction.pressed.surface` | `light.10` | `shade.10` | activation (CSS `:active`) |
| `color.interaction.selected.surface` | `light.8` | `shade.8` | chosen within a set (`aria-selected`); never alone |
| `color.interaction.selected.indicator` | `light.100` | `shade.100` | the non-colour-alone mark of selection |
| `color.interaction.active.indicator` | `light.100` | `shade.100` | current location or open item (`aria-current`) |
| `color.interaction.focus.ring` | `light.100` | `shade.100` | keyboard focus; neutral, never gold, never a verdict colour |
| `color.interaction.disabled.foreground` | `light.44` | `shade.52` | label of a disabled control, which always carries its published reason in `text.meta` |
| `color.interaction.disabled.border` | `light.20` | `shade.20` | boundary of a disabled control |

**Interaction ≠ verdict ≠ brand.** 📏 No interaction, border, text, surface or
state token resolves to gold or to any verdict value on any ground (tested).

**Shared primitives are deliberate.** Several roles share a primitive; for
example, the focus ring and the selected and active indicators all use
`light.100`. These are distinct **jobs**, distinguished by shape and ARIA
semantics, and each can be retuned independently.

**Selection inside an overlay.** On Charcoal, `selected.surface` equals
`surface.elevated` in value, so a selected item inside an overlay shows no surface
change. `selected.indicator` carries the selection, which is why selection is never
surface-only.

## 7. Spacing — relational tiers

| Token | Value | Relationship (Constitution Article 14) |
|---|---|---|
| `space.inline` | 4px | within one statement |
| `space.meta` | 8px | a value and its window, basis and clock |
| `space.object` | 16px | the stages of one Decision |
| `space.section` | 32px | distinct questions on a surface |
| `space.macro` | 64px | distinct regions |

- Each tier doubles the one inside it (📏 tested), so proximity keeps encoding
  relationship.
- A compact object steps down one tier and never below `space.inline`
  (Article 15). Compact needs no tokens of its own.
- The spacing primitives are 4 · 8 · 16 · 24 · 32 · 64. 24 exists only for the
  tablet layout gutter (§9).

## 8. Contrast obligations — accessibility

The contrast-pair manifest is `semantic.json` → `$contrast`.

- The build verifies every declared (foreground, background, ground) triple and
  fails below the minimum.
- A colour token that is in no pair must be listed in `exempt` with a reason. A
  token cannot be both.
- Instrument: WCAG 2.2 relative luminance. Controls 21 : 1 and 1 : 1, plus the
  Constitution's KILL-on-Charcoal 4.02, are reproduced by the tests.

📏 **228 checks, 0 failing.**

| Criterion | Minimum | Checks |
|---|---|---|
| WCAG 2.2 SC 1.4.3 text | 4.5 | 132 |
| SC 1.4.11 non-text — verdict marks and the attention signal | 3 | 42 |
| SC 1.4.11 non-text — focus, selection, current location | 3 | 36 |
| SC 1.4.11 non-text — strong border, failed border | 3 | 12 |
| LUMI floor for inactive controls (WCAG exempts them) | 3 | 6 |

📏 **Worst case per token** — the lowest ratio across every surface the token is
declared on:

| Token | Min | Charcoal | Off White |
|---|---|---|---|
| `color.text.claim` | 4.5 | 14.15 (pressed) | 14.50 (pressed) |
| `color.text.body` | 4.5 | 9.14 (pressed) | 9.44 (pressed) |
| `color.text.meta` | 4.5 | 5.39 (pressed) | 5.31 (pressed) |
| `color.state.*.foreground` — absence class | 4.5 | 5.67 (elevated) | 5.45 (raised) |
| `color.state.*.foreground` — value class | 4.5 | 9.62 (elevated) | 9.68 (raised) |
| `color.state.failed.foreground` | 4.5 | 14.90 (elevated) | 14.88 (raised) |
| `color.border.strong` · `color.state.failed.border` | 3 | 3.46 (elevated) | 3.16 (raised) |
| `color.interaction.disabled.foreground` | 3 | 3.46 (elevated) | 3.16 (raised) |
| `color.interaction.focus.ring` · `selected.indicator` · `active.indicator` | 3 | 14.15 (pressed) | 14.50 (pressed) |
| `color.verdict.kill.mark` | 3 | **3.18** (pressed) | absent |
| `color.verdict.hold.mark` | 3 | 4.80 (pressed) | absent |
| `color.verdict.scale.mark` | 3 | 4.42 (pressed) | absent |
| `color.verdict.watch.mark` | 3 | 4.13 (pressed) | absent |
| `color.verdict.refresh.mark` | 3 | 4.17 (pressed) | absent |
| `color.verdict.reallocate.mark` · `color.signal.attention` | 3 | 6.40 (pressed) | absent |

**Exempt, with reasons:**

- `color.border.divider` — decorative;
- `color.border.subtle` — never the only boundary indicator;
- `color.interaction.disabled.border` — an inactive control.

**How the locked-palette constraints are met without changing a locked colour**

| Constraint (Constitution Article 21) | Token answer |
|---|---|
| Gold on Off White 2.21 : 1 | `color.signal.attention` and `color.verdict.reallocate.mark` do not exist on Off White (`initial`). |
| HOLD on Off White 2.95 : 1 | No verdict mark exists on Off White. Verdicts on marketing pages live in `marketing-dark-section`. |
| KILL on Charcoal 4.02 : 1 misses 4.5 as text | There is no verdict text token. Verdict words use `color.text.claim`. |
| No neutral reaches 4.5 : 1 on a KILL fill | There is no verdict fill or background token. |
| HOLD–REFRESH ΔE 5.1 (deutan) | A mark is never the whole verdict; the word is mandatory (CMP-09). Tokens cannot enforce adjacency, so the Phase 3 verdict primitive must (§15). |
| Focus must not rely on gold | `color.interaction.focus.ring` is the highest neutral step, ≥ 14 : 1 on every declared surface. |
| Colour never carries meaning alone (SC 1.4.1) | Selection has an indicator. Failure has a boundary and words. States are distinguished by words and reasons. |

**Other accessibility tokens**

- `size.target.minimum` 24px (SC 2.5.8) and `size.target.touch` 44px;
- `size.focus.width` and `size.focus.offset`, 2px each;
- a 12px legibility floor on every type role (📏 tested);
- reduced-motion values (§9).

## 9. Other categories

### Typography

🔒 Families: Space Grotesk, Inter, JetBrains Mono. No other typeface is named or
shipped (📏 the generated CSS names exactly these three).

**Font stacks** (`primitive.font.stack.*`) are the brand face followed only by
platform fallbacks: `system-ui, sans-serif` or `ui-monospace, monospace`. Arabic
account data is covered by per-glyph fallback to the platform face. **No fourth
typeface is shipped**, which closes Constitution Article 20 §7 under the Phase 2
rule "do not introduce another typeface".

**Primitives**

- Sizes: 12 · 14 · 16 · 20 · 24 · 48 px.
- Line heights on the 4px grid: 16 · 20 · 24 · 28 · 32 · 56.
- Weights: 400 · 500 · 600, all already shipped by `client/src/main.jsx`.
- Letter spacing: tight −0.02em · snug −0.01em · normal 0.

| Category | Role | Family | Size / line | Weight | Notes |
|---|---|---|---|---|---|
| display | `type.display.brand` | Space Grotesk | 48 / 56 | 600 | marketing brand moments; tight |
| heading | `type.heading.surface` | Space Grotesk | 24 / 32 | 600 | surface title; snug |
| heading | `type.heading.section` | Inter | 16 / 24 | 600 | a distinct question on a surface |
| body | `type.body.claim` | Inter | 16 / 24 | 600 | verdict word and decision sentence; never smaller than body |
| body | `type.body.default` | Inter | 14 / 20 | 400 | reasons, operational copy |
| label | `type.label.default` | Inter | 14 / 20 | 500 | controls, navigation, form labels |
| caption | `type.caption.default` | Inter | 12 / 16 | 400 | windows, bases, clocks |
| metric | `type.metric.headline` | JetBrains Mono | 20 / 28 | 500 | tabular; always with its window |
| metric | `type.metric.inline` | JetBrains Mono | 14 / 20 | 400 | tabular; in text or table rows |
| technical | `type.technical.identifier` | JetBrains Mono | 12 / 16 | 400 | identifiers, codes |

- Each role is five tokens: `family`, `size`, `lineHeight`, `weight`,
  `letterSpacing`. Metric roles add `numeric` = `tabular-nums`.
- 📏 Tested:
  - Space Grotesk appears only in `display.brand` and `heading.surface`;
  - metrics and identifiers are mono, and prose roles are Inter;
  - no size is below 12px;
  - the claim is never smaller than body.
- Hierarchy follows **DECISION IMPORTANCE > EVIDENCE > CONTEXT**. The claim
  outranks body through weight and light (`color.text.claim`), not size alone.
- The headline figure (20px) is larger than the claim (16px) because a mono figure
  needs the size to be legible. Article 11 §3 keeps the claim the most lit element,
  so a figure never takes more light than the claim.

### Sizing

| Token | Value |
|---|---|
| `size.target.minimum` | 24px |
| `size.target.touch` | 44px |
| `size.icon.inline` | 16px |
| `size.icon.standalone` | 20px |
| `size.focus.width` | 2px |
| `size.focus.offset` | 2px |

### Radius (Article 19)

| Token | Value | Used by |
|---|---|---|
| `radius.structural` | 0 | regions, tables, rules, the spine |
| `radius.control` | 2px | buttons, inputs, verdict marks |
| `radius.container` | 4px | Article 17 containers and overlays |
| `radius.round` | 9999px | only elements round by meaning (avatar, radio) |

There is no pill token. 📏 Tested: nothing is above 4px except `radius.round`.

### Border

- `border.width.hairline` is 1px.
- Colours: `color.border.{divider, subtle, strong}` and
  `color.interaction.focus.ring` (§6.2).

### Shadow

- One token: `shadow.overlay` = `0px 8px 24px 0px rgb(11 15 20 / 0.24)`, for menus,
  popovers and dialogs only.
- No shadow scale, no glow, no blur. 📏 Tested: exactly one shadow token, and its
  chain touches no gold or verdict colour.
- On Charcoal an overlay is separated mainly by `color.surface.elevated` and
  `color.border.subtle`. On Off White the shadow does that work.

### Motion

| Token | Value | Reduced motion | Purpose (MO-1) |
|---|---|---|---|
| `motion.duration.feedback` | 100ms | 100ms | direct control feedback; background-color only under FC-20, or composited opacity |
| `motion.duration.reveal` | 200ms | 0ms | a value becoming known |
| `motion.duration.transition` | 240ms | 0ms | spatial continuity |
| `motion.duration.maximum` | 400ms | 0ms | the ceiling for any UI motion; a limit, not an animation |
| `motion.easing.reveal` | `cubic-bezier(0, 0, 0.2, 1)` | — | decelerate |
| `motion.easing.transition` | `cubic-bezier(0.4, 0, 0.2, 1)` | — | symmetric |
| `motion.easing.feedback` | `linear` | — | near-linear |
| `motion.distance.settle` | 4px | 0px | the most positional movement a reveal may add |

- **Reduced motion lives in the tokens.** Under
  `@media (prefers-reduced-motion: reduce)` the variables take their reduced
  values: reveal, transition and maximum durations reduce automatically, and
  settle becomes 0px; feedback remains 100ms. The legacy global override in
  `index.css` stays as the MO-7 safety net.
- **Control background-color exception — Omar, 2026-10-09 (FC-20).** A direct
  user-interaction control may transition its `background-color` for up to 100ms
  with the existing semantic feedback-duration and linear-easing tokens, only
  for direct control feedback such as hover or press. No layout animation or
  content-availability change;
  no verdicts, metrics, data charts, progress, loading, success/failure states,
  decoration, brand-gold or verdict-color substitution. Accessible non-motion
  feedback and independently verified reduced behavior remain mandatory.
  All other motion remains restricted to composited properties (primarily
  opacity/transform). The [canonical conditions](design-governance/LUMI_DESIGN_CONSTITUTION.md#fc-20-control-feedback-exception)
  and [MO-5/MO-6.5/MO-7](design-governance/MOTION_RULES.md) govern consumers;
  no token value or implementation changes are authorized here.
- **Reduction distinction:** feedback remains **100ms** in the reduced token
  set. Reveal/transition/maximum become 0ms and settle becomes 0px. Separately,
  the existing global `index.css` override caps actual CSS transition/animation
  duration at **0.01ms** with `!important`; it is not a zero-valued feedback
  token and does not replace per-animation declarations. Preserve and
  independently verify this safety net. Legacy Auth 150ms color transitions
  and other unverified consumers are not approved by FC-20.
- 📏 Tested:
  - `feedback < reveal ≤ transition ≤ maximum`;
  - reveal and transition reduce to 0ms, and settle reduces to 0px;
  - every duration and distance declares a reduced value (a build error otherwise);
  - no easing control point leaves [0, 1], so there is no bounce, spring overshoot
    or anticipation;
  - no token is an animation, keyframe, pulse, shimmer or loop.
- Phase 2 created motion tokens, not screen/component animations. Current
  consumers must follow the governing motion rules and the bounded FC-20
  exception; this historical token verification is not consumer certification.

### Layout and breakpoints

| Token | Value |
|---|---|
| `layout.width.claim` | 640px — primary column carrying the Decision Spine |
| `layout.width.evidence` | 360px — secondary evidence column |
| `layout.width.page` | 1280px — maximum content width |
| `layout.gutter.mobile` · `tablet` · `desktop` | 16px · 24px · 32px |

🧪 **Provisional breakpoints**, derived from content widths rather than device
names (Article 25):

| Token | Derivation | 📏 Value |
|---|---|---|
| `layout.breakpoint.tablet` | claim + 2 × tablet gutter | 688px |
| `layout.breakpoint.laptop` | claim + evidence + 3 × desktop gutter | 1096px |
| `layout.breakpoint.desktop` | page + 2 × desktop gutter | 1344px |

- **Why provisional.** Article 25 wants the width where the **real** Decision
  Spine and evidence column stop fitting, and neither exists yet. `laptop` also
  excludes the persistent navigation width, which the app shell has not fixed.
- **Why not in CSS.** A custom property cannot be used in a media query, so
  breakpoints live in the resolved manifest for Phase 3 tooling.

### Z-index

A closed stacking order:

| Token | Value |
|---|---|
| `layer.base` | 0 |
| `layer.sticky` | 100 |
| `layer.navigation` | 200 |
| `layer.overlay` | 300 |
| `layer.modal` | 400 |
| `layer.announcement` | 500 |

No numeric z-index outside these tokens.

## 10. Migration from legacy tokens

**One current authority.** `client/design-system/foundation/tokens/` is the only
current token source. Legacy sources remain as **migration infrastructure only**,
because the existing UI renders with them (Constitution Article 37). The JSON
single-source **mechanism** is reused; no legacy **value** is carried over by
default. Each legacy source now says so in its own header:

| Legacy system | Role now | Marked |
|---|---|---|
| `client/design-system/tokens/{colors, typography, spacing, motion}.json` | values Tailwind reads for the legacy UI | `_comment: "LEGACY — …"` and `_authority` (no value touched) |
| `client/tailwind.config.js` | legacy wiring | header comment |
| `client/src/index.css` `:root` and `[data-theme="dark"]` | legacy variables for the legacy UI | section comment |
| `client/src/pages/demo/Operations/Operations.module.css` | local legacy copies | listed in the map |
| `client/design-system/lint/no-generic-tailwind.js` | legacy class discipline | stale "Design Bible" comment corrected |
| `design-system-figma/.../tokens/colors.json` | historical copy read by no build | listed in the map |

**Rules**

1. New code consumes `--lumi-*` variables only, never a legacy token.
2. No legacy value changes. A value change restyles shipped UI and is not a token
   change.
3. No alias from a legacy name to a new token, because an alias would re-import the
   legacy meaning.
4. A surface migrates as a whole. Its legacy entries are removed only when their
   last call site is gone.

**The map** is `client/design-system/foundation/LEGACY_TOKEN_MIGRATION.md`.

- 📏 **341 total status rows** across sections A–I.
- 📏 **289 of them are source-qualified token entries**: one row per (source file,
  token name).
  - They cover **268 distinct identifier strings**, because the 21 `--c-*` names
    are defined both in `index.css` `:root` and in `Operations.module.css`.
  - The other **52 rows** cover the theme block, rules and classes (34), inline
    Tailwind values and wiring (13), and mechanisms, consumers and historical
    copies (5).
  - No count of tokens unique **by meaning** is claimed; see
    PHASE_2_TOKEN_AUDIT.md, Legacy Migration.
- Every entry of the following sources appears exactly once in its own section,
  verified mechanically:

  | Source | Entries |
  |---|---|
  | `colors.json` | 57 |
  | `typography.json` | 21 |
  | `spacing.json` | 24 |
  | `motion.json` | 42 |
  | `index.css` `:root` | 118 |
  | `Operations.module.css` | 27 |

| Status | Rows |
|---|---|
| MIGRATE | 78 |
| REPLACE | 99 |
| RETAIN | 6 |
| DEPRECATE | 110 |
| UNKNOWN | 48 |

UNKNOWN rows need a product or design ruling before their surfaces migrate. They
are grouped in PHASE_2_TOKEN_AUDIT.md.

**Tailwind exposure is deferred to Phase 3.** The canonical semantic roots
`surface`, `text`, `signal` and `verdict` are already occupied by legacy Tailwind
colour namespaces (`bg-surface-card`, `text-signal-kill`, `bg-verdict-kill-bg`…).
Exposing the new tokens as utilities now would force one of two bad outcomes:
renaming canonical tokens to dodge legacy names, or putting two meanings under one
class prefix. Phase 3 chooses the consumption API.

## 11. Phase 2 entry conditions — record

All met before Phase 2 began (Omar opened Phase 2 on 2026-09-14 against `16207f6`).

1. ✅ **Review Gate G-1** approved (design-governance/REVIEW_GATE.md RG-5.6).
2. ✅ *Done in Phase 1.5.* **`CLAUDE.md` authority pointers** updated to
   `design-governance/` (⚠️ FC-9).
3. ✅ *Done in Phase 1.5.* **The Master Build Spec** is available to the reviewer
   (`design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`, ⚠️ FC-10).
4. 🔒 **FC-13 RULED (Omar, 2026-09-14).** Verdict colours are the six PR-6 values
   (§4.1). There is **no reversion** to `#EF4444 / #F59E0B / #10B981`. The legacy
   inventory (§10) never supplies a verdict value, and 📏 the tests prove none does.
5. 🔒 **Logo (Omar, 2026-09-14).** The missing "01 / Current Base" source blocks
   brand implementation, **not** this token architecture. No token depends on the
   logo.

## 12. Phase 2 decisions

These were the Phase 1 open decisions. Each is now taken:

| Open decision | Taken |
|---|---|
| light-step ladder and resolved values | §6.1 |
| spacing base and tier values | §7 |
| type role sizes, line heights, weights; the Arabic coverage face | §9 Typography: no face named, platform fallback |
| radius, focus ring and motion values | §9, §6.2 |
| breakpoint measurements | §9: 🧪 derived and provisional; measured in Phase 3/4 |
| authoring format | JSON in the W3C Design Tokens style, compiled to CSS variables; Tailwind exposure deferred (§10) |

## 13. Enforcement

| Mechanism | Question it answers | Status |
|---|---|---|
| `resolve.js` through `npm run tokens:build` / `tokens:check` | Do tokens obey the layer, naming, state, contrast, motion, duplicate-key and orphan rules? Is the generated output current? | **new** |
| `tokens.test.js` (vitest, 56 tests) | Do the Phase 2 validation items hold? Can each checker be made to fail? | **new** |
| `client/scripts/checkTokenResolution.js` | Does every colour class written in source exist in the compiled CSS? | kept; still answers for legacy classes |
| `client/design-system/lint/no-generic-tailwind.js` | Is a class forbidden? | kept; still checks legacy names |

**Why the two legacy mechanisms are not re-pointed in Phase 2.** Both inspect
**class names written in components**. No component consumes a `--lumi-*` token
yet, and Phase 2 may not modify components. Re-pointing the linter now would fail
every legacy call site, so it is re-pointed with the first consuming surface
(Phase 3).

The contrast manifest lives in the token build, not in
`checkTokenResolution.js`, because contrast pairs are token facts that compiled
class names cannot reveal.

## 14. Changes from the Phase 1 proposal (registered, not silent)

| # | Phase 1 proposal | Implemented | Reason |
|---|---|---|---|
| 1 | L0 reference → L1 brand → L2 system → L3 product state → L4 component | brand → primitive → semantic → component | The Phase 2 spec (§3) fixes the four named layers. The proposal's invariants survive: verdict and state never reach brand; REALLOCATE is separate from gold; components cannot reach raw values. System and product-state roles share the semantic layer and its "primitives only" rule. |
| 2 | 5-step light ladder | 11 steps on Charcoal, 10 on Off White, 1 Warm Gray step | The roles and the 📏 contrast pairs need them. Every step is used; orphans fail the build. |
| 3 | `rule.divider`, `rule.structure`, `border.input`, `focus.ring` | `color.border.{divider, subtle, strong}`, `color.interaction.focus.ring` | Phase 2 spec §9, §11 names. |
| 4 | `surface.{reading, overlay, inset}` | `color.surface.{base, raised, elevated}`; **no inset** | Phase 2 spec §10 names. "raised" and "elevated" are defined as light and overlay, not height. Inset is open (§15). |
| 5 | ten type roles (`surfaceTitle` … `control`) | ten roles in the spec's seven categories | Phase 2 spec §6. `surfaceTitle` → `heading.surface` · `sectionTitle` → `heading.section` · `claim` → `body.claim` · `label`, `navigation`, `control` → `label.default` · `meta` → `caption.default` · `figure` → `metric.headline` / `metric.inline` · `identifier` → `technical.identifier` · new `display.brand`. |
| 6 | `tense.*`, `action.*` | not created | §4.3, Deliberately absent. |
| 7 | contrast manifest in `checkTokenResolution.js` | in the token build | §13. |
| 8 | linter and resolver re-pointed in Phase 2 | re-pointed with the first consuming surface | §13; Phase 2 may not modify components. `CLAUDE.md` and `design-governance/README.md` were corrected to match in the Phase 2 closure patch. |
| 9 | breakpoints measured in Phase 2 | 🧪 derived, provisional | The Decision Spine does not exist to measure against. |
| 10 | an Arabic coverage face named in Phase 2 | platform fallback; no face named | Phase 2 spec §6: no additional typeface. |
| 11 | motion ranges | locked at 100 / 200 / 240 / 400ms | Within MOTION_RULES.md MO-2. |
| 12 | L3 tokens `state.<STATE>.*` | `color.state.<state>.foreground` (+ `failed.border`); DISABLED via `color.interaction.disabled.*` | Phase 2 spec §5: only roles with a defensible system purpose. |

None of these contradicts the Constitution, Product Truth or a locked ruling.
Items 4 (inset) and 9 (breakpoints) leave a governance obligation **open** rather
than meeting it early, and both are carried in §15.

## 15. Open items carried to Phase 3

1. **Consumption API.** How primitives consume `--lumi-*`: a collision-free
   Tailwind namespace, or `var()` directly (§10).
2. **Re-point the linter and resolver** with the first consuming surface (§13).
3. **Environment attribute.** The app shell applies `data-lumi-env` by route family
   (Phase 7).
4. **`surface.inset`** (Constitution Article 16). On Charcoal nothing sits below the
   ground without a new colour. Phase 3 decides how code and identifiers are inset.
5. **Breakpoints.** Re-measure against the real Decision Spine, and add the
   navigation width to `laptop` (§9).
6. **Verdict word adjacency.** Tokens cannot force a mark to sit beside its word.
   The verdict primitive must (CMP-09; 📏 HOLD–REFRESH ΔE).
7. **The 48 UNKNOWN legacy entries** need rulings before their surfaces migrate
   (PHASE_2_TOKEN_AUDIT.md).
8. **Fonts shipped vs used.** `main.jsx` still loads Space Grotesk 400, 500 and 700
   for the legacy UI, while the new roles use only Space Grotesk 600. Trimming the
   weights is a font-loading change, made when their legacy consumers are gone
   (Article 26 §2).

## 16. Token consumption by primitives (Phase 3, 2026-09-14)

No token was added, removed or changed in Phase 3. This section records how the
Phase 3 primitives (`client/src/lumi/`, registry `client/src/lumi/README.md`)
consume the tokens, and where each §15 item now stands.

**Consumption API (closes §15 item 1): `var()` directly, through CSS modules.**

```text
generated/tokens.css  --lumi-*  ──var()──►  client/src/lumi/**/*.module.css  ──►  primitive
```

- No Tailwind namespace was added. The legacy collisions in §10 therefore stay
  unresolved and harmless: the new layer never writes a Tailwind class.
- `client/tailwind.config.js` excludes `./src/lumi/**` from its content scan. 📏 A
  probe class placed inside `src/lumi` was not generated, and the same class
  outside it was.
- Colour tokens are read only inside `<Environment>`, which sets `data-lumi-env`
  (§5). A coloured primitive outside an environment throws.
- Component tokens (§2, layer 4) stay empty. Every value a primitive needs already
  exists as a semantic token.

📏 **What is consumed.** 108 of the 130 emitted variables are referenced by the
four LUMI CSS modules. The 22 not referenced:

| Group | Tokens | Why not yet |
|---|---|---|
| stacking | `layer.*` (6) | no overlay, sticky or modal primitive exists (dialog deferred, see below) |
| layout | `layout.width.*` (3), `layout.gutter.*` (3) | page and column widths belong to surfaces and the app shell |
| motion | `motion.duration.{reveal, transition, maximum}`, `motion.easing.{reveal, transition}`, `motion.distance.settle` | no primitive reveals or transitions; only control feedback moves |
| radius | `radius.structural`, `radius.round` | structural regions use no radius property; no round-by-meaning element is built |
| interaction | `color.interaction.selected.surface` | no selectable-set primitive (tabs, listbox) passed CMP-01 |
| signal | `color.signal.attention` | no Attention surface consumes it yet; 📏 the token-usage test asserts it is referenced nowhere |

**Enforcement added** (`client/src/lumi/__tests__/tokenUsage.test.js`). Each checker
is first shown to fail on a planted violation.

- every `var()` names a defined `--lumi-*` token, with no fallback;
- no raw colour, length or duration, gradient, blur, glow, animation, legacy
  variable or non-token font family;
- verdict mark tokens appear only in the six `.mark*` rules, one per verdict, and
  `.markReallocate` resolves through `color.verdict.reallocate.mark`;
- no `:hover`, `:active`, `:focus`, `aria-disabled` or `aria-current` rule
  reaches a verdict, gold or state colour, and every focus outline is
  `size.focus.width` + `color.interaction.focus.ring`.

**§15 status after Phase 3**

| §15 item | Status |
|---|---|
| 1 Consumption API | **closed** — above |
| 2 Re-point linter and resolver | **open, unchanged.** The new layer writes no class names, so neither mechanism has anything new to check. Its own static test covers it. They are re-pointed with the first migrating surface. |
| 3 Environment attribute | **partly met.** `<Environment>` applies the attribute; applying it by route family remains app-shell work. |
| 4 `surface.inset` | **open.** Identifiers are distinguished by `type.technical.identifier` and meta light, not by an inset surface; no token was added. |
| 5 Breakpoints | **open.** No primitive encodes a breakpoint; the Decision Spine exists as a part but has not been measured on a real surface. |
| 6 Verdict word adjacency | **closed.** `VerdictMark` renders the mark and the word together and has no mark-only form. |
| 7 48 UNKNOWN legacy entries | **open, unchanged.** |
| 8 Fonts shipped vs used | **open, unchanged.** |

**New token question (not answered here).** A modal dialog needs a flat dimming
backdrop (Constitution Article 16). No semantic token expresses one, and tokens
were locked for Phase 3, so no dialog primitive was built
(PHASE_3_PRIMITIVE_AUDIT.md, Findings).
