# LUMI Primitives — Registry

```text
Status      IMPLEMENTED — Phase 3 (Primitives), 2026-09-14, on 9872525 (origin/master)
Authority   design-governance/ · DESIGN_TOKEN_ARCHITECTURE.md (tokens) · this file (registry)
Supersedes  client/design-system/ui-registry.md (HISTORICAL) — COMPONENT_RULES.md CMP-10 §2
Audit       PHASE_3_PRIMITIVE_AUDIT.md
Consumers   the public landing page (Phase 4, client/src/lumi/landing/). Authenticated surfaces adopt these parts when they migrate (Phase 5).
```

**Check this registry before creating a component.** A part that expresses a
grammar object already listed here, with the same states, is extended, not
duplicated (CMP-10, CMP-11).

---

## 1. Two layers (🔒 FC-18)

```text
FOUNDATION → GENERIC PRIMITIVES → LUMI GRAMMAR → PRODUCT SURFACE COMPONENTS → PAGES
 tokens       primitives/          grammar/       (Phase 5)                    (Phase 5)
```

| Layer | Folder | Rule | Knows about the product? |
|---|---|---|---|
| **Generic primitive** | `primitives/` | CMP-01: expresses a token category; grammar-agnostic | no |
| **LUMI Grammar** | `grammar/` | CMP-02: expresses one grammar object; carries a header with grammar object · contract · states · why LUMI | **yes — explicitly product-aware** (FC-18) |

`lab/` holds the non-production Primitive Lab (served only at `/lumi-lab.html`
by the Vite dev server; never built into `client/dist`) and the Phase 4 landing review
entry (`/lumi-landing.html`, same rule). `landing/` is the public landing page — the
PAGES layer, composed only of these parts (PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md).

Grammar parts compose primitives. Primitives never import grammar parts.
Neither imports anything from the legacy layers (`client/src/primitives`,
`client/src/components/primitives`, `client/src/components/ui`,
`client/src/design-system/signals`, `client/src/design-system/patterns`).

The composed **Decision object** (a full Decision destination) is not here. It
is built from these parts at the next gate (REVIEW_GATE.md G-3 → G-4).

## 2. How tokens are consumed

```text
tokens/*.json ──build──► generated/tokens.css (--lumi-*) ──var()──► *.module.css ──► part
```

- Every visual value is a `var(--lumi-*)` inside a CSS module. No Tailwind class,
  no inline style, no raw hex, length or duration, no `var()` fallback.
- `src/lumi/` is excluded from Tailwind's content scan
  (`client/tailwind.config.js`), so a utility class written here generates
  nothing and the legacy stylesheet is unaffected.
- Colour exists only inside an `<Environment>`. A coloured part rendered outside
  one throws.
- **The API is closed.** Every part declares its props and throws on any other.
  `className`, `style`, `color`, `tone` and `variant` are refused everywhere.
  `aria-*` and `data-*` pass through; `data-lumi-*` is reserved.
- An unknown enum value throws. Nothing is mapped to a neighbour.

Enforced by `__tests__/tokenUsage.test.js` (static) and the behaviour tests.

## 3. Primitives

| Part | Purpose | Props (required **bold**) | States | Accessibility |
|---|---|---|---|---|
| `Environment` | the ground: product · marketing · marketing-dark-section (🔒 PR-9) | **env** | — | plain container |
| `Surface` | a region holding one question: base · raised · elevated (overlay) | **level**, boundary, padding, as | — | `as` gives the landmark |
| `Stack` | vertical flow by relationship tier | **gap**, as, align | — | `as="ul"`/`"ol"` for lists |
| `Inline` | horizontal flow by relationship tier | **gap**, as, align, justify, wrap | — | — |
| `Rule` | hairline: divider (decorative) · structure (separator) | **kind**, orientation | — | divider `aria-hidden`; structure `role="separator"` |
| `Text` | prose roles: claim · body · label · caption · identifier | **variant**, light, as | — | — |
| `Heading` | surface · section · brand (marketing only) | **level**, **variant** | — | real `h1`–`h6` |
| `VisuallyHidden` | text for assistive technology | children | — | clip technique |
| `Icon` | lucide glyph at inline or standalone size | **glyph**, size, label | — | hidden unless labelled; forbidden glyphs refused |
| `Announcement` | live region | politeness | — | `status` / `alert` |
| `Button` | a control with a visible text label | **prominence**, **onActivate** (or `type="submit"`), disabledReason, type | default · hover · pressed · focus-visible · disabled | native button; disabled = `aria-disabled` + focusable + described reason |
| `IconButton` | icon-only control | **prominence**, **glyph**, **label**, **onActivate** | as Button | name from `label` |
| `ActionLink` *(Phase 4)* | navigation that carries a control's weight: a real link drawn with Button's two prominences | **prominence**, **to** or **href** | as Button (no disabled: a link that goes nowhere is not rendered) | native link; name from its visible label |
| `TextLink` | navigation in text | **to** or **href**, current | default · hover · focus-visible · current | always underlined; `aria-current` |
| `TextField` | labelled text input or textarea | **label**, **value**, **onValueChange**, type, multiline, description, invalidReason, disabledReason | default · focus · invalid · disabled | label, description and messages linked |
| `SelectField` | labelled native select | **label**, **value**, **options**, **onValueChange**, unsetLabel | as TextField | value outside options refused |
| `CheckboxField` | one boolean choice | **label**, **checked**, **onCheckedChange**, description, disabledReason | checked · focus · disabled | native checkbox |
| `RadioGroup` | one choice of several | **label**, **name**, **options**, **value** (or null), **onValueChange** | as Checkbox | `fieldset` + `legend` |

**Prominence.** `standard` is bounded with claim-level text; `quiet` is
unbounded with body-level text. There is no primary, secondary or danger, and
no path to gold or a verdict colour.

**Surface boundary.** A bordered container requires one of the CMP-04 reasons:
`object` · `evidenceGroup` · `decisionGroup` · `actionGroup` · `independentState`.

**Gap tiers.** `inline` 4 · `meta` 8 · `object` 16 · `section` 32 · `macro` 64
(DESIGN_TOKEN_ARCHITECTURE.md §7). A size name (`md`, `16`) is refused.

## 4. Grammar parts

| Part | Grammar object | Contract | States | Why LUMI |
|---|---|---|---|---|
| `VerdictMark` | VERDICT | `verdict` ∈ `VerdictSchema`; `context` claim · list | AVAILABLE (a gated or failed verdict is a `ClaimState`) | PR-5; FC-3: the word is mandatory; mark beside it; Charcoal only |
| `TenseLabel` | VERDICT tense | `tense` NOW · AT_DECISION; `at` ISO instant | — | PR-1: a live verdict never passes as the stored one |
| `AgreementNote` | VERDICT tense | published `{ knowledge, value }`; `storedVerdict` when DIVERGES | KNOWN+DIVERGES named · AGREES / NOTHING_THERE silent · COULD_NOT_LOOK stated | FC-5: named in language, never diffed |
| `DecisionIdentity` | DECISION | `decisionClass` (not ALLOCATION), `status`, `decisionId` | AVAILABLE | R-3; PROPOSED reads "Open", never "new" (B7-01) |
| `Spine` / `SpineStage` | DECISION / assessment | `tense`, `at`; stages VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY | a stage without content does not render | Article 8: one axis, not six cards; NOW refuses ACTION, OUTCOME, MEMORY |
| `ClaimState` | MEASUREMENT | `state` (16 of 17), `claim`, `reason`, remedy, requiredPlan | all states except DISABLED (a control's `disabledReason`) | PR-3, R-4, B8-02: failed ≠ empty, missing ≠ zero |
| `EvidenceGroup` | EVIDENCE | `question`, `headingLevel`, `population`, `window`, `source` | per figure | B7-05, B8-04: one population and one window per group |
| `Measurement` | MEASUREMENT | `label`, `window` (own or group's), basis, `state`, `figure`, reason, prominence | 3 value states render a figure; 10 absence states render words | B8-01 L-6: no figure without its window; PR-7 |
| `Money` | MEASUREMENT | `amountMinor` (integer), `currency` (ISO, declared in `money.ts`) | formatted · currency not reported · currency not declared | PR-12: the canonical formatter, no silent USD |
| `ActionControl` | ACTION | `kind` platformMutation · humanRecord, `decisionId`, `label`, platform, refusal, state, stateReason | available · refused · processing · noLongerOpen · notPermitted | PR-2, B8-03 inv. 9, PR-5: bound to a Decision id, never to a verdict |

### State rules carried by `ClaimState` and `Measurement`

| Rule | Where |
|---|---|
| AVAILABLE, STALE and PARTIAL render the value; every absence renders no value | both |
| every state except AVAILABLE and LOADING carries its reason | both |
| an instruction (remedy) is accepted only for FAILED, UNAVAILABLE, NOT_CONNECTED, NOT_PERMITTED, NO_CONVERSIONS, EMPTY | `ClaimState` |
| LOADING marks the region `aria-busy` and draws no placeholder figure | both |
| PROCESSING and SUCCESS are announced (`role="status"`) | `ClaimState` |
| FAILED has the highest light, a boundary and words | `ClaimState` |
| the registry equals `semantic.json` `$states`, both directions | `states.test.jsx` |

## 5. Usage

```jsx
<Environment env="product">
  <Spine tense="NOW" at={assessment.computedAt}>
    <SpineStage stage="VERDICT" headingLevel={2}>
      <VerdictMark verdict={assessment.verdict} />
      <AgreementNote {...assessment.decisionAgreement} storedVerdict={stored?.verdict} />
    </SpineStage>
    <SpineStage stage="EVIDENCE" headingLevel={2}>
      <EvidenceGroup question="Is it working?" headingLevel={3}
        population={evidence.population} window={evidence.window} source={evidence.source}>
        <Measurement label="Spend" state={spend.state} figure={spend.figure} reason={spend.reason} />
      </EvidenceGroup>
    </SpineStage>
  </Spine>
</Environment>
```

Every value above comes from the consumer's parsed contract. No part fetches,
derives a state, computes agreement, infers a currency or supplies a default.

## 6. Do / Don't

| Do | Don't |
|---|---|
| pass the state the backend published | derive a state from `[]`, `null` or a response shape |
| render an absence with its reason | pass `0`, `—` or `'USD'` to fill a slot |
| bind every action to its `decisionId` | attach an action to a NOW spine or an entity |
| state a divergence with `AgreementNote` | draw arrows, strikethrough or "was → now" |
| use `Surface boundary` only with its CMP-04 reason | tile equal bordered surfaces |
| give every disabled control its reason | disable silently |

## 7. Motion and responsiveness

- **Motion.** Only Button's background feedback, on `motion.duration.feedback`
  and `motion.easing.feedback` (100ms, which survives reduced motion). No
  reveal, transition, pulse, shimmer or count-up exists in any part.
- **Responsive.** No part encodes a breakpoint. Flow wraps; `min-width: 0`
  prevents overflow; controls grow to `size.target.touch` (44px) under
  `pointer: coarse`. The spine is always vertical (Article 8 §1).

## 8. Deliberately not built

| Not built | Reason |
|---|---|
| Switch | 0 switches in the shipping client (CMP-01 needs two consumers) |
| Tabs | 1 tab list in the shipping client |
| Tooltip | help content hidden on hover; HelpTip stays legacy until a surface rules its successor |
| Dialog / confirmation | needs a flat dimming backdrop token (Article 16) that Phase 2 did not define; tokens are locked in Phase 3 |
| Delta / change indicator | a comparison must name both windows (Article 23); no consumer contract publishes a paired window |
| Skeleton / spinner | forbidden (STATE_RULES.md §1, MO-8) |
| Attention mark (gold) | no consumer yet; `color.signal.attention` stays unconsumed until an Attention surface needs it |
| Reason / Outcome / Memory components | built from `Text`, `ClaimState` and `Measurement` inside a `SpineStage`; dedicated parts wait for the Decision-object gate |
| Card, Badge, Panel, StatCard | not grammar objects (CMP-02 naming; AC-5) |
