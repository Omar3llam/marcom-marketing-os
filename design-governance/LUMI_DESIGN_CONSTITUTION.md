# LUMI DESIGN CONSTITUTION

```text
Status      FOUNDATION — Phase 1 deliverable, awaiting Review Gate G-1 (REVIEW_GATE.md)
Date        2026-09-14
Base        a3ec116 (no application, backend, token or style file changed by Phase 1)
Supersedes  every historical frontend / design document listed in README.md §4 (PR-13)
Audience    designers · Claude Code · frontend engineers · future contributors
```

This document is self-contained. It does not assume knowledge of the
conversations that produced it. Where a rule rests on an earlier ruling or on
backend code, the source is named so it can be checked.

**How to read the markers used throughout**

| Marker | Meaning |
|---|---|
| 🔒 LOCKED | Fixed by a Product Owner ruling or by the locked Product Constitution. Changing it requires a new ruling, not a design preference. |
| ⚖️ CONSTITUTIONAL | Authored in Phase 1. Binding once Review Gate G-1 approves this document. |
| 🧪 PROPOSED | A starting value or direction for Phase 2 to verify and lock. Not binding. |
| 📏 MEASURED | A number computed from the locked values with a stated instrument. |
| ⚠️ FC-n | A foundation conflict found in Phase 1. Registered in Appendix A, never resolved silently. |

**Ruling namespaces.** Several ID schemes use the letter R. Always qualify:

| Written as | Means | Where it lives |
|---|---|---|
| **Constitution R-n** | B6-02 Product Constitution articles (R-1 assessment vs decision, R-2 decision-first grammar, R-3 three Decision classes, R-4 absence vocabulary, R-5 memory altitude, R-6 learning provenance, R-8 connector readiness) | locked, 2026-09-01 |
| **PR-n** | Phase 0.5 Product Owner Rulings PR-1…PR-13 (Omar, 2026-09-14) | README.md §3 |
| **B7 Ruling n**, **R-A…R-F**, **R-N1…R-N4** | Information-architecture rulings | locked, 2026-09-02…06 |
| **B8-0n** | State and UI-system rulings | locked, 2026-09-01…06 |
| **C-nn** | Contract programme slices | closed at `48ab50b` |
| **P0-nn**, **Q-n** | Findings and questions in `DESIGN_SYSTEM_AUDIT.md` | Phase 0 |

Omar's Phase 0.5 message numbered its rulings R-1…R-13. Those numbers collide
with the Constitution's R-1…R-8 (for example, his "R-3 State Ownership" is not
Constitution R-3 "three Decision classes"). They are renamed **PR-1…PR-13**
here, with no change to their content (⚠️ FC-1).

---

## Part I — Identity

### Article 1 · Brand Core 🔒

> **LUMI — clarity that leads to a decision.**

LUMI is not a reporting tool that happens to have opinions. It is a system
whose output is a **call**: a verdict about a campaign, committed as a Decision,
acted on, measured, and remembered. Everything visual exists to make that call
legible, and to make its grounds inspectable.

The identity starts from the approved logo, **01 / Current Base**. It is refined
and systemised, not replaced (🔒). Its direction and variants are in
VISUAL_BOUNDARIES.md §5.

### Article 2 · Brand Idea 🔒

> **LIGHT REVEALS WHAT MATTERS.**

Light here is a **behaviour of the interface**, never a picture. It means:

- what matters most on a surface is the most illuminated thing on it;
- what supports it is present but receives less light;
- what is unknown keeps its **structure** (its place, its label, its reason)
  but is **not lit**, so it can never be mistaken for a value;
- the single point that needs the operator is marked by **signal**, not by
  decoration.

A lamp, a bulb, a sun, a glow, a lens flare or a beam is the literal reading of
this idea, and it is forbidden (VISUAL_BOUNDARIES.md).

### Article 3 · Product Promise 🔒

> **CLARITY TURNS COMPLEXITY INTO DECISIONS.**

### Article 4 · Positioning 🔒

> **VERDICTS. NOT DASHBOARDS.**

The interface opens with the call, not with an instrument (B8-01). A chart, a
table or a KPI strip is never the reason a LUMI screen exists; it can only be
evidence for a claim the screen is already making.

### Article 5 · Product Model 🔒

```text
DATA → EVIDENCE → VERDICT → DECISION → ACTION → OUTCOME → MEMORY
                                                              │
                                  (confidence only) ◄─────────┘  FUTURE ASSESSMENT
```

The model has **two orders**, and the interface uses both deliberately.

- **Production order** is the arrow above: how LUMI comes to know something.
- **Reading order** is how a person meets it (the Core Relationship, Article 8):
  `VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY`. The call comes first
  and the grounds follow it. Data is never the entry point.

The feedback edge is narrow, and the narrowness is constitutional: **memory may
adjust a live assessment's confidence, never its verdict** (Constitution R-1).
No visual may suggest that remembered patterns rewrite a call.

Current truth and history are separate objects (PR-1, Constitution R-1):

```text
            CURRENT TRUTH                         HISTORY
     Assessment  (NOW, recomputed)          Decision  (THEN, committed)
                     └──────────────┬──────────────┘
                                 ACTION   bound to a Decision id (PR-2)
                                    │
                             EXECUTE  only if supported by the backend
                                    │
                        OUTCOME → LEARNING → MEMORY
```

---

## Part II — Grammar

### Article 6 · Product Grammar ⚖️

The first-class design objects are:

```text
VERDICT · REASON · EVIDENCE · DECISION · ACTION · OUTCOME · MEMORY · ATTENTION · MEASUREMENT
```

The supporting objects are `Metric · Chart · Table · Filter · Navigation · Container`.

**A supporting object never appears on its own authority.** Each one must serve
a named first-class object on the same surface. A table of campaigns with no
claim above it, or a chart with no question, fails this article.

Full definitions, user questions, allowed states and failure modes live in
**PRODUCT_GRAMMAR.md**, which is part of this constitution.

### Article 7 · Surface Principle 🔒

Every LUMI surface answers, in this order, as many of these questions as it
has facts for, and **no others**:

```text
What matters?  →  What did LUMI conclude?  →  Why?  →  What supports it?
      →  What should happen?  →  What happened?  →  What did we learn?
```

A question without a fact on a given surface does not get an empty heading
(B8-03: "a section with no fact does not appear"). A question with a
**measured absence** does appear, because a measured absence is a fact
(STATE_RULES.md).

### Article 8 · The Core Relationship — the Decision Spine ⚖️

```text
VERDICT ─┬─ WHY ─┬─ EVIDENCE ─┬─ ACTION ─┬─ OUTCOME ─┬─ MEMORY
```

The six stages are **one object read in sequence**, not six cards. The
constitutional expression is the **Decision Spine**.

1. **One continuous axis.** The stages hang off a single structural line (a
   rule, not a border around each stage). Vertical on narrow and reading
   layouts; the axis may turn horizontal only where the full sequence fits
   without truncating the verdict or the reason.
2. **Illumination decreases along the spine.** The verdict and its reason carry
   the most light; evidence carries less; metadata least (Article 11).
3. **Stages are conditional on facts.** A stage renders when it has a fact or a
   measured absence. A stage that a Decision class never produces does not render
   at all. Example: a Guardrail has no hypotheses, so no "why" hypotheses section
   appears (B7-04 R-E). This is different from a stage that is empty.
4. **The spine shows where a Decision is in its life.** An open Decision with no
   action yet ends at ACTION, and does not draw placeholder OUTCOME or MEMORY
   stages. An outcome that was looked for and not yet observable is a measured
   state (OutcomeEvidence `NOT_OBSERVED`), and it renders as one.
5. **Every deeper layer names the claim that brought you there** (B8-04). The
   spine is the only legitimate path from a claim to its evidence. An entity
   tree is never navigation (Constitution R-2, B7-05).

### Article 9 · Tense ⚖️ (bounded by 🔒 PR-1, Constitution R-1, B7-04 R-F, B7-06)

Every verdict shown is in exactly one tense, and the tense is **always visible**.

| Tense | Object | Marker | May carry controls? |
|---|---|---|---|
| **NOW** | current assessment (Signal class only) | label `NOW` + computed-at time | **Never.** No action attaches to an assessment (B8-04 campaign lens; PR-1). |
| **AT DECISION** | stored Decision | label `AT DECISION` + committed time | Yes, where the backend offers an action for **that Decision id** (PR-2). |

When both appear for the same subject and they disagree (backend
`decisionAgreement = DIVERGES`, C-12), the surface **names the divergence as a
fact**. PR-1's own example is the canonical form:

```text
NOW            SCALE
AT DECISION    KILL
Assessment changed since this decision.
```

**Named, never diffed** (B7-06). Both readings are true, each in its own tense,
so the presentation must not suggest one is a correction of the other. This
rules out:

- an arrow or transition glyph from one verdict to the other;
- strikethrough, fading or de-emphasising the older reading;
- delta colouring between the two;
- "was → now" copy;
- and any layout that asks the operator "which is right?"

When agreement is `NOTHING_THERE` (no stored decision), only NOW renders, and
there is nothing to act on. When it is `COULD_NOT_LOOK`, the surface says it
could not establish agreement; it does not assume `AGREES`
(`src/services/verdict-engine/decisionAgreement.js:82-96`).

⚠️ FC-5 records why this reading of PR-1 is consistent with B7-06.

---

## Part III — Visual Foundation

### Article 10 · Visual Territory 🔒

> **STRUCTURE + LIGHT + NEGATIVE SPACE + SIGNAL**

| Element | Meaning | Constitutional expression |
|---|---|---|
| **STRUCTURE** | order, hierarchy, analytical clarity | a visible rule system — hairlines, alignment columns, the Decision Spine — carries grouping instead of boxes |
| **LIGHT** | reveal, focus, visibility | illumination hierarchy (Article 11): importance is luminance on charcoal, not size alone and never glow |
| **NEGATIVE SPACE** | cognitive room, prioritisation, calm | distance encodes relationship (Article 14); the space around the verdict is the largest on its surface |
| **SIGNAL** | decision, attention, action | gold marks the one point that needs a person; verdict colour marks the call; neither decorates |

Required feel: precise · intelligent · decisive · calm · analytical · focused ·
operational · confident · evidence-led · distinctive.

**Visual Boundaries 🔒 (summary; full law in VISUAL_BOUNDARIES.md)**

| | |
|---|---|
| **Approved** | structure · light · negative space · signal · architectural composition · controlled contrast · warm gold · calm precision |
| **Forbidden** | generic AI aesthetic · cyberpunk · neon · sci-fi UI · glassmorphism · decorative gradients · excessive or decorative glow · AI orbs · magic / sparkle iconography · literal lamps, light bulbs, sun imagery · generic chat UI · chat-first UX · dashboard wallpaper · decorative charts · huge rounded-card grids · generic dashboard aesthetic |

Every forbidden item has recognisable signals, so a reviewer can point at a
pixel and name the rule.

### Article 11 · Illumination Hierarchy ⚖️

This is LUMI's defining visual mechanism and the main reason the system is
identifiable without its logo.

1. **Ground.** The product environment is Charcoal `#0B0F14` (PR-9). Nothing sits
   above the ground on a shadow. Things are *lit* out of it.
2. **Steps of light.** Neutral surface and text tones are **derived only** from
   the four locked neutrals. On charcoal, a step is Off White or Warm Gray at a
   defined strength. There are no additional greys with their own identity
   (🧪 derivation method: DESIGN_TOKEN_ARCHITECTURE.md §6).
3. **Light follows the claim, not the container.** The verdict and the sentence
   that states it are the most lit elements on a surface. Reasons are next.
   Evidence, windows and bases step down. Identifiers and timestamps step down
   again, but never below the legibility floor (Article 21).
4. **Unknown is structure without light.** A value that is absent keeps its slot,
   its label and its named reason. The slot is not filled with a lit
   placeholder, a zero, or a skeleton that looks like content (STATE_RULES.md).
5. **Distinct from elevation conventions.** Many dark interfaces lighten surfaces
   to fake physical height. LUMI does not model height. Light encodes **how much
   a thing matters to the call**, so a small verdict word may be brighter than a
   large panel behind it.

### Article 12 · Color Philosophy 🔒 values · ⚖️ usage

**Brand palette 🔒**

| Token role | Value | Meaning |
|---|---|---|
| LUMI Gold | `#D4A017` | signal · attention · decision |
| Charcoal | `#0B0F14` | depth · focus · stability |
| Off White | `#F7F7F3` | clarity · clean space |
| Warm Gray | `#E6E2DA` | structure · balance |

**Verdict palette 🔒 (PR-6)**

| Verdict | Value |
|---|---|
| KILL | `#C74646` |
| HOLD | `#D97732` |
| SCALE | `#3D9B6D` |
| WATCH | `#3B82F6` |
| REFRESH | `#B7791F` |
| REALLOCATE | `#D4A017` |

No further verdict colours may be created without a product or design ruling.

**Usage law ⚖️**

1. **Brand is not state.** Brand tokens and product-state tokens are separate
   categories with separate names, even where a value is shared
   (DESIGN_TOKEN_ARCHITECTURE.md §4). This ends the defect in which the brand
   accent `#F59E0B` was also HOLD (audit P0-15).
2. **Gold has three permitted jobs, and only three:**
   - the LUMI mark;
   - the single attention signal in a region;
   - the REALLOCATE verdict mark.

   Gold is **not** any of the following:
   - a button fill by default;
   - a link colour;
   - a focus ring;
   - a success colour;
   - a border around important cards;
   - a gradient;
   - a glow;
   - a background wash.

   ⚠️ FC-2 explains why REALLOCATE sharing brand gold is acceptable under PR-6,
   and what keeps them apart.
3. **One gold signal per region.** If two things in the same region claim gold
   attention, the region has not decided what matters, and that is a
   composition defect.
4. **Colour never carries meaning alone** (WCAG 1.4.1). A verdict is always
   its **word** plus its mark (📏 Article 21 shows why this is a hard
   requirement for the locked palette).
5. **Verdict colour never colours an action.** A KILL-red "Pause" button fuses
   the verdict with the action, which PR-5 forbids (`Verdict ≠ Action`). Action
   controls take neutral, structural styling. The verdict mark sits on the
   Decision, and the control sits in the Action group.
6. **No hue names in semantic tokens.** WATCH's value is also a very common
   framework default blue. The token is `verdict.watch`, never `blue-500`, so the
   palette cannot quietly converge with a stock framework (ANTI_CONVERGENCE.md).
7. **No decorative colour.** No gradients, tints used for mood, rainbow
   categories, or colour-coded tags without a semantic owner.

### Article 13 · Theme and Environments 🔒 (PR-9)

| Environment | Ground | Character |
|---|---|---|
| **Product** (authenticated LUMI) | Charcoal, dark-first | focus · signal · operational calm |
| **Marketing** (landing and public pages) | Off White, light-first, with **controlled** Charcoal sections | clarity · space |

- **One language, two environments.** Typography, geometry, the rule system,
  the Decision Spine, the signal logic and the light metaphor are identical.
  Only the ground changes.
- **No theme switch in V1.** There is no Light / Dark / System preference. LUMI
  owns its environment.
- **Consequence for marketing (📏 Article 21).** On Off White, Gold and HOLD fall below
  3:1 as non-text marks, and no verdict colour reaches 4.5:1 as text. Any verdict
  depiction on marketing pages therefore sits inside a **Charcoal section**, where
  every verdict mark clears 3:1.

### Article 14 · Layout Philosophy ⚖️

1. **Distance is relationship.** Five spatial tiers, from tightest to loosest:
   - **inline** — within a single statement;
   - **metadata** — a value and its window, basis and time;
   - **object** — the stages of one Decision;
   - **section** — separate questions on a surface;
   - **macro** — separate regions.

   A larger tier is never used inside a smaller relationship. 🧪 A doubling rhythm
   is proposed in DESIGN_TOKEN_ARCHITECTURE.md §7.
2. **Grouping by structure first.** Prefer, in this order: alignment → spacing
   tier → hairline rule → typographic change → container. A container is the
   last resort (Article 17).
3. **The call leads the page.** The first readable statement on a decision-bearing
   surface is a claim, not a filter bar, tabs, or a metric row.
4. **Columns follow the spine.** On wide layouts the primary column carries the
   Decision Spine. A secondary column may carry evidence detail for the selected
   stage, but never an unrelated dashboard panel.
5. **No wallpaper.** No background grids, textures, noise, particles or
   decorative line art. The only visible lines are rules that separate or align
   real content.

### Article 15 · Density ⚖️

Density is a property of the **object**, not of the page.

| Object | Density | Why |
|---|---|---|
| Verdict + Reason | open | this is the call; it needs room to be read as a sentence |
| Evidence | medium | a set of measurements, each with its window and basis |
| Operational lists (connectors, executions, admin) | compact | many parallel facts, scanned rather than read |
| Measurement metadata | compact but legible | windows, bases and clocks must not be dropped for space |

A compact surface may reduce spacing tiers by one step. It may never:

- drop a window or basis;
- truncate a verdict word;
- fall below the legibility floor;
- merge two states into one to save space.

### Article 16 · Surfaces ⚖️

A surface is a region of ground that holds one question from Article 7.

- There is a small, closed set of surface steps derived from the neutrals
  (Article 11), assigned by **role**:
  - ground;
  - reading surface;
  - overlay (menu, dialog);
  - inset (code, identifiers).

  Roles are never assigned by taste.
- Overlays are the only surfaces that genuinely sit **above** content, and the
  only place a functional shadow is permitted (Article 18).
- No translucency, frosted blur or glass (VISUAL_BOUNDARIES.md). A dialog
  backdrop is a flat dimming layer, not a blur.

### Article 17 · Cards ⚖️

**Cards are not the default layout primitive.** A bounded container is
justified only when the region is one of the following:

1. **a meaningful object** — one Decision, one experiment, one belief in Memory;
2. **an evidence group** — measurements that share one population and window;
3. **a decision group** — Decisions that share an Attention partition;
4. **an action group** — the controls that act on one Decision;
5. **a genuine information boundary** — for example, a region that can be
   independently unavailable.

A grid of equal containers that differ only by content ("card card card card")
fails this article. So does a container used to make a region look important.

The full test is COMPONENT_RULES.md CMP-04.

### Article 18 · Borders and Elevation ⚖️

- **Rules over boxes.** A hairline rule separates and aligns. A full border that
  encloses content is reserved for Article 17 containers, focus, and inputs.
- **Structure, not ornament.** Borders never glow, gradient, animate, or take a
  verdict or brand colour to signal importance.
- **Elevation is not a scale.** There is no shadow ladder. There is one functional
  shadow, for overlays that float over content (menu, popover, dialog), so they
  do not merge into what they cover. Glow shadows are forbidden. The six
  legacy glow tokens are removed in migration (audit §10).

### Article 19 · Radius ⚖️

Radius communicates **what kind of thing** an element is, not modernity.

| Kind | Radius direction 🧪 |
|---|---|
| structural regions, tables, rules, spine | square |
| controls and marks (buttons, inputs, verdict mark) | minimal |
| overlays and Article 17 containers | small |

- No large radii on containers.
- No pill as a default badge or button shape.
- A fully round shape is allowed only for elements that are round by meaning
  (an avatar, a radio control).

Values are locked in Phase 2.

### Article 20 · Typography 🔒 families · ⚖️ usage

| Family | Role |
|---|---|
| **Space Grotesk** | display · headlines · major titles · brand expression |
| **Inter** | UI · body · navigation · forms · operational copy |
| **JetBrains Mono** | metrics · identifiers · technical values · data-heavy contexts |

**The wordmark is not typeset.** The LUMI wordmark is custom vector artwork, and
no family above reproduces it.

**Usage law ⚖️**

1. **Every figure is set in JetBrains Mono with tabular numerals**, and every
   figure carries its window (B8-01 L-6: a figure without a window does not
   appear). Mono is a promise that a value is a measurement.
2. **Space Grotesk is rare.** It is used for surface titles and brand moments,
   never for dense UI, table cells or verdict words.
3. **The verdict word is set in Inter**, at a weight and size that makes it
   the most legible word in its region, in a neutral high-contrast tone. Its
   colour mark sits beside it (Article 12 §4, §5).
4. **One typographic API.** There are roles, not ad-hoc sizes. There are no
   arbitrary pixel sizes (the audit found 9 px and 10 px verdict labels, P0-32).
5. **Legibility floor.** 🧪 No readable text below 12 CSS px, and verdict words
   never below the body size. Phase 2 locks the figures.
6. **Declarative voice.** Doubt lives in a number, not in hedged phrasing (B8-01
   L-3). Typography must not simulate uncertainty through fading or italics.
7. **Glyph coverage (open, 🧪).** The UI is English. MENA account data (campaign
   names) can contain Arabic, and PDF export already embeds Noto Naskh Arabic
   (`client/src/lib/pdfExport.js:222`). None of the three locked families covers
   Arabic. Phase 2 must declare a coverage fallback in the stack. This is not a
   fourth brand typeface; it exists only to cover Arabic glyphs.

### Article 21 · Accessibility ⚖️ — WCAG 2.2 AA where practical

Accessibility is a design input, not a polish step.

**Obligations**

- **Text contrast** 4.5:1; large text (≥ 24 px, or ≥ 18.66 px bold) 3:1 (1.4.3).
- **Non-text contrast** 3:1 for marks, focus indicators and control boundaries
  (1.4.11).
- **Use of colour.** Never the only carrier of meaning (1.4.1).
- **Keyboard.** Everything operable by keyboard (2.1.1), with no traps
  (2.1.2) and a logical focus order (2.4.3).
- **Focus.** Visible (2.4.7) and not obscured by sticky chrome (2.4.11). The
  focus ring is **not gold** (Article 12). It is a neutral high-contrast ring
  that clears 3:1 on every surface it can land on.
- **Target size.** At least 24 × 24 CSS px, or the spacing exception (2.5.8).
  Primary actions on touch layouts should exceed the minimum.
- **Semantics.** Semantic HTML, one `h1` per view, ordered headings, landmarks
  (`main` on every page — it is missing on the landing today, audit §20), labelled
  inputs, dialogs that trap focus and restore it.
- **Status.** State changes that matter (PROCESSING → SUCCESS or FAILED) are
  announced through a live region, not only drawn.
- **Motion.** `prefers-reduced-motion` is honoured for every animation
  (MOTION_RULES.md).

**📏 Measured constraints of the locked palette**

Instrument: WCAG relative-luminance contrast. Controls: black / white = 21.00 and
identical colours = 1.00, both reproduced before any value was read.

| Colour | on Charcoal | on Off White | on Warm Gray |
|---|---|---|---|
| Gold / REALLOCATE `#D4A017` | 8.09 | **2.21** | **1.84** |
| KILL `#C74646` | **4.02** | 4.45 | 3.70 |
| HOLD `#D97732` | 6.07 | **2.95** | **2.45** |
| SCALE `#3D9B6D` | 5.59 | 3.20 | **2.66** |
| WATCH `#3B82F6` | 5.23 | 3.42 | **2.85** |
| REFRESH `#B7791F` | 5.28 | 3.39 | **2.82** |
| Off White `#F7F7F3` | 17.90 | — | 1.20 |
| Warm Gray `#E6E2DA` | 14.88 | 1.20 | — |

Bold marks a value below 3:1. KILL on Charcoal is also bold because it
misses 4.5:1 as body text.

What follows from these numbers:

- **On Charcoal (product),** every verdict colour clears 3:1 as a mark. KILL
  (4.02) does not clear 4.5:1 as body text, so **verdict words are never set in
  verdict colour at body size.**
- **On Off White (marketing),** Gold (2.21) and HOLD (2.95) fail even 3:1 as marks,
  and no verdict colour reaches 4.5:1 as text. Verdicts on marketing pages live
  in Charcoal sections (Article 13). Gold is **never text on Off White.**
- **Text on a verdict fill.** On a KILL fill, Charcoal text reaches 4.02 and
  Off White 4.45. Neither neutral reaches 4.5:1, so **no body-size text on a KILL
  fill.** Verdicts are expressed as a word plus a mark, not as a filled chip with a
  word inside.

**📏 Measured distinguishability of the verdict palette**

Instrument: CIE76 ΔE in Lab. Colour-vision deficiency is simulated with Machado
et al. (2009) at severity 1.0, in linear RGB. Controls: identical colours = 0.0 and
black / white = 100.0. The simulation is an approximation; the direction of the
result is what matters.

| Pair | ΔE typical | ΔE deutan | ΔE protan |
|---|---|---|---|
| HOLD – REFRESH | 16.9 | **5.1** | **7.4** |
| HOLD – REALLOCATE | 31.1 | 15.0 | 23.3 |
| REFRESH – REALLOCATE | 21.1 | 18.0 | 19.1 |
| KILL – SCALE | 91.4 | 20.6 | 19.0 |
| KILL – REFRESH | 44.1 | 22.3 | 40.2 |

Three of the six verdicts are warm ambers, and HOLD and REFRESH become nearly
indistinguishable under deuteranopia. The locked values stand (PR-6). The
consequence is **constitutional: the verdict word is mandatory wherever a verdict
appears** (⚠️ FC-3).

### Article 22 · Iconography ⚖️

Icons must be functional, restrained, consistent, legible and semantically
meaningful.

- One icon family, one stroke logic, one size ladder.
- An icon either **names a function** (close, lock, external link, expand) or
  **labels a grammar object** with an established meaning.
- **No per-verdict pictograms.** An up-arrow for SCALE or a skull for KILL adds
  meaning the verdict vocabulary does not carry. Any verdict iconography needs a
  ruling.
- **Forbidden:**
  - AI sparkles;
  - magic wands;
  - robot heads;
  - brains;
  - neural-network motifs;
  - light bulbs, lamps, suns;
  - emoji used as UI status (audit §23: Observability `▶ ⏸ ⏳ ✖`).
- The lock icon for plan-locked capability (PR-4) is permitted, because its
  function is literal.

### Article 23 · Data Visualisation ⚖️

A visualisation is **evidence presentation**, not product identity. Before one
is built, it must answer three questions in writing:

```text
WHAT QUESTION?   the grammar question it serves (Article 7)
WHAT EVIDENCE?   the published population, window and basis it plots
WHAT DECISION?   the call it helps make or verify
```

If any answer is missing, the visualisation is not built.

Further rules:

- Every plotted series carries its window and population. Two series from
  different windows are never plotted on one axis as though comparable (#474,
  B7-05: populations stay apart).
- No derived rate is computed from a windowless aggregate (`spendMinor` never
  becomes a rate, B8-01).
- Absent points are gaps with a stated reason, never zeros or interpolated lines.
- Currency figures follow the canonical money contract: minor units, a known
  currency, and no silent USD (PR-12). Mixed currencies are never summed or
  plotted on one axis (`MIXED_CURRENCY`).
- **Forbidden:**
  - decorative charts;
  - sparklines without a claim (the legacy sidebar sparkline was removed in R7);
  - "patterns learned over time" vanity charts (B8-05);
  - KPI strips as a default header;
  - animated growth from zero (MOTION_RULES.md).

### Article 24 · Motion Philosophy ⚖️

Motion communicates **reveal, hierarchy, transition and feedback**, following
the sequence

```text
complexity → signal → clarity → decision
```

Motion is never decoration, attention farming, continuous animation, or
cinematic loading.

- A number never animates through values it did not have: **no count-up**.
- Nothing pulses to suggest that LUMI is watching. LUMI computes when you
  arrive; it does not pretend it was watching when it was not (B7-01).
- Every animation has a defined reduced-motion behaviour.

Full law: **MOTION_RULES.md**.

### Article 25 · Responsive Principles ⚖️

Desktop, laptop, tablet and mobile are **different reading situations**, not one
layout at four widths. Mobile is not "desktop, stacked".

| Principle | Desktop / laptop | Tablet | Mobile |
|---|---|---|---|
| **Navigation** | persistent axis navigation | collapsible | compact bar or menu; primary axes remain one step away |
| **Density** | full tiers | one tier tighter for operational lists | the Decision Spine stays open; operational lists become lists, not tables |
| **Tables** | allowed where CMP-05 allows | horizontally scrollable inside their own container | a table becomes a list of labelled records; no pinch-zoom tables |
| **Action priority** | Action group beside the spine | same | the **one** action available for the Decision is reachable without scrolling past its evidence; destructive or platform actions are never the easiest thumb target |
| **Evidence hierarchy** | spine + evidence column | spine, evidence below the selected stage | spine first; evidence one step deeper, named by its claim |
| **Decision readability** | verdict + reason + tense on one screen | same | verdict, tense, reason and the divergence line (if any) always fit together before any evidence |

Rules:

- Breakpoints are set where content stops fitting (the spine plus its evidence
  column), not by device names. The values are measured in Phase 2 and Phase 3.
- The page body never scrolls horizontally. Wide content scrolls inside its own
  container.
- A capability hidden at a width is still reachable at that width (audit
  §19: four `hidden sm|md|lg:` action-hiding patterns).

### Article 26 · Performance Principles ⚖️

Speed is part of clarity: a verdict that arrives late competes with nothing
but the wait.

1. **Public and app bundles are separate.** 📏 The public landing currently
   downloads the authenticated application. Its first load measured 285,365 B gzip
   (289,561 B brotli, which is what production serves), including Attention,
   Settings, Copilot and the shell (audit P0-70, verified in Phase 0.5).
2. **Fonts are budgeted by role.** Only the weights the type roles actually use
   are shipped. Adding a weight is a Phase 2 token change, not a component choice.
3. **No visual dependency without a question.** No chart, animation or effects
   library is admitted without the Article 23 or MOTION_RULES.md justification.
   There is no charting library today, so adding one is a decision.
4. **Motion uses composited properties only** (opacity, transform). Nothing
   animates layout on data arrival.
5. **Existing budget.** The repository's frontend bundle budget (`CLAUDE.md`,
   "bundle < 700KB target") stays in force until Phase 2 states the new budget as
   a measured figure.
6. **Honest loading beats fast-looking loading.** A skeleton that imitates
   content is not a performance improvement. It is a false claim (STATE_RULES.md).

---

## Part IV — Truth Obligations of the Design System

These are not visual rules. They are product truth, and the visual system must be
**incapable** of violating them.

### Article 27 · State Semantics 🔒 (PR-3, Constitution R-4, B8-02)

```text
FAILED ≠ EMPTY     EMPTY ≠ ZERO     UNAVAILABLE ≠ EMPTY
NOT_CONNECTED ≠ FAILED     UNKNOWN ≠ HEALTHY
```

- The backend and API own success, failure, availability, data presence and
  measurement state. The design system owns their **expression**.
- **No state is derived from the shape of data.**
  `loading === false && data.length === 0` is banned.
- **Token for shape, reason for copy** (B8-02). An unknown token **throws**:
  there is no safe default for an unknown epistemic position.
- States compose on **three independent axes** and must not be collapsed:
  - **knowledge** — what we know (C-06);
  - **permission** — whether we may ask (Constitution R-4);
  - **process** — what the system is doing (B7-01-B).

Full law: **STATE_RULES.md** (15 states, each with its published trigger).

### Article 28 · Numeric Truth 🔒 (PR-7)

- Every numeric claim presented as LUMI fact traces to real evidence.
- No fabricated metrics, customer counts, percentages, performance, ROI, savings
  or product statistics, on the landing page or anywhere else.
- **Illustrative** numbers are allowed only when explicitly marked "Illustrative
  example", adjacent to the numbers, at readable size, and styled so they
  cannot be mistaken for product evidence. For example, they never sit inside real
  product chrome showing a real-looking account.
- AI may state a number only if that number exists in the evidence supplied to
  it. A surface that cannot prove this renders no AI-authored numerals
  (PRODUCT_GRAMMAR.md, Copilot).
- A constant is not a measurement. Guardrail `confidence` is the constant 0.9 and
  never renders as a percentage (B8-01 L-4). `MIN_IMPRESSIONS = 1000` is a
  product threshold annotated `CALIBRATION: UNKNOWN`, and is never presented as a
  statistical bound (`src/services/verdict-engine/confidenceEngine.js:53`).

### Article 29 · Action Identity 🔒 (PR-2, PR-5)

- An action identifies the Decision it acts on, by `decisionId`.
- Where a Decision id is available, a surface never resolves "the latest decision"
  at mutation time.
- **Verdict ≠ Action.** A verdict may have no executable action. The UI never
  implies that every verdict can be executed.
- Today the only platform mutation is **KILL → PAUSE_CAMPAIGN on Meta**, carried
  out through the server's executability descriptor
  (`src/services/execution/decisionExecutability.js:31`). Every refusal carries a
  `NOT_EXECUTABLE` reason, and that refusal is the copy (B8-01 L-11).
- **Two kinds of action must be typographically unmistakable** (B8-03 invariant 9):
  - **LUMI will do this** — a platform mutation;
  - **I did this** — a human record, dismissal or judgment.

### Article 30 · Static Status 🔒 (PR-10, PR-11)

No pseudo-system-status. Every status must be real, relevant, data-backed and
understandable. With no value behind it, it does not appear.

- **Removed:** "Context: Locked", "Dual-Agent Ready", the fabricated SID fallback,
  and the static WATCHING badge (`client/src/components/layout/ContextBar.jsx:14,23,31`;
  `Sidebar.jsx:182-196`).
- **Vocabulary hazard.** `WATCH` is a verdict about a campaign. To keep it
  unambiguous, the word "watching" is not used for system liveness anywhere,
  including marketing copy. The landing capability "Always watching" (audit §22)
  also contradicts B7-01.

### Article 31 · Plan Gates 🔒 (PR-4)

```text
EXISTS + PLAN-LOCKED   →  SHOW, marked locked, with the plan that unlocks it
NOT LIVE / DEPRECATED  →  HIDE
```

- A lock is a structural state (a lock icon, the plan name, reduced light). It is
  not a gold upsell glow.
- Following a locked item leads to the existing honest gate (`PlanGate` →
  `UpgradePrompt`, B7 Ruling 3). The surface gate equals the API gate.
- **Not ruled:** role-based visibility (for example, CLIENT seats). PR-4 rules plan
  locks only, so current role gating is preserved unchanged until a ruling says
  otherwise.

### Article 32 · Copilot Boundary 🔒 (PR-8)

Copilot is a **contextual reasoning interface**. It is not the primary product,
navigation, a homepage, the decision engine, a numeric authority, an
execution authority, or a chat-first product.

- It is entered only **from** a grammar object (a Decision, an outcome, a belief).
  It inherits that object's evidence and answers questions about it.
- It never occupies layout as a persistent chat column, never becomes a nav
  destination in V1, and is never styled as a generic chat UI. That means no
  assistant bubbles, typing dots or sparkle avatars (ANTI_CONVERGENCE.md).
- The current "Coming soon" route is not built upon.

### Article 33 · Currency 🔒 (PR-12)

- **One** money formatting contract.
- The unit is explicit: minor or major.
- The currency comes from the data.
- An unknown currency is a state, never a silent `USD`.

Today two functions named `formatCurrency` take different units
(`client/src/lib/currencyFormatter.js:57` major units defaulting to `USD`, and
`client/src/lib/money.ts:69` minor units). The design system consumes only the
canonical contract.

---

## Part V — Governance

### Article 34 · Anti-Convergence Rules ⚖️

Every major component must pass the **Transfer Test** and the **Why LUMI
Test**. A FAIL on either blocks the component. Four resemblance tests (visual,
structural, behavioural, decorative) must each be answered in writing.

Full procedure: **ANTI_CONVERGENCE.md**. References: **REFERENCE_POLICY.md**.

### Article 35 · Governance ⚖️

1. **Authority order** (synchronized in Phase 1.5; `README.md` §2):
   1. **product truth** — backend / API and DB-backed behaviour;
      `LUMI_PRODUCT_TRUTH_RULINGS.md`, closed as PR-1…PR-13; the locked Product
      Constitution and B7 / B8 rulings;
   2. **design authority** — `design-governance/` and `DESIGN_TOKEN_ARCHITECTURE.md`;
   3. **Master Build Spec** — `design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`;
   4. **approved brand assets** — `design-governance/brand/`;
   5. **historical material** — legacy documents, tokens and implementation;
      `DESIGN_SYSTEM_AUDIT.md` is preserved evidence at this level.

   The spec **flows into** this constitution, and this constitution flows into
   implementation. When they conflict:
   `PRODUCT TRUTH > DESIGN CONSTITUTION > MASTER BUILD SPEC interpretation > LEGACY`.
   A conflict is registered (Appendix A), never reconciled silently.
2. **Figma is visual truth; the repository is behavioural truth.** Behaviour,
   state, routing, permissions, API, measurement, currency and data integrity are
   decided in the repository. A Figma frame can never settle one of them.
3. **This constitution changes only by recorded ruling.** A change states the rule
   replaced, the evidence, the approver and the date, in a changelog section added
   to this file.
4. **Historical documents are HISTORICAL**, not deleted (PR-13). Supersession
   does not delete evidence. See README.md §4.
5. **Product truth is not reopened in design phases** unless new evidence shows a
   ruling cannot be implemented without breaking backend or product truth.
   Inconvenience is not that evidence (B8-02 guardrail).

### Article 36 · Review Process ⚖️

- No work moves from foundation to implementation, or between later phases,
  without passing **REVIEW_GATE.md**.
- A critical NO stops the phase. The gate records its evidence and its approver.
- Self-assessment by the author is never approval.

### Article 37 · Migration and Hidden Product Logic ⚖️

**Sequence (Phase 1 brief, §37)**

```text
OLD → AUDIT → EXTRACT PRODUCT LOGIC → NEW FOUNDATION → NEW TOKENS → NEW PRIMITIVES
    → NEW DECISION OBJECTS → NEW SURFACES → REMOVE LEGACY
```

The old system survives only as migration infrastructure. It is not a design
authority, and it is not a starting palette.

**Rule.** No folder is deleted because its UI is being replaced. For each item:
identify the logic → preserve its behaviour (pinned by markup-independent tests)
→ move it to a canonical location → verify → only then remove the legacy.

**Hidden product logic register.** These live in folders that look like UI.
Source: audit §25 KEEP, §32 risks R-1 and R-8, and the Phase 0.5 corrections.

| Logic | Lives in today | Why it is product truth |
|---|---|---|
| C-07 gating reasons, two sharing `NOTHING_THERE`; unknown → `action: null` | `client/src/features/campaigns/gatingReasonCopy.js` | the wrong instruction is the defect C-07 closed |
| C-09 confidence dimensions: value + basis, three-state limiting flags | `client/src/features/campaigns/verdictEvidence.js` | `below(null) === false` once rendered UNKNOWN as GOOD |
| Execution identity routing and platform execution | `features/campaigns/{executionSignals, decisionSignals}.js`, `ConnectorCampaignsPanel.jsx:524-548`, `LumiExecute.jsx` | Meta money boundary; PR-2 target identity |
| Judgment vocabulary and terminal states | `features/campaigns/{judgmentVocabulary, useDecisionAction}.js` | human-record semantics |
| Attention derivation, plan, interrupts, account state | `client/src/features/overview/{overviewDerive, overviewPlan, overviewInterrupts, overviewState}.js` | B8-02 honest account state (FIRST_RUN writer absent since `997bcf1`) |
| Absence and confidence grammar | `client/src/design-system/states/{absence, confidence}.js`, `patterns/DetailGrammar.jsx` | locked B8 adapters; the new state primitives consume them rather than copy them |
| Outcome evidence: seven statuses plus an unrecognised branch | `client/src/features/intelligence/proof/OutcomeEvidence.jsx` | state exemplar |
| Minor-unit money | `client/src/lib/money.ts` (22 consumers) | per-currency exponent; the `/100` defect class |
| Spend-window pacing, NOT_MEASURABLE | `PacingWidget` (#474) | window must match period |
| Plan, role and route gates; redirects; OAuth return | `PlanGate`, `RoleGate`, `LockFromClient`, `RequireUserRole`, `app/routeManifest.js`, `App.jsx` redirect table | entitlement truth; deep links |
| Onboarding context fetch | `client/src/hooks/useOrchestrate/fetchers.js#fetchContext` | a live function inside an otherwise dead folder (audit risk R-8) |
| Parse layer | `client/src/contracts/schemas/*` (41), `@marcom/runtime-contracts` | B8-01; note that `ConnectorVerdictRowSchema` currently strips `decisionAgreement`, which PR-1 now requires |

---

## Appendix A · Foundation Conflicts Found in Phase 1

Registered, not silently resolved. **None blocks Phase 2**; each names what it
constrains.

| ID | Conflict | Sources | Disposition |
|---|---|---|---|
| **FC-1** | Ruling ID collision: Omar's Phase 0.5 R-1…R-13 vs Constitution R-1…R-8 (and the audit's risk IDs R-1…R-8) | Phase 0.5 closure; B6-02; audit §32 | Renamed **PR-1…PR-13** with content unchanged. All governance documents qualify every R-ID. |
| **FC-2** | REALLOCATE `#D4A017` is **identical** to brand Gold, while the brief says "do not use Gold as a substitute for semantic verdict state", and audit P0-15 recommended disjoint values | PR-6; brief §8–9; audit P0-15 | PR-6 chose this deliberately ("Gold = allocation / attention / decision signal") and outranks the audit. Kept apart by: (a) separate token names that never alias each other (DESIGN_TOKEN_ARCHITECTURE.md §4); (b) the mandatory verdict word; (c) gold limited to three jobs (Article 12). A future ruling may separate the values; the architecture already allows it without touching components. |
| **FC-3** | HOLD and REFRESH are nearly indistinguishable under colour-vision deficiency (📏 ΔE 5.1 deutan, 7.4 protan); KILL and SCALE fall from 91.4 to 20.6 / 19.0 | PR-6; WCAG 1.4.1 | Values unchanged. The verdict word is mandatory; colour is a secondary mark (Article 12 §4). |
| **FC-4** | Locked colours fail contrast in the light environment (Gold 2.21, HOLD 2.95 on Off White), and no neutral reaches 4.5:1 on a KILL fill | PR-6; PR-9; WCAG 1.4.3 / 1.4.11 | Verdict depictions on marketing pages live in Charcoal sections; no text on verdict fills; gold never text on light grounds (Articles 13 and 21). |
| **FC-5** 🔒 *RULED — Omar, 2026-09-14:* the current assessment and the stored decision may appear in the same Decision experience, but **not as a visual diff**. They are expressed as **NOW** vs **AT DECISION**, with any disagreement stated **in language** (Article 9 stands as written) | PR-1's example places NOW and AT DECISION verdicts together; B7-06 says Then/Now is "never side by side as a diff" | PR-1; B7-06; B7-04 R-F | Consistent under B7-04 R-F ("labelled and separate … never overwritten"). Divergence is **named**, never diffed: no arrows, strikethrough, delta colour or "which is right" framing (Article 9). ~~Omar should confirm this reading at G-1.~~ Confirmed 2026-09-14 (see ID column). |
| **FC-6** | The Phase 1 state list (14) omits **NOT_SUPPORTED**, which the locked B8-02 adapter produces (`absence.js:42`) | brief §21; PR-3; B8-02 | Added as the 15th state. Dropping it would collapse "does not apply" into "not permitted" or "empty". |
| **FC-7** | Account-level **NOT_CONNECTED** has no clean published trigger. `/lumi/connections` returns `connections: []` both for an unresolved workspace and for "nothing connected" (`src/routes/lumi/connections.js:38`; C-04A OPEN) | PR-3; Constitution R-4 | STATE_RULES.md marks the trigger PARTIAL. The account-level "connect a channel" instruction may not render from that read until C-04A lands. The per-connector `READINESS_STATE.NEVER_SYNCED` is published and usable. |
| **FC-8** | PR-2's "ENTITY ACTION when no Decision exists" has **no backend contract**. Execution without a Decision is refused (`NOT_EXECUTABLE.NO_DECISION`), by-entity signal routes return 404 `NoLiveDecision`, and when a Decision exists the by-entity routes resolve the newest PROPOSED at write time (`decisionSignalStamps.js:266-299`) | PR-2; backend | The ACTION grammar reserves a target kind `ENTITY`; no component may render it until a contract exists. Surfaces holding a `decisionId` use the by-id routes (which return 409 if the Decision is no longer PROPOSED) and express that 409 as a state. |
| **FC-9** ✅ *closed in Phase 1.5* (`CLAUDE.md` updated; see `GOVERNANCE_SYNC.md`) | The authority pointers still in force point at the legacy system: checked-in `CLAUDE.md` names `client/design-system/tokens/*.json`, `TAXONOMY-FREEZE.md`, `ui-registry.md` and `component-states.md` as design authority. Phase 1 may create only its listed files | PR-13; brief §42 | **Phase 2 entry condition:** a governance change updates `CLAUDE.md` to point at `design-governance/`. Until then, a session reading `CLAUDE.md` gets the old authority. `CLAUDE.md` file-size budgets are **not** superseded by PR-13 (they are not a historical design document) and remain binding unless ruled otherwise. |
| **FC-10** ◐ *spec half closed in Phase 1.5* (spec registered verbatim at `LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`; its divergences from this constitution are FC-12…FC-17). *Logo half still open* (`brand/README.md`: SOURCE REQUIRED). 🔒 *Omar, 2026-09-14: correctly blocks brand implementation; does **not** block token architecture.* Spec version 2026-09-13 "Brand Identity Lock" **approved as authoritative** | Authority #3, the Master Build Spec, and the approved logo asset "01 / Current Base" are **not in the repository**. They are known only through the quotations in the Phase 1 brief and the rulings | brief §2, §11; audit §30 | Phase 1 encodes every quoted requirement. Review Gate G-1 and all later gates must diff against the actual spec. Logo direction is specified as requirements in VISUAL_BOUNDARIES.md §5; variant measurements (minimum sizes, favicon legibility) wait for the asset. |
| **FC-11** | Constitution R-3 says Allocation is a plan artifact, not a Decision, but the backend still writes `DecisionClass.ALLOCATION` rows with verdict `REALLOCATE` (`AllocationService.js:48-65`). REALLOCATE is also a legitimate Signal verdict | Constitution R-3; PR-5; backend | Not a design conflict. The design system renders REALLOCATE only as a Signal verdict and never gives an allocation row a Decision presentation (`hasDestination()` excludes ALLOCATION, `src/services/decisions/decisionClassScope.js:247-264`). The backend item is already on the R-3 implementation ledger. |

### Appendix A.1 · Master Build Spec vs design governance — registered in Phase 1.5

These were found by reading the registered spec in full once it entered the
repository. They are **registered, not reconciled**.

**Omar's rulings, 2026-09-14.** FC-12, FC-13 and FC-16 are **RULED** (marked 🔒
below). FC-12 and FC-16 are product and IA decisions, not token decisions. They
bind every later phase that reaches the landing page or Campaigns.
**FC-14, FC-15 and FC-17 are RULED NON-BLOCKING** (Omar, 2026-09-14, second
ruling). None of them blocks Phase 2. Under the conflict order
(Article 35) product truth governs first, then this constitution. Each row
names what the governing rule is until Omar rules otherwise. The full clause-by-
clause authority diff remains a G-2 obligation (REVIEW_GATE.md Q-13).

| ID | Spec says | Governance says | Governing until ruled |
|---|---|---|---|
| **FC-12** | The existing landing page is the **visual baseline**; preserve its strongest direction and the hero line "Know what to do next. After every sync." (Rule 4, §12, §39 Phase 5) | Phase 1 is a reset; the legacy frontend is evidence, not visual authority (Article 37, REFERENCE_POLICY.md RP-7) | 🔒 **RULED — the reset wins.** The existing landing page is **legacy implementation, not visual authority**. Spec Rule 4, §12 and §39 Phase 5 do not make it a baseline. Audit §22 remains evidence of what exists. Reusing any legacy landing copy or concept (for example the hero line, or "Why LUMI said KILL") is a decision for the landing phase, made by explicit ruling, never inherited by default. |
| **FC-13** | Map existing tokens (KEEP / MERGE / RENAME / DEPRECATE / ADD); "preserve all existing semantic verdict/state colors … do not recolor product states". It calls `#C74646 / #D97732 / #3D9B6D` the *current* verdict colours, while the repository uses `#EF4444 / #F59E0B / #10B981` (audit §7.2–7.3) (§10) | Legacy values are not carried over (DESIGN_TOKEN_ARCHITECTURE.md §10); verdict values come from PR-6 | 🔒 **RULED — locked Product Truth / Phase 1 wins.** The six verdict colours are exactly PR-6: KILL `#C74646` · HOLD `#D97732` · SCALE `#3D9B6D` · WATCH `#3B82F6` · REFRESH `#B7791F` · REALLOCATE `#D4A017`. **No reversion to the implementation colours** `#EF4444 / #F59E0B / #10B981` (or any other legacy value). Phase 2 may still produce the spec's KEEP / MERGE / RENAME / DEPRECATE / ADD **inventory** of legacy tokens; the inventory never supplies a verdict value. |
| **FC-14** | The brand mark's principles inform "focus states … selected states"; "gold should identify what matters" (Brand Identity Lock, "Logo-to-Product Continuity") | Gold is never a focus ring, hover or selected state (Article 12; COMPONENT_RULES.md CMP-08) | 🔒 **RULED — NON-BLOCKING.** Gold **principles** may inform focus and selection, but **brand gold must not become a universal interaction-state colour**. Brand tokens and semantic interaction tokens stay **distinct** (DESIGN_TOKEN_ARCHITECTURE.md §4; interaction roles are defined independently). Article 12 and CMP-08 (gold is never the focus ring, hover or selected state) remain the constitutional rule and sit inside this ruling. Any future gold interaction role needs its own semantic token and ruling, never an alias of brand gold. |
| **FC-15** | State list includes `partial`, `unreadable`, `valid empty`, `no measurement`, `disabled` (§17) | STATE_RULES.md: 15 states with published triggers | STATE_RULES.md, mapped: *valid empty* → EMPTY · *unreadable / request failed* → FAILED · *no measurement* → NOT_MEASURED · *partial* → AVAILABLE with a published qualifier (§2). 🔒 **RULED — NON-BLOCKING.** `disabled` and `partial` are **valid semantic states**. Phase 2 may define their **token roles**. Exact state expression per component is decided in the relevant component or state phase, and **no component-specific state behaviour is invented earlier**. Trigger rules still apply: `partial` renders only from a published qualifier (STATE_RULES.md §2, §18). `disabled` is an interaction state whose reason must come from a published refusal or permission (for example `NOT_EXECUTABLE`), never from data shape. |
| **FC-16** | Campaigns support "discovery, filtering, verdict filtering"; tables support sorting (§19, §22) | Locked B7-08: "Campaigns has no browsable list" (any list must be ordered by a metric, which makes it a dashboard); COMPONENT_RULES.md CMP-05 | 🔒 **RULED — the locked IA ruling wins** (B7-08). **No browsable Campaigns list, filter or sort experience** is introduced because the Master Build Spec mentions one. Campaigns stays a subject lens entered from a claim or deep link. Table sorting and filtering elsewhere apply only where CMP-05 allows. Changing this needs a new product / IA ruling, not a design or implementation phase. |
| **FC-17** | Phase sequence: 2 Visual Foundation (tokens, typography, colour, spacing, radius, elevation, iconography, layout) → 3 Core Primitives → 4 LUMI primitives → 5 Landing → 6 Motion → 7 App Shell → 8 Migration (§39). Governance files live in `design-governance/`, including `DESIGN_SYSTEM_AUDIT.md` (§36) | The programme runs Phase 0 → 0.5 → 1 → 1.5 → **2 Design Tokens** under REVIEW_GATE.md gates. The audit is preserved at the repository root | 🔒 **RULED — NON-BLOCKING.** Phase numbering and the audit document's location are **documentation concerns**; architecture is not reopened over them. Omar's programme sequencing is used. The audit stays at the repository root. |

**Checked and consistent** (no registration needed):

- Product-truth priority ("PRODUCT TRUTH > DECISION CLARITY > EVIDENCE > ACCESSIBILITY > BRAND EXPRESSION > DECORATION");
- the brand palette and typography;
- the six-verdict landing section;
- anti-convergence tests 1–6 and forbidden visual language;
- card governance;
- the chart three-question rule;
- no shimmer, fake thinking or perpetual motion;
- the Figma-to-code rule;
- the reference process;
- WCAG 2.2 AA;
- dark-first product UI (PR-9) alongside the spec's "not every asset a dark cinematic render".
