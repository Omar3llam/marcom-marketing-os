# LUMI DESIGN TOKEN ARCHITECTURE

```text
Status   PROPOSAL — Phase 1 deliverable. Architecture for Phase 2 to implement.
         No token file, CSS, Tailwind config or component is created or changed in Phase 1.
Date     2026-09-14 · base a3ec116
Governed by  design-governance/LUMI_DESIGN_CONSTITUTION.md
```

**Markers:**

| Marker | Meaning |
|---|---|
| 🔒 | a locked value from a ruling |
| 🧪 | a proposal for Phase 2 to verify and lock |
| 📏 | a measurement |
| ⚠️ FC-n | a foundation conflict (Constitution Appendix A) |

---

## 1. Goals

1. **Brand and product state never share a name**, even when they share a value.
   "Brand Gold ≠ HOLD" and "Brand Gold ≠ REALLOCATE" hold at the token level
   (brief §36; ⚠️ FC-2).
2. **Components never touch raw values.** Every value a component uses has a
   semantic name that states its job.
3. **Two environments, one language** (🔒 PR-9). Semantic tokens resolve per
   environment; there is no user theme switch.
4. **Enforceable.** Every rule below is checkable by tooling. The FE-01 mechanisms
   are kept and re-pointed: the allowlist lint `no-generic-tailwind` and the
   build-time resolver `checkTokenResolution` (audit §6, §25 KEEP).
5. **Contrast is a property of token pairs, verified at build time**, not a
   review comment.

---

## 2. Layers

```text
L0  REFERENCE      raw values: the locked palette, font families, raw scales
                   ─ never referenced by components ─
L1  BRAND          identity: brand.gold, brand.charcoal, brand.offWhite, brand.warmGray,
                   brand.type.display …
L2  SYSTEM         environment-resolved roles: surface.*, text.*, rule.*, focus.*,
                   signal.attention, space.*, radius.*, motion.*, layer.*
L3  PRODUCT STATE  grammar truth: verdict.*, tense.*, state.*, action.*
L4  COMPONENT      Phase 3 only; derived from L2 + L3; never from L0 or L1 directly
```

**Reference rules (enforced by lint in Phase 2)**

| From | May reference | May NOT reference |
|---|---|---|
| L1 BRAND | L0 | L2, L3, L4 |
| L2 SYSTEM | L0, L1 | L3, L4 |
| L3 PRODUCT STATE | **L0 only** | **L1** (never alias brand), L2, L4 |
| L4 COMPONENT | L2, L3 | L0, L1 |
| Components (code) | L2, L3, L4 | L0, L1 |

The key rule is **L3 → L0 only**. `verdict.reallocate.mark` and `brand.gold` each
point to the raw value independently. If a future ruling changes brand gold,
REALLOCATE does not move, and the reverse also holds.

---

## 3. Categories

| Category | Layers | Notes |
|---|---|---|
| **color** | L0 palette; L1 brand | the 4 neutrals + gold (🔒) and the 6 verdict values (🔒) as raw references |
| **semantic color** | L2 system; L3 product state | surfaces, text, rules, focus, attention signal; verdict marks, tense, state expression, action kind |
| **typography** | L0 families; L2 roles | 3 locked families; roles, not sizes, are consumed |
| **spacing** | L0 scale; L2 relational tiers | tiers by relationship (inline · metadata · object · section · macro) |
| **radius** | L2 | by element kind (structural · control · overlay) |
| **border** | L2 | rules by function (divider · structure · input · focus) |
| **shadow** | L2 | one functional overlay shadow; no scale; no glow |
| **motion** | L2 | named durations and curves by purpose (MOTION_RULES.md) |
| **breakpoint** | L2 | content-driven layout modes, not device names |
| **z-index** | L2 | semantic layers, closed set |

---

## 4. Brand tokens vs product-state tokens

### 4.1 L0 reference palette 🔒

```text
ref.color.gold        #D4A017
ref.color.charcoal    #0B0F14
ref.color.offWhite    #F7F7F3
ref.color.warmGray    #E6E2DA

ref.color.kill        #C74646
ref.color.hold        #D97732
ref.color.scale       #3D9B6D
ref.color.watch       #3B82F6
ref.color.refresh     #B7791F
ref.color.reallocate  #D4A017      ← equal VALUE to ref.color.gold, separate NAME (FC-2)
```

`ref.color.reallocate` is declared separately from `ref.color.gold` on purpose,
even though the values are equal. A lint rule forbids declaring either one as an
alias of the other.

### 4.2 L1 brand tokens

```text
brand.gold          → ref.color.gold        jobs: LUMI mark; signal.attention source
brand.charcoal      → ref.color.charcoal
brand.offWhite      → ref.color.offWhite
brand.warmGray      → ref.color.warmGray
brand.type.display  → Space Grotesk
brand.type.ui       → Inter
brand.type.data     → JetBrains Mono
```

### 4.3 L3 product-state tokens

```text
verdict.kill.mark         → ref.color.kill
verdict.hold.mark         → ref.color.hold
verdict.scale.mark        → ref.color.scale
verdict.watch.mark        → ref.color.watch
verdict.refresh.mark      → ref.color.refresh
verdict.reallocate.mark   → ref.color.reallocate      (never → brand.gold)

tense.now.*               label + text treatment for current assessment
tense.atDecision.*        label + text treatment for stored decision

state.<STATE>.*           expression tokens per STATE_RULES.md state
                          (e.g. state.notMeasured.text, state.failed.rule)
                          — no state token is ever a verdict colour or gold

action.platform.*         weight/treatment for "LUMI will do this"
action.record.*           weight/treatment for "I did this"
                          — neither references a verdict token
```

**Deliberately absent**

| Absent token | Why |
|---|---|
| `verdict.*.text` | verdict words are neutral text (📏 KILL 4.02 : 1 on Charcoal) |
| `verdict.*.fill` for text containers | no neutral reaches 4.5 : 1 on a KILL fill |
| `verdict.*.glow` | glow is forbidden |
| `verdict.unknown` | an unknown verdict is a refusal, not a colour (audit P0-14) |
| `color.success` / `color.danger` / `color.warning` / `color.info` | these generic status names invite verdict colours to be reused for unrelated meaning. Any state that needs a tone gets it through `state.*` by an explicit mapping reviewed against CMP-09 |

### 4.4 Naming rules

- **No hue names in L2 or L3.** `verdict.watch.mark`, never `blue`. The WATCH
  value equals a stock framework blue (ANTI_CONVERGENCE.md F-16).
- **No ordinal importance names** (`primary`, `secondary`, `accent`) in colour
  tokens. They become "whatever is important" and re-create the gold-for-everything
  failure. Text and surfaces use **light steps** (§6).
- Names state a **job**: `signal.attention`, `rule.divider`, `focus.ring`.

---

## 5. Environments (🔒 PR-9)

L2 tokens resolve per environment. L0, L1 and L3 values do not change between
environments. L3 **usage** is constrained per environment by contrast (§8).

```text
env.product     ground = charcoal     (authenticated app)
env.marketing   ground = offWhite     (landing, public pages)
env.marketing.section.dark   ground = charcoal   (controlled Charcoal sections)
```

There is no `prefers-color-scheme` switch and no user preference. The
environment is chosen by **route family** (authenticated vs public), not by the
viewer.

---

## 6. Light steps — deriving neutrals without inventing colours (🧪)

The palette has four neutrals. The product needs more tonal steps (surfaces,
rules, secondary and tertiary text). **No new grey gets an identity of its own.**

**Proposed derivation**

```text
env.product:    step(n) = offWhite at alpha(n) over charcoal
                (warmGray may replace offWhite for structural rules, where a warmer line is wanted)
env.marketing:  step(n) = charcoal at alpha(n) over offWhite
```

`n` is a small closed ladder, proposed as 5 steps. Each step is assigned by role:

| Role | Expected light |
|---|---|
| `text.claim` (verdict word, decision sentence) | highest |
| `text.body` | high |
| `text.meta` (windows, bases, ids, clocks) | lower, never below the legibility contrast |
| `rule.structure`, `rule.divider` | low; non-text 3 : 1 only where the rule is the **only** indicator of a boundary; decorative dividers are exempt from 1.4.11 |
| `surface.reading`, `surface.overlay`, `surface.inset` | low, distinct from ground |

Phase 2 **must**:

1. compute the resulting solid colour of every step;
2. publish it as a resolved value for tooling;
3. verify every text step at ≥ 4.5 : 1 against every surface it can sit on;
4. verify every verdict mark at ≥ 3 : 1 against every surface it can sit on.

Alpha is a derivation method, not a runtime translucency. Resolved tokens are
emitted as solid values, so no glass effect is possible.

---

## 7. Spacing — relational tiers (🧪)

Spacing tokens are named by **relationship**, not size:

```text
space.inline     within one statement (word ↔ mark, value ↔ unit)
space.meta       a value and its window / basis / clock
space.object     stages of one Decision on the spine
space.section    distinct questions on a surface
space.macro      distinct regions
```

**Proposed values** (a 4 px base, doubling per tier):

| Tier | Default | Compact |
|---|---|---|
| inline | 4 | 4 |
| meta | 8 | 4 |
| object | 16 | 8 |
| section | 32 | 16 |
| macro | 64 | 32 |

Why doubling: each tier must be visibly further apart than the one inside it,
or proximity stops encoding relationship (Constitution Article 14). A doubling
rhythm keeps adjacent tiers unambiguous.

Compact mode steps down one tier for operational lists only (Constitution
Article 15). Raw scale values (`ref.space.1…n`) exist in L0, and components
consume only the tiers.

---

## 8. Contrast obligations built into the architecture (📏)

Instrument: WCAG relative luminance, with controls reproduced (21.00 / 1.00).

| Pair | Ratio | Architectural consequence |
|---|---|---|
| verdict marks on Charcoal | 4.02–8.09 | allowed as marks (≥ 3 : 1) |
| KILL on Charcoal as text | 4.02 | **no `verdict.*.text` tokens** |
| Gold on Off White | 2.21 | `brand.gold` has **no text or mark use in `env.marketing`** outside dark sections |
| HOLD on Off White | 2.95 | verdict marks are **excluded from `env.marketing`** outside dark sections |
| Charcoal / Off White on a KILL fill | 4.02 / 4.45 | **no text-on-verdict-fill tokens** |
| HOLD–REFRESH ΔE (deutan / protan) | 5.1 / 7.4 | every verdict token is consumed only with its word (lint: a `verdict.*.mark` usage requires an adjacent verdict label in the component contract) |

**Phase 2 build check (proposed).** A token-pair manifest declares every
`(foreground, background)` pair the system allows. The build fails if any
declared pair falls below its WCAG threshold. Undeclared pairs are not usable.

---

## 9. Other categories (🧪 proposals for Phase 2)

### Typography

- Families 🔒:
  - `brand.type.display` Space Grotesk;
  - `brand.type.ui` Inter;
  - `brand.type.data` JetBrains Mono.
- **Roles** (L2), consumed instead of sizes:
  - `type.surfaceTitle`
  - `type.sectionTitle`
  - `type.claim` (verdict word + decision sentence)
  - `type.body`
  - `type.label`
  - `type.meta`
  - `type.figure` (mono, tabular numerals)
  - `type.identifier` (mono)
  - `type.navigation`
  - `type.control`
- Proposed legibility floor: no role below **12 CSS px**; `type.claim` never
  smaller than `type.body`.
- Weights shipped are exactly the weights the roles use.
- **Glyph coverage:** the stack must declare an Arabic-capable fallback for data
  strings. It is a coverage face, not a brand face. Phase 2 names it.

### Radius

| Token | Proposed | Used by |
|---|---|---|
| `radius.structural` | 0 | regions, tables, rules, spine |
| `radius.control` | 2 px | buttons, inputs, verdict marks |
| `radius.container` | 4 px | Article 17 containers, overlays |

No token above this set. No pill token. `radius.round` exists only for elements
round by meaning (avatar, radio).

### Border

| Token | Use |
|---|---|
| `rule.divider` | separates |
| `rule.structure` | aligns, carries the spine |
| `border.input` | input boundary; must meet 3 : 1 |
| `focus.ring` | neutral, high contrast, never gold, ≥ 3 : 1 on every surface; proposed width 2 px with an offset |

### Shadow

- `shadow.overlay` — the single functional shadow for menus, popovers and
  dialogs.
- No other shadow tokens. The six legacy glow tokens have **no successor**.

### Motion

| Token | Proposed |
|---|---|
| `motion.duration.feedback` | ≤ 100 ms |
| `motion.duration.reveal` | 160–240 ms |
| `motion.duration.transition` | 200–320 ms |
| `motion.duration.max` | 400 ms |

- Curves: `motion.curve.reveal` (decelerate), `motion.curve.transition`
  (ease-in-out), `motion.curve.feedback` (near-linear).
- No bounce, elastic or spring tokens.
- Each motion token carries a `reduced` counterpart (MOTION_RULES.md MO-7).

### Breakpoint

- Layout modes: `layout.mobile`, `layout.tablet`, `layout.laptop`,
  `layout.desktop`.
- **Values are measured, not chosen.** Phase 2 and Phase 3 set each boundary at
  the width where the Decision Spine plus its evidence column stops fitting
  without truncating the verdict or reason (Constitution Article 25).
- Legacy breakpoint values are not inherited.

### Z-index

A closed semantic set, in order:

| Layer | Content |
|---|---|
| `layer.base` | page content |
| `layer.sticky` | sticky headers, sticky action group on mobile |
| `layer.navigation` | persistent navigation and mobile menu |
| `layer.overlay` | menus, popovers |
| `layer.modal` | dialogs and their backdrop |
| `layer.announcement` | toasts / live-region visuals |

No numeric z-index outside these tokens.

---

## 10. Migration from legacy tokens

The legacy token system is **not mapped value-for-value**. It is disposed of
by category after the new tokens exist.

| Legacy (audit §6, §7) | Disposition |
|---|---|
| `client/design-system/tokens/colors.json`: 13 groups; `#F59E0B` both brand accent and HOLD; `#F6C945` both brand and "verified" | **replaced**. Values do not carry over; the single-source JSON **mechanism** is kept |
| `surface-*` / `dark-*` / `lumi-*` / `signal-*` / `trend-*` / `stage-*` / `radar-*` / `intel-*` / `verdict-*` namespaces; 5 CSS-variable namespaces in `index.css` | **removed** after surfaces migrate; no aliases to new names (aliases would re-import meanings) |
| `tokens/typography.json` (8-step scale, 10 CSS roles) + React typography primitives | **replaced** by L2 type roles |
| `tokens/spacing.json`: named levels not wired; 6 radii; 11 shadows incl. 6 glows | **replaced**; glows have no successor |
| `tokens/motion.json` | **replaced** by purpose-named motion tokens |
| `index.css` hand-restated `:root` variables, `.btn-gold`, glass vars | **replaced**; the global reduced-motion override is kept |
| `design-system/lint/no-generic-tailwind.js` (allowlist) | **kept as mechanism**, re-pointed at the new token names |
| `client/scripts/checkTokenResolution.js` | **kept as mechanism**; extended with the §8 contrast-pair manifest |
| `design-system/signals/signals.js` (unknown → HOLD), `DecisionPill.verdictConfig` | **removed** after the verdict primitive exists; no unknown → default mapping survives |

The old and new systems may coexist **only** as migration infrastructure
(brief §37). New code never imports a legacy token. Legacy code is removed
surface by surface after behavioural parity (Constitution Article 37).

---

## 11. Phase 2 entry conditions

Phase 2 (DESIGN TOKENS) may begin only when:

1. **Review Gate G-1 is approved** (design-governance/REVIEW_GATE.md).
2. ✅ *Done in Phase 1.5.* **`CLAUDE.md` authority pointers are updated** to
   `design-governance/` through a governance change (⚠️ FC-9). Otherwise every
   session is still instructed that `client/design-system/tokens/*.json` and
   `TAXONOMY-FREEZE.md` are authoritative.
3. ✅ *Done in Phase 1.5.* **The Master Build Spec is available to the reviewer**
   (`design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`) for the diff that
   the Phase 1 documents could not perform (⚠️ FC-10).
4. 🔒 **FC-13 RULED (Omar, 2026-09-14).** Verdict colours are the six PR-6 values
   (§4.1). There is **no reversion** to the implementation colours
   `#EF4444 / #F59E0B / #10B981`. Phase 2 may produce the spec's KEEP / MERGE /
   RENAME / DEPRECATE / ADD **inventory** of legacy tokens, but the inventory never
   supplies a verdict value (Constitution Appendix A.1).
5. 🔒 **Logo (Omar, 2026-09-14).** The missing "01 / Current Base" source blocks
   brand implementation, **not** this token architecture.

## 12. Phase 2 open decisions

These decisions are not taken here:

- light-step alpha ladder and resolved values (§6);
- spacing base and tier values (§7);
- type role sizes, line heights, weights, and the Arabic coverage face (§9);
- radius, focus ring and motion values (§9);
- breakpoint measurements (§9);
- whether tokens are authored in JSON (existing mechanism) or another format that
  compiles to CSS variables plus Tailwind. The architecture above is
  format-independent.
