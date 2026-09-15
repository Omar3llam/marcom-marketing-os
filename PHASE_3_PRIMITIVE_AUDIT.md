# PHASE 3 PRIMITIVE AUDIT

```text
Phase      3 — Primitives
Date       2026-09-14
Branch     feat/lumi-primitives (uncommitted)
Base       9872525 = origin/master after #476 — tree 5b6a68ca, identical to c738749 (see Findings F-1)
Author     Claude Code. This is the author's record. Gate approval is Omar's (Constitution Article 36).
Registry   client/src/lumi/README.md
```

Every number in this document was measured from the repository or from a command
run on this branch. Where a number could not be measured it says so.

---

## Scope

Phase 3 built reusable primitives and grammar parts under `client/src/lumi/`,
with tests and documentation. It changed no page, route, API call, backend,
database, product logic, landing page, app shell or token value. Nothing in the
application imports the new layer (📏 0 importers outside `client/src/lumi/`).

---

## Primitive Inventory

### Method

- **Importers** were measured by resolving every import specifier in
  `client/src` to a file (scratch script, not committed).
- **Instrument correction, recorded rather than hidden.** The first run joined
  directory-index paths with mixed separators on Windows. That silently dropped
  every import of a folder (`from '@/design-system/patterns'`), so it reported the
  `client/src/components/primitives` barrel as having 0 importers when it has 3.
  A `grep` count disagreed (8 vs 5 importers of the patterns barrel), which
  exposed the defect. The script was fixed and every count below comes from the
  corrected run, cross-checked by `grep`.
- **Control usage**, from the same production sources, excluding tests:

  | Control | Occurrences | Files |
  |---|---|---|
  | `<button` | 202 | 89 |
  | text-like `<input` | 65 | 30 |
  | `<textarea` | 5 | 5 |
  | `<select` | 19 | 11 |
  | `type="checkbox"` | 3 | 3 |
  | `type="radio"` | 2 | 2 |
  | `role="switch"` | 0 | 0 |
  | `role="tab"` | 1 | 1 |
  | `role="dialog"` / `alertdialog` | 9 | 8 |
  | `role="tooltip"` | 1 | 1 |
  | router `<Link` | 46 | 33 |

- "Live" means the module is reached from a file that the application itself
  reaches. "Unreachable" means every importer is itself unimported.

### Classification (spec §3: KEEP · EVOLVE · CONSOLIDATE · REPLACE · REMOVE · UNKNOWN)

**A. `client/src/primitives/` (TypeScript layout primitives)**

| Module | Importers | Reach | Observed | Class |
|---|---|---|---|---|
| `Shell.tsx` | barrel only | unreachable | inline styles, legacy `--color-*` variables | **REMOVE** (after G-6) |
| `Panel.tsx` | `layouts/DecisionTrustCluster.tsx` + barrel | unreachable | `variant` error / warning / success borders, shadow scale | **REMOVE** |
| `Button.tsx` | barrel only | unreachable | primary "blue accent", `danger` variant, `opacity: 0.6` disabled, JS hover | **REPLACE** → `Button` |
| `Stack.tsx` | 3 `layouts/*` + barrel | unreachable | size-named gaps | **REPLACE** → `Stack` |
| `Cluster.tsx` | 2 `layouts/*` + barrel | unreachable | size-named gaps | **REPLACE** → `Inline` |
| `index.ts` | 0 | unreachable | — | **REMOVE** |

`client/src/layouts/*` (the only importers above) is itself unreachable: its
barrel's only "importer" is a comment inside the barrel.

**B. `client/src/components/primitives/`**

| Module | Live importers | Observed | Class |
|---|---|---|---|
| `core/Text.jsx` | `components/approval/{ApprovalForm, ArtifactCard}`, `components/publish/{PendingApprovalItem, RecordPublishForm}`, `pages/{ApprovalQueue, Publishing}` | CVA `intent` success / warning / danger → verdict colours; `drop-shadow` on metrics; `text-3xl font-extrabold` | **REPLACE** → `Text` / `Heading` |
| `typography/DecisionTitle.jsx` | `pages/AuthPage.jsx` (barrel) | `title` variant | **REPLACE** → `Heading` |
| `typography/MetricValue.jsx` | `pages/AuthPage.jsx` (barrel), rendering the word "Lumi" | a metric role used for a brand word | **REPLACE** → `Heading` / `Measurement` |
| `signals/VerdictBadge.jsx` | `features/content-lab/ContentLabView.jsx` (barrel) | filled pill, `rounded-2xl`, glow, word in verdict colour | **REPLACE** → `VerdictMark` |
| `typography/{SectionLabel, BodyMuted, BodySubtle}.jsx` | none live | — | **REMOVE** |
| `flows/ConfidenceIndicator.jsx` | `components/assemblies/DecisionTrustCluster.jsx` (unreachable) | **client-side banding** 0.85 / 0.60 → verdict colours | **REMOVE** — hidden logic (H-2) |
| `flows/RiskSignal.jsx` | same, unreachable | emoji-like glyphs `✓ ⚠ ✕`, `rounded-full` pill | **REMOVE** |
| `flows/{UrgencyBadge, RecommendationStrength}.jsx` | none live | `animate-pulse`, raw Tailwind hues, strength bars | **REMOVE** |
| `flows/{InputSection, InputField, InputLabel, InputHint}.jsx` | none live | labels coloured by "intent" (gold, danger, scale) | **REPLACE** → `TextField` / `SelectField` |
| `index.js` | `ContentLabView`, `AuthPage`, `assemblies/DecisionTrustCluster` | — | **CONSOLIDATE** away as its two live consumers migrate |

**C. `client/src/components/ui/`**

| Module | Live importers | Observed | Class |
|---|---|---|---|
| `DecisionPill.jsx` | 4: `RecentDecisions`, `ConnectorCampaignsPanel`, `InboxPanel`, `overview/DecisionCard` | pill with the word inside, 9 / 10px text, per-verdict icons, grey fallback for an unknown verdict, `TEST` in the verdict map | **REPLACE** → `VerdictMark` — hidden logic (H-3) |
| `EmptyPanel.jsx` | 5 | one generic empty for any cause | **REPLACE** → `ClaimState` |
| `Skeleton.jsx` | 8 | `animate-shimmer` | **REPLACE** → `ClaimState state="LOADING"` |
| `StatCard.jsx` | 1 (`KpiStrip` on Overview) | KPI tile, gradient gauge, gold tint | **REMOVE** with its surface (AC F-4) |
| `Panel.jsx` | 1 (`AgendaBand`) | tone icons incl. gold, `rounded-xl`, `shadow-card` | **REPLACE** → `Surface` + `Heading` |
| `LumiLoader.jsx` | 1 (Content Lab) | glowing orb, conic "sparkle", "Intelligence Engine Active" | **REMOVE** (VB-F7, MO-8) |
| `InlineBar.jsx` | 1 (`MetricsPanel`) | **colour tier chosen client-side** at 40% / 70% | **UNKNOWN** — hidden logic (H-4) |
| `HelpTip.jsx` | 10 | tooltip + popover; hover-only content; gold "Learn more" link | **KEEP** until a surface rules its successor |
| `ConfirmModal.jsx` | 1 (admin `UsersTab`) | `backdrop-blur-sm`, gold / KILL-red confirm button | **EVOLVE** — blocked on the backdrop token (F-3) |
| `Pagination.jsx` | 2 (admin) | honest server total; `disabled:opacity-30` | **EVOLVE** → `Button` inside it |
| `NotificationBell.jsx` | 1 (`Sidebar`) | pulsing glow dot, KILL colour for a count | **UNKNOWN** — app shell (Phase 5), PR-11 |
| `RecentDecisions.jsx` | 1 (`Sidebar`) | "No decisions yet" rendered from `decisions.length === 0` | **UNKNOWN** — app shell; possible state-from-shape (H-5) |
| `CommandPalette.jsx`, `CommandPaletteItems.jsx` | 1 (`Sidebar`) | navigation | **UNKNOWN** — app shell |
| `ErrorBoundary.jsx` | 1 (`main.jsx`) | raw grays, lint-exempt | **KEEP** (runtime safety net) |

**D. `client/src/design-system/`**

| Module | Live use | Class |
|---|---|---|
| `states/absence.js` | 5 importers | **KEEP** — locked B8 adapter; `ClaimState` receives its output |
| `states/confidence.js` | 4 importers | **KEEP** — locked B8-05 |
| `patterns/DetailGrammar.jsx` | 3 (`DecisionDetailView`, `HoldoutDetailView`, `TestDetailView`) | **EVOLVE** → `SpineStage` + `ClaimState` (its refusal icon is `text-signal-hold`) |
| `patterns/PageHeader.jsx` | 8 via barrel | **EVOLVE** → `Heading` |
| `patterns/StateBlock.jsx` | `EmptyState` in `SettingsView`; `ErrorState`, `LoadingState`, `StateBlock` unused | **REPLACE** → `ClaimState` (tone-based; spinning loader) |
| `patterns/MetricTile.jsx` | 1 (`CopilotPage`, PR-8: not built upon) | **REMOVE** with that page |
| `patterns/{EvidencePanel, RecommendationCard}.jsx` | 0 | **REMOVE** |
| `signals/signals.js` | 1 (`VerdictBadge`, live) | **REPLACE** — hidden logic (H-1) |
| `flows/decisionFlows.js` | 0 (its only match is a comment in itself) | **UNKNOWN** — contents not reviewed |

**E. Formatting utilities**

| Module | Importers | Class |
|---|---|---|
| `lib/money.ts` | 23 (22 legacy + `lumi/grammar/Measurement.jsx`) | **KEEP** — the canonical money contract; `Money` consumes it |
| `lib/currencyFormatter.js` | 4 | **CONSOLIDATE** into `money.ts` (PR-12; audit §31) |
| `lib/metricDisplay.js` | 0 | **REMOVE** — hardcoded `EGP`; treats `0` as missing |

### Duplications found (spec §3 "look for")

| Duplication | Instances |
|---|---|
| Button | `primitives/Button.tsx` · ad-hoc `<button>` classes in `ConfirmModal`, `Pagination`, `RecommendationCard` |
| Typography | `components/primitives/core/Text.jsx` CVA · `index.css` role classes (`decision-title`, `section-label`, `metric-display`) · raw `text-[10px]` etc. in `StatCard`, `Panel`, `DecisionPill` |
| Verdict display | `DecisionPill.verdictConfig` · `signals.js` `SIGNALS` · `VerdictBadge` (audit §15 already counted two maps) |
| State containers | `EmptyPanel` · `StateBlock` / `EmptyState` / `ErrorState` / `LoadingState` · `DetailRefusal` · `Skeleton` / `CardSkeleton` · `LumiLoader` |
| Panels / surfaces | `primitives/Panel.tsx` · `ui/Panel.jsx` · `EvidencePanel` · `MetricTile` · `StatCard` |
| Currency formatting | `lib/money.ts formatCurrency(minor)` · `lib/currencyFormatter.js formatCurrency(major)` · `lib/metricDisplay.js displaySpend` |
| Spacing logic | size-named gaps in `primitives/{Stack, Cluster}` · Tailwind `space-y-*` / `gap-*` everywhere |

---

## New Primitive Taxonomy

📏 `client/src/lumi/`: 25 source files (21 `.js`/`.jsx`, 4 CSS modules) and the registry `README.md`; plus 8 test and helper files.

```text
client/src/lumi/
├── contract.js                 closed-API guard shared by every part
├── index.js                    barrel
├── README.md                   the Phase 3 registry
├── primitives/                 CMP-01 — grammar-agnostic
│   ├── Environment.jsx         Environment · useGround
│   ├── Surface.jsx             Surface (level; CMP-04 boundary reasons)
│   ├── Flow.jsx                Stack · Inline · Rule
│   ├── Text.jsx                Text · Heading · VisuallyHidden
│   ├── Icon.jsx                Icon · Announcement
│   ├── Button.jsx              Button · IconButton
│   ├── TextLink.jsx            TextLink
│   ├── FieldParts.jsx          shared field label / description / messages
│   ├── TextField.jsx           TextField · SelectField
│   ├── ChoiceField.jsx         CheckboxField · RadioGroup
│   ├── layout.module.css · type.module.css · controls.module.css
├── grammar/                    CMP-02 — each file carries grammar object · contract · states · why LUMI
│   ├── vocabulary.js           verdicts, statuses, classes, knowledge tokens, the 17-state registry
│   ├── VerdictMark.jsx
│   ├── Tense.jsx               TenseLabel · AgreementNote
│   ├── DecisionIdentity.jsx
│   ├── Spine.jsx               Spine · SpineStage
│   ├── ClaimState.jsx
│   ├── EvidenceGroup.jsx
│   ├── Measurement.jsx         Measurement · Money
│   ├── ActionControl.jsx
│   └── grammar.module.css
└── __tests__/                  6 test files + helpers.jsx + lumiAudit.js
```

| Category (spec §4) | Implemented |
|---|---|
| A. Foundational | `Environment`, `Surface`, `Stack`, `Inline`, `Rule`, `Text`, `Heading`, `VisuallyHidden`, `Icon`, `Announcement` |
| B. Interaction | `Button`, `IconButton`, `TextLink`, `TextField`, `SelectField`, `CheckboxField`, `RadioGroup` |
| C. Data | `Measurement`, `Money` (figures are reachable only here) |
| D–G. Decision | `VerdictMark`, `TenseLabel`, `AgreementNote`, `DecisionIdentity`, `Spine`, `SpineStage`, `EvidenceGroup`, `ActionControl` |
| H. State | `ClaimState` (16 states) + `disabledReason` on every control (DISABLED) |

**File-size budget.** 📏 Largest `.jsx` file: `Measurement.jsx`, 118 lines. Every
`.jsx` file is within the CLAUDE.md UI-primitive budget of 150 lines, and a test
enforces it.

**Dependencies.** 📏 `client/package.json` is unchanged. Every import is an existing
dependency: `react`, `react-router-dom`, `lucide-react`, `zod` (through the
parse-layer schema) and `@marcom/runtime-contracts`.

---

## LUMI-Specific Primitives

| Part | Spine stage / grammar | What it makes impossible |
|---|---|---|
| `VerdictMark` | VERDICT | a verdict by colour alone; a word in verdict colour; an unknown verdict mapped to HOLD; a mark on Off White |
| `TenseLabel` | VERDICT (tense) | a verdict with no tense or clock; a time in the viewer's timezone |
| `AgreementNote` | VERDICT (tense) | a divergence drawn as a diff; "agrees" assumed when agreement could not be checked |
| `Spine` / `SpineStage` | the whole spine | stages out of order; six cards; an empty heading; ACTION, OUTCOME or MEMORY on a NOW assessment |
| `DecisionIdentity` | DECISION | an ALLOCATION presented as a Decision; "new" for an open Decision |
| `EvidenceGroup` | EVIDENCE | two windows or populations in one group; evidence without provenance |
| `Measurement` / `Money` | MEASUREMENT | a figure without a window; a zero or dash for an absence; a silent USD; a guessed minor-unit exponent |
| `ActionControl` | ACTION | an action without a Decision id; an ENTITY action (FC-8); a verdict-coloured action; a control where the backend refuses one |
| `ClaimState` | MEASUREMENT (state) | failed read as empty; a value beside an absence; an instruction where none is honest |

Composition is demonstrated without a route in `__tests__/composition.test.jsx`:
a NOW assessment (SCALE, divergence named, why, evidence) above a stored decision
(KILL, identity, action, outcome) for one subject.

---

## State Model

- **Source.** The consumer passes a state. No part derives one. The registry in
  `grammar/vocabulary.js` equals `semantic.json` `$states` in both directions,
  name for name and illumination class for class (📏 test).
- **Words.** 📏 17 distinct state labels. No two states read alike.

| State | Expressed by | Value | Reason | Instruction allowed | Announced |
|---|---|---|---|---|---|
| LOADING | `ClaimState`, `Measurement` | optional (same request only) | optional | no | `aria-busy` |
| AVAILABLE | `ClaimState`, `Measurement` | required | refused | no | — |
| EMPTY | `ClaimState` | refused | required | yes | — |
| FAILED | `ClaimState`, `Measurement` | refused | required | yes (retry) | in place, bounded |
| UNAVAILABLE | both | refused | required | yes | — |
| NOT_CONNECTED | both | refused | required | yes | — |
| NOT_PERMITTED | both | refused | required | yes; `requiredPlan` + lock | — |
| NOT_SUPPORTED | both | refused | required | no | — |
| STALE | both | required | required (the age) | no | — |
| PROCESSING | `ClaimState`, `ActionControl` | refused | required (the stage) | no | `role="status"` |
| SUCCESS | `ClaimState` | refused | required (what changed) | no | `role="status"` |
| NOT_MEASURED | both | refused | required | no | — |
| INSUFFICIENT_DATA | both | refused | required | no | — |
| NO_CONVERSIONS | both | refused | required | yes | — |
| MIXED_CURRENCY | both | refused | required | no | — |
| DISABLED | every control's `disabledReason` | — | required | — | described by `aria-describedby` |
| PARTIAL | both | required | required (the qualifier) | no | — |

**Pairs kept apart** (📏 each pair renders different text):
FAILED ≠ EMPTY · EMPTY ≠ AVAILABLE · UNAVAILABLE ≠ EMPTY · NOT_CONNECTED ≠ FAILED ·
PARTIAL ≠ FAILED · NOT_SUPPORTED ≠ UNAVAILABLE · NOT_PERMITTED ≠ NOT_SUPPORTED.
DISABLED ≠ UNAVAILABLE by construction: one is a control's interaction state,
the other a claim state.

**Light.** Absence states use their `absence`-class foreground tokens. FAILED uses
its claim-class foreground plus `failed.border`. No state uses a verdict colour or
gold (📏 static test).

---

## Accessibility

Target WCAG 2.2 AA. Verified by tests unless marked otherwise.

| Requirement | Evidence |
|---|---|
| Keyboard operation | `Button` by Tab, Enter, Space; `CheckboxField` by Space; `SelectField` by native select; radios are native inputs |
| Visible focus (2.4.7) | one focus rule for every control: `outline: size.focus.width solid interaction.focus.ring`, never gold (📏 static test). **Not measured:** the rendered ring was not inspected visually. |
| Accessible name | text-only `Button`; `IconButton` requires `label`; fields use visible labels (`getByLabelText`); `RadioGroup` is a `fieldset` named by its `legend` |
| Disabled semantics | `aria-disabled`, still focusable, reason linked by `aria-describedby`, activation swallowed (📏 test) |
| Target size (2.5.8) | `min-height`/`min-width: size.target.minimum` (24px); `size.target.touch` (44px) under `pointer: coarse`. **Not measured** in a browser. |
| Use of colour (1.4.1) | verdict word always present with a hidden mark; links always underlined; invalid input stated in words with a glyph; states read by words |
| Contrast (1.4.3, 1.4.11) | every colour pair is a Phase 2 token pair (📏 228 checks, 0 failing). No new pair was introduced. |
| Status messages (4.1.3) | `Announcement`; PROCESSING and SUCCESS render `role="status"` |
| Structure | real headings (`Heading`, `SpineStage`, `EvidenceGroup` with `headingLevel`); sections labelled by their headings |
| Reduced motion | the only transition is the 100ms feedback token, whose value is unchanged under reduced motion; no reveal, loop or transform |
| Forbidden iconography | sparkles, wands, robots, brains, bulbs, lamps and suns refused by name (📏 test) |

**Not done:** no screen-reader session, no browser zoom test, and no rendered
visual inspection. jsdom verifies structure and ARIA, not pixels.

---

## Legacy Migration

Statuses: **KEEP** · **ADAPTER** · **MIGRATE** · **DEPRECATE** · **UNKNOWN**.
No legacy file was changed or deleted. "Hidden logic" marks behaviour that must
not be moved into a primitive.

| Legacy | → New | Status | Hidden logic |
|---|---|---|---|
| `components/primitives/core/Text.jsx` (6 live consumers) | `Text` · `Heading` | MIGRATE | — |
| `components/primitives/typography/{DecisionTitle, MetricValue}` (`AuthPage`) | `Heading` | MIGRATE | — |
| `components/primitives/typography/{SectionLabel, BodyMuted, BodySubtle}` | — | DEPRECATE (no live consumer) | — |
| `components/primitives/signals/VerdictBadge.jsx` (Content Lab) | `VerdictMark` | MIGRATE | **H-1** via `signals.js` |
| `design-system/signals/signals.js` | `VerdictMark` + `grammar/vocabulary.js` | DEPRECATE | **H-1** `getSignalTokens`: unknown verdict → HOLD with a warning; REALLOCATE shares HOLD's colour |
| `components/primitives/flows/ConfidenceIndicator.jsx` | — (confidence rungs stay in `states/confidence.js`) | DEPRECATE | **H-2** client-side thresholds 0.85 / 0.60 |
| `components/primitives/flows/{RiskSignal, UrgencyBadge, RecommendationStrength}` | — | DEPRECATE | — |
| `components/primitives/flows/Input*` | `TextField` · `SelectField` | DEPRECATE (no live consumer) | — |
| `primitives/{Shell, Panel, Stack, Cluster, Button}.tsx` + `layouts/*` + `components/assemblies/*` | `Surface` · `Stack` · `Inline` · `Button` | DEPRECATE (unreachable) | — |
| `components/ui/DecisionPill.jsx` (4 consumers) | `VerdictMark` (`context="list"`) | MIGRATE | **H-3** unknown verdict renders a grey fallback pill; `TEST` in the verdict map; per-verdict icons |
| `components/ui/EmptyPanel.jsx` (5) | `ClaimState` | MIGRATE — each call site needs its published state | the consumer, not the panel, decides which state (per call site) |
| `components/ui/Skeleton.jsx` (8) | `ClaimState state="LOADING"` | MIGRATE | — |
| `components/ui/StatCard.jsx` (via `KpiStrip`) | — | DEPRECATE with the KPI strip | — |
| `components/ui/Panel.jsx` (`AgendaBand`) | `Surface` + `Heading` | MIGRATE | — |
| `components/ui/LumiLoader.jsx` (Content Lab) | — | DEPRECATE | — |
| `components/ui/InlineBar.jsx` (`MetricsPanel`) | — | **UNKNOWN** | **H-4** colour tier chosen at 40% / 70% of max in the component: a client-side banding |
| `components/ui/HelpTip.jsx` (10) | — | KEEP | — |
| `components/ui/ConfirmModal.jsx` | — (no Dialog; F-3) | **UNKNOWN** | — |
| `components/ui/Pagination.jsx` | `Button` inside | ADAPTER | — |
| `components/ui/{NotificationBell, RecentDecisions, CommandPalette, CommandPaletteItems}` | — (app shell, Phase 5) | **UNKNOWN** | **H-5** `RecentDecisions` renders "No decisions yet" when `decisions` is empty; whether a failed read reaches it is not traced here |
| `components/ui/ErrorBoundary.jsx` | — | KEEP | — |
| `design-system/states/{absence, confidence}.js` | consumed, not copied | KEEP | locked B8 adapters (Constitution Article 37) |
| `design-system/patterns/DetailGrammar.jsx` | `SpineStage` + `ClaimState` | MIGRATE | the "no empty headings" rule is preserved in `SpineStage` |
| `design-system/patterns/PageHeader.jsx` (8) | `Heading` | MIGRATE | — |
| `design-system/patterns/StateBlock.jsx` | `ClaimState` | MIGRATE | — |
| `design-system/patterns/{MetricTile, EvidencePanel, RecommendationCard}` | — | DEPRECATE | — |
| `design-system/flows/decisionFlows.js` | — | **UNKNOWN** (0 importers; contents not reviewed) | not assessed |
| `lib/currencyFormatter.js` (4) | `Money` via `lib/money.ts` | MIGRATE | defaults `currency = 'USD'` |
| `lib/metricDisplay.js` | — | DEPRECATE (0 importers) | `0` treated as missing; hardcoded `EGP` |

**UNKNOWN items, kept UNKNOWN:** 📏 4 rows covering 7 modules — `InlineBar`,
`ConfirmModal`, the four sidebar components (one row), and `decisionFlows.js`. Each needs a
surface or app-shell decision, or a read of its contents, before it moves.

---

## Anti-Convergence Review

Records in ANTI_CONVERGENCE.md §4 form. All are **author** records made on code
and tests. No rendered artefact was reviewed (see the Gate).

**Primitives (CMP-01).** AC-5 transfers by definition for `Button`, `TextField`,
`Stack` and similar. ANTI_CONVERGENCE.md §2 AC-5 accepts that at the primitive
layer. The resemblance answers (AC-1…AC-4):

```text
ARTEFACT   client/src/lumi/primitives/*
AC-1 Visual       PASS with named resemblance — a text input looks like a text input. No framework
                  default survives: no stock radius (2px/4px tokens), no shadow scale, no primary
                  blue, no gold on any control, focus, hover or selection.
AC-2 Structural   PASS — primitives impose no page skeleton. Surface refuses a border without a
                  CMP-04 reason, so an equal-card grid cannot be built by accident.
AC-3 Behavioural  PASS — no control implies an action the backend did not offer; disabled always
                  carries its reason.
AC-4 Decorative   PASS — no gradient, glow, blur, glass, pulse, shimmer or forbidden glyph exists
                  (static test); nothing moves at rest.
```

**Grammar parts (CMP-02).** AC-5 and AC-6 are decisive.

| Part | AC-5 neutral sentence | AC-5 | AC-6 answer (cites) | AC-6 |
|---|---|---|---|---|
| `VerdictMark` | "shows one of six fixed calls as a word with a mark, and refuses any seventh" | PASS — no generic product has a closed six-verdict vocabulary with a mandatory word | PR-5; FC-3 (HOLD–REFRESH ΔE 5.1) | PASS |
| `TenseLabel` / `AgreementNote` | "labels a judgement as current or recorded, and states in words when they differ" | PASS | PR-1; FC-5; `decisionAgreement` | PASS |
| `Spine` | "renders a judgement and its grounds as ordered stages that refuse actions on a current reading" | PASS | Article 8; PR-1 | PASS |
| `DecisionIdentity` | "shows a decision's class, open status and id, and refuses allocation rows" | PASS | Constitution R-3; B7-01 | PASS |
| `EvidenceGroup` / `Measurement` | "shows figures that cannot render without a window and cannot render a number for an absence" | PASS — a generic stat widget accepts a bare number | B8-01 L-6; PR-7; C-06 | PASS |
| `Money` | "formats minor units through one contract and refuses unknown currencies" | PASS | PR-12; the `/100` defect class | PASS |
| `ActionControl` | "offers an operation bound to one decision id, distinguishing a platform change from a record" | PASS | PR-2; B8-03 inv. 9; FC-8 | PASS |
| `ClaimState` | "states one of sixteen published states for a claim, refusing values beside absences" | PASS — generic empty and error states collapse these | PR-3; R-4; B8-02 | PASS |

**Why this is not a generic SaaS UI kit.** The distinctive behaviour sits in
refusals, not in styling. A generic kit accepts a colour, a bare number, an
empty list and an action on anything. These parts refuse all four. The grammar
layer cannot express a KPI strip (no figure without a window, no delta), a chat
surface (no avatar, typing or streaming part), a card grid (no border without a
CMP-04 reason) or AI decoration (forbidden glyphs, no effects). Identity from
the palette alone was not relied on (ANTI_CONVERGENCE.md §0).

---

## Files Changed

**Modified (2)**

| File | Change |
|---|---|
| `client/tailwind.config.js` | `content` gains `'!./src/lumi/**'` plus a 4-line comment. No legacy token wiring changed. |
| `DESIGN_TOKEN_ARCHITECTURE.md` | new §16 "Token consumption by primitives". No existing section edited. |

**Created**

```text
PHASE_3_PRIMITIVE_AUDIT.md
client/src/lumi/README.md
client/src/lumi/contract.js
client/src/lumi/index.js
client/src/lumi/primitives/{Environment, Surface, Flow, Text, Icon, Button, TextLink, FieldParts, TextField, ChoiceField}.jsx
client/src/lumi/primitives/{layout, type, controls}.module.css
client/src/lumi/grammar/vocabulary.js
client/src/lumi/grammar/{VerdictMark, Tense, DecisionIdentity, Spine, ClaimState, EvidenceGroup, Measurement, ActionControl}.jsx
client/src/lumi/grammar/grammar.module.css
client/src/lumi/__tests__/{tokenUsage.test.js, primitives.test.jsx, controls.test.jsx, grammar.test.jsx, states.test.jsx, composition.test.jsx, helpers.jsx, lumiAudit.js}
```

## Files Intentionally Untouched

| Area | Evidence |
|---|---|
| pages (`client/src/pages/**`) | not in `git status` |
| routes (`client/src/App.jsx`, `client/src/app/routeManifest.js`, `client/src/router/**`) | not in `git status` |
| backend (`src/**`), API (`client/src/lib/api.js`, `client/src/api/**`) | not in `git status` |
| database (`prisma/**`) | not in `git status` |
| product logic (`client/src/features/**`, `hooks/**`, `contracts/**`, `design-system/states/**`, `lib/money.ts`) | not in `git status` |
| landing page (`client/src/pages/LandingPage/**`) | not in `git status` |
| app shell (`client/src/components/layout/**`, `layouts/**`, `main.jsx`, `index.css`, `index.html`) | not in `git status` |
| token source and generated output (`client/design-system/foundation/**`) | not in `git status`; `tokens:check` passes |
| legacy primitives and legacy tokens | not in `git status` |
| `client/package.json`, lockfiles | not in `git status` |
| governance documents (`design-governance/**`, `CLAUDE.md`) | not in `git status` |

---

## Validation

### Commands (run on this branch, Node v24.15.0)

| Command | Result |
|---|---|
| `npx vitest run src/lumi` (client) | 📏 6 files, **175 passed**: tokenUsage 56 · states 50 · grammar 27 · primitives 23 · controls 14 · composition 5 |
| `npx vitest run` (client, full) | 📏 **231 files, 3,165 tests passed**, exit 0 (Phase 2 recorded 225 / 2,990; +6 files / +175 tests = exactly the LUMI suite) |
| `npm run lint:ci` (client) | exit 0; 📏 29 LUMI files linted, 0 errors, 0 warnings |
| `npm run tokens:check` (client) | "Token rules hold and generated output is current." |
| `npm run build` (client) | built |
| `npm run check:tokens` (client, after build) | "Every colour class resolves (1004 selectors in the compiled CSS)." |
| `npm run check` (root) | "All JS syntax valid (787 files)" |
| `npm run lint` (root) | 0 errors, 28 warnings (the same count Phase 2 recorded) |
| backend tests | **not run** — no backend file changed; the shell's Node is v24.15.0, not the pinned 24.20.x |

### Falsification — the tests can fail

- **Static checkers:** 23 planted violations (hex, legacy variable, undefined
  token, fallback, raw length and duration, gradient, blur, non-overlay shadow,
  font family, verdict colour outside a mark, gold, verdict or state colour on an
  interaction selector, literal className, inline style, legacy imports, 3D
  dependencies, a second currency formatter, animation) are each flagged. A legacy
  path named only in a comment is not flagged.
- **Behaviour guards:** 10 mutations, each run against its test file and then
  restored. 📏 **10 of 10 caught.**
  - NOW spine accepts ACTION;
  - figure beside an absence;
  - VerdictMark on Off White;
  - Money formats an undeclared exponent;
  - closed API lets `className` through;
  - disabled Button still activates;
  - ActionControl accepts an entity;
  - TenseLabel uses local time;
  - ClaimState value beside an absence;
  - AgreementNote silent when it could not look.
- **Tailwind exclusion:** a probe class inside `src/lumi` was **not** generated,
  and the same class outside it **was**.

### Production UI safety

- 📏 A production build of the untouched branch (baseline) and a production
  build after all Phase 3 changes are **byte-identical**: 119 files, the same
  paths, every SHA-256 equal.
- 📏 0 application files import `client/src/lumi`.

### The 29 required checks (spec §21)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | New primitives consume Phase 2 tokens | ✅ | 📏 108 of 130 variables referenced; every `var()` defined (tokenUsage) |
| 2 | No competing token system | ✅ | no token file, variable or Tailwind namespace added; static test refuses non-`--lumi-` variables |
| 3 | No hardcoded verdict colours | ✅ | static test: no hex or colour function in LUMI CSS or source |
| 4 | No legacy verdict colours active | ✅ | same; legacy files untouched; build byte-identical |
| 5 | No gold focus / hover / selected token | ✅ | no token added; `signal-attention` referenced nowhere; focus outline is the neutral ring |
| 6 | No verdict colour as interaction colour | ✅ | static test over interaction selectors; `ActionControl` refuses `verdict` |
| 7 | All six verdicts supported | ✅ | `VerdictMark` × 6 (grammar test); vocabulary read from `VerdictSchema` |
| 8 | Assessment vs Decision separate | ✅ | `Spine tense`; NOW refuses ACTION / OUTCOME / MEMORY; `AgreementNote` named, not diffed (composition test) |
| 9 | State semantics separate | ✅ | 17 distinct labels; registry = `$states`; spec pairs render differently |
| 10 | No primitive invents state | ✅ | every state is a required prop; no part reads data shape |
| 11 | No primitive invents numbers | ✅ | absence + figure refused (zero included); no digit in absence slots |
| 12 | No currency inference | ✅ | currency required; null stated as not reported; undeclared code refused |
| 13 | No duplicate currency formatter | ✅ | `Money` calls `lib/money.ts formatCurrency`; static test refuses a second one |
| 14 | Typography: three families only | ✅ | every `font-family` is a type-role token; tokens name exactly Inter, Space Grotesk, JetBrains Mono |
| 15 | No gradients / glass / neon / glow | ✅ | static test |
| 16 | No ThreeUI / Three.js / WebGL | ✅ | static test on imports; `package.json` unchanged |
| 17 | No page implementation changes | ✅ | `git status` |
| 18 | No route changes | ✅ | `git status` |
| 19 | No backend changes | ✅ | `git status` |
| 20 | No product logic changes | ✅ | `git status` |
| 21 | Accessibility checks pass | ✅ with limits | Accessibility section; no rendered or assistive-technology session |
| 22 | Primitive tests pass | ✅ | 175 / 175 |
| 23 | Existing client tests pass | ✅ | 3,165 / 3,165 |
| 24 | Token checks pass | ✅ | `tokens:check`, `check:tokens`, `tokens.test.js` inside the full suite |
| 25 | Production UI behaviourally unchanged | ✅ | byte-identical build; 0 importers |
| 26 | No unnecessary dependencies | ✅ | `client/package.json` unchanged |
| 27 | Legacy migration explicit | ✅ | Legacy Migration table |
| 28 | UNKNOWN items remain UNKNOWN | ✅ | 4 UNKNOWN rows (7 modules), not resolved |
| 29 | Working tree contains only approved Phase 3 changes | ✅ | see `git status` in the completion report |

---

## Findings

| # | Finding | Disposition |
|---|---|---|
| **F-1** | **Baseline.** The spec names `c738749`. PR #476 was squash-merged as `9872525`, whose tree is identical to `c738749` (📏 `5b6a68ca`), while `c738749` itself is not an ancestor of master. Branching from `c738749` would carry two commits whose content master already holds. | Branched from `9872525`: the same content, on master's history (CLAUDE.md PR Base Rule). |
| **F-2** | **Terminology conflict.** COMPONENT_RULES.md CMP-01 says "a primitive that knows about verdicts … is not a primitive" and REVIEW_GATE.md places Decision objects after G-3, while the Phase 3 spec asks for Decision primitives. | Implemented as two layers: `primitives/` (CMP-01) and `grammar/` (CMP-02 headers, grammar-named). The composed Decision object was not built. **🔒 Closed by FC-18 (Omar, 2026-09-14)** — see Phase 3 Closure §1. |
| **F-3** | **Dialog blocked on a token.** Article 16 requires a flat dimming backdrop for dialogs. No semantic token expresses one, and tokens are locked. So there is no `Dialog`, and a platform mutation's confirmation step has no primitive. | Needs a token ruling (a `color.overlay.backdrop` role or equivalent) before a dialog exists. |
| **F-4** | **No reaching path yet.** CMP-12 requires written → published → parsed → **rendered**. No surface consumes these parts. For `AgreementNote` specifically, `VERDICT_AGREEMENT` is backend-only, and the client schema strips `decisionAgreement` (Article 37, parse layer). | Parts are tested in isolation and in composition. The reaching-path item is met per surface in Phase 5. The agreement vocabulary is declared locally in `vocabulary.js` until it moves to `@marcom/runtime-contracts`. |
| **F-5** | **Money defaults in the canonical contract.** `lib/money.ts` defaults `code = 'USD'` and falls back to exponent 2 for undeclared codes. 📏 12 currencies are declared. Among the lines that call `formatCurrency(` (the only pattern searched), 8 legacy call sites pass `currency \|\| 'USD'` or `ccy = 'USD'`: `ScenarioPanel.jsx:21`, `CampaignDetailPanel.jsx:563`, `ConnectorCampaignsPanel.jsx:56`, `verdictEvidence.js:386`, `ApprovalsPanel.jsx:65`, `UnitEconomicsPanel.jsx:25`, `DecisionCard.jsx:116`, `PerformingWellSection.jsx:24`. | `Money` passes none of these defaults. `money.ts` and the call sites are untouched (product logic). A PR-12 cleanup slice is needed. |
| **F-6** | **Locale of the canonical formatter.** `formatCurrency` picks a per-currency locale (for example `ar-EG` for EGP), so EGP digits render in Arabic-Indic numerals inside an English UI. | **For LUMI `Money`: fixed at closure** (V-1). `Money` passes `en-US`, the UI language, through the canonical formatter's own `locale` parameter. `money.ts` and its 22 legacy callers are unchanged; their behaviour still needs a ruling. |
| **F-7** | **Hidden product logic in legacy UI** (H-1…H-5, Legacy Migration table): unknown verdict → HOLD (`signals.js`, live via Content Lab); client confidence bands (unreachable); grey fallback verdict pill; client colour banding in `InlineBar`; an empty sidebar list possibly rendered from a failed read. | Registered. Not moved into primitives. |
| **F-8** | **Presentation decisions made in Phase 3, for review:** instants render as `YYYY-MM-DD HH:MM UTC`; PROPOSED reads "Open"; the verdict mark is a 16px (`size.icon.inline`) square with `radius.control`; the human-record caption reads "You record what you did. LUMI changes nothing."; number figures use `en-US` grouping at the consumer's declared precision. | Open for Omar's review. None changes a locked value. |
| **F-9** | **Not built** (registry §8): Switch (0 uses), Tabs (1), Tooltip, Dialog (F-3), Delta, Skeleton, Attention mark, dedicated Reason / Outcome / Memory parts. | Each has its reason recorded. |
| **F-10** | **Instrument defect found and fixed** during the inventory (directory imports dropped on Windows). | Corrected before any count was used. |
| **F-11** | **Inherited documentation debt**, unchanged: governance status headers still say "awaiting Review Gate G-1"; the Constitution Article 26 §5 bundle budget is not restated. | Unchanged by this phase. |

---

## Gate

REVIEW_GATE.md G-3 (Primitives → Decision objects) — **author self-assessment,
not approval.**

| Question | Answer | Evidence |
|---|---|---|
| Q-1 Product truth preserved | YES | no state, verdict, agreement, currency or rate computed; PR-1, PR-2, PR-3, PR-5, PR-7, PR-12 enforced by refusals and tests |
| Q-2 Grammar visible | YES | CMP-02 headers; LUMI-Specific Primitives table |
| Q-3 Identifiable without the logo | NOT ASSESSED at first run → **rendered at closure** | Phase 3 Closure §5–§6; author observation only, the identity judgement is the approver's |
| Q-4 No AI convergence | YES | AC records; forbidden glyphs and effects refused |
| Q-5 No SaaS convergence | YES | no KPI, delta, card-grid or badge-pill part; CMP-04 boundary rule |
| Q-6 State semantics | YES | State Model |
| Q-7 Accessibility | YES with limits | Accessibility section |
| Q-8 Responsive | YES | no breakpoints encoded; coarse-pointer targets; min-width 0 |
| Q-9 Performance | YES | no dependency; production bundle byte-identical; unused parts are not bundled |
| Q-10 Numeric truth | YES | Measurement / Money refusals |
| Q-11 Action identity | YES | `ActionControl` |
| Q-12 Conflicts registered | PARTLY → **YES at closure** | FC-18 registered and ruled in Constitution Appendix A.1; FC-19 recorded in Phase 3 Closure §2 |
| Q-13 Authority diff | YES | Master Build Spec §15, §16, §17, §27, §29, §33 and §39 Phases 3–4 read; divergence in F-2 |

Phase 3 implementation criteria (spec §23):

- primitives implemented ✅
- token consumption clean ✅
- accessibility validated ✅ (with the limits stated)
- state semantics preserved ✅
- Decision Spine parts usable ✅
- legacy mapping exists ✅
- tests pass ✅
- existing production UI unchanged ✅
- no backend or product logic changed ✅

```text
READY FOR PHASE 4 — LANDING + VISUAL LANGUAGE
```

Carried to the approver at first run: the rendered identity tests (Q-3), the
FC-18 registration (F-2), the backdrop token question (F-3), and the presentation
decisions in F-8. Omar approved the technical implementation and opened the
closure gate below; Q-3 and F-2 are answered there. F-3 and F-8 remain open.

---

# Phase 3 Closure (2026-09-14 – 2026-09-15)

```text
Scope    FC-18 and FC-19 rulings · Primitive Lab · rendered visual review · the fixes it produced
Branch   feat/lumi-primitives (uncommitted) · HEAD 9872525
Rule     Every visual result below was observed in a rendered browser, or measured from the
         browser's computed styles. Nothing is extrapolated. Where something was not checked,
         it says so.
```

## 1. FC-18 — ruling

🔒 **RULED — Omar, 2026-09-14.** LUMI-specific product grammar elements are
**not** generic primitives. The grammar layer is **explicitly product-aware**.
Product Truth and the locked product grammar (PRODUCT_GRAMMAR.md) are unchanged.

Recorded as an FC-18 row in `design-governance/LUMI_DESIGN_CONSTITUTION.md`
Appendix A.1, the conflict register CLAUDE.md names. That one table row is the
only change to the file; no other governance text was touched.

## 2. FC-19 — ruling

🔒 **RULED — Omar, 2026-09-15.** Quiet actions ("Quiet", "Try again",
"I paused it myself") are **actions, not plain text**. They must be low-emphasis
but visibly actionable **before hover**, through the existing LUMI interaction
grammar:

- visible label;
- persistent structural affordance;
- adequate hit target;
- hover, focus-visible and pressed states;
- no verdict colour;
- no brand gold for prominence;
- no pill treatment used only to create affordance;
- accessible contrast.

Implementation and verification: §7 V-4.

## 3. Architecture

```text
FOUNDATION  →  GENERIC PRIMITIVES  →  LUMI GRAMMAR  →  PRODUCT SURFACE COMPONENTS  →  PAGES
tokens         client/src/lumi/       client/src/lumi/   (Phase 5)                     (Phase 5)
(Phase 2)      primitives/            grammar/
```

| Layer | Members | Rule |
|---|---|---|
| Foundation | `client/design-system/foundation/` → `--lumi-*` | the one token authority (Phase 2; unchanged) |
| Generic primitives | Environment, Surface, Stack, Inline, Rule, Text, Heading, VisuallyHidden, Icon, Announcement, Button, IconButton, TextLink, TextField, SelectField, CheckboxField, RadioGroup | CMP-01: grammar-agnostic; import no grammar part |
| LUMI Grammar | VerdictMark, TenseLabel, AgreementNote, DecisionIdentity, Spine, SpineStage, ClaimState, EvidenceGroup, Measurement, Money, ActionControl | CMP-02: product-aware; each file states grammar object · contract · states · why LUMI |
| Product surface components | — not built | composed from grammar parts at the next gate |
| Pages | — unchanged | Phase 5 migrates surfaces one at a time |

📏 Primitives import nothing from `grammar/`: no file under
`client/src/lumi/primitives/` imports `../grammar/`.

## 4. Primitive Lab — scope

| Item | Value |
|---|---|
| Entry | `client/lumi-lab.html` → `client/src/lumi/lab/main.jsx` |
| Served by | the Vite dev server only, at `/lumi-lab.html` |
| Built into production | **no** — `vite build` builds `index.html` alone (📏 §11) |
| Route / navigation link | none (📏 `lumi-lab` / `lumi/lab` appear only in the lab files, its test and the registry README) |
| Production import | none (📏 0 files outside `client/src/lumi/` import it) |
| Backend / API dependency | none. The lab imports only `react`, `react-dom/client`, `react-router-dom` (`MemoryRouter`), `lucide-react`, the self-hosted `@fontsource` families and the generated `tokens.css`. |
| Product behaviour | none. Every handler updates local lab state; "Pause campaign" in the lab sends nothing and says so. |
| Stylesheets | the generated `tokens.css` and LUMI CSS modules only; `client/src/index.css` and the legacy stylesheet are **not** loaded |
| Fixture labelling | the page states "Illustrative example — every name, id, time and figure on this page is a fixture, not product data." (Article 28) |
| Sections | Decision Spine · Typography · Surfaces · Verdicts · Controls · States · Evidence and measurements · Actions · Environments |
| Test | `client/src/lumi/__tests__/lab.test.jsx` (4 tests): every section renders with no contract refusal; fixtures labelled; SCALE / KILL disagreement in words with no arrows, strikethrough or action on NOW; no reference from `index.html` or `vite.config.js` |
| ThreeUI / Three.js / WebGL / shaders | none. The static test refuses their imports; `client/package.json` is unchanged. |

**`.claude/launch.json` was not retained.** It was created only to launch the
review server. Its single entry started the general client Vite dev server, which
also serves the full application at `/`, so it was not strictly scoped to the lab
and was deleted (it was never tracked).

## 5. Desktop visual review

**Instruments**

- **Browser pane:** Chromium, emulated viewport 1440 × 1000.
- **Playwright** `@playwright/test` (already a devDependency), headless Chromium at
  1440 × 900. Run from a scratch script outside the repository.
- **Computed styles** read from the live page with `getComputedStyle`.
- **Instrument control:** a planted element with a KILL border, a gold outline and a
  gradient was detected by the colour and effect scan (all three `true`), then
  removed. A scan that finds nothing is therefore evidence.

**Observed and measured (after the closure fixes)**

| Check | Result | Evidence |
|---|---|---|
| Dark-first product context | ✅ | `data-lumi-env="product"` → Charcoal ground; 📏 `color-scheme` computed `product:dark`, `marketing:light`, `marketing-dark-section:dark` |
| Current assessment vs stored decision | ✅ | rendered: `NOW computed 2026-09-14 09:20 UTC` · SCALE · "This differs from the decision recorded earlier: KILL." above `AT DECISION committed 2026-09-01 12:00 UTC` · KILL. Stacked in one column with a structural rule between; no arrow, strikethrough or side-by-side diff. |
| Verdict colour only in verdict marks | ✅ | 📏 whole-page scan of `color`, `background-color`, drawn borders and outlines: 0 verdict or gold values outside `[data-lumi-verdict]` marks; 16 mark backgrounds (6 claim + 6 list + SCALE + KILL in the spine + SCALE + HOLD in the dark section) |
| No colour-only meaning | ✅ | observed: every verdict mark has its word; states are read by words; links underlined; invalid input stated in words with a glyph |
| No gold focus / selection | ✅ | 📏 keyboard Tab to the "Standard" button: `:focus-visible` true, outline `solid 2px rgb(247, 247, 243)` (Off White) in Playwright; the same colour in the pane |
| No verdict colour as interaction colour | ✅ | 📏 hover `rgb(25, 29, 33)` = `interaction.hover.surface`; pressed `rgb(35, 38, 42)` = `interaction.pressed.surface` |
| No generic AI treatment | ✅ | 📏 0 elements with a background image, backdrop filter, filter, text shadow, or a box shadow outside the elevated overlay role; 📏 `document.getAnimations()` = 0; no sparkle, orb or glow observed |
| Typography | ✅ | 📏 text-bearing elements by first family: Inter 244, JetBrains Mono 48, Space Grotesk 12. The 12 are the h1, the 9 section h2s, one `heading.surface` sample and the brand display heading. 📏 Loaded faces: Inter 400/500/600, Space Grotesk 600, JetBrains Mono 400/500. |
| Spacing coherence | ✅ observed | relational tiers read consistently: inline within a statement, meta between a value and its window, object between stages, section between regions. The spine's hairline axis is continuous. |
| No fabricated numbers | ✅ | every figure sits on a page labelled "Illustrative example"; absence states show words, not digits (also tested) |
| No fake state | ✅ | every state on the page is passed explicitly by the lab; no part derives one |
| Horizontal overflow | ✅ | 📏 none |

**Artefacts** (`client/lumi-lab-review/`, captured by Playwright):

| File | Shows |
|---|---|
| `lab-desktop-1440.png` | full page, 1440 wide, before FC-19 |
| `lab-decision-spine-desktop.png` | SCALE assessment and KILL decision |
| `lab-controls-focus-visible.png` | keyboard focus ring on "Standard"; quiet actions before FC-19 |
| `fc19-controls-desktop.png` · `fc19-actions-desktop.png` · `fc19-failed-try-again-desktop.png` | quiet actions after FC-19, before hover |

## 6. Mobile / narrow visual review

| Check | Result | Evidence |
|---|---|---|
| Viewport | 375 × 812 | Browser pane mobile preset (touch emulation); Playwright `isMobile`, `hasTouch`, DPR 2 |
| Coarse pointer | ✅ | 📏 `matchMedia('(pointer: coarse)')` true |
| Hit targets | ✅ | 📏 smallest button 44px, smallest input or select 44px, smallest checkbox or radio label 44px (`size.target.touch`) |
| Horizontal overflow | ✅ | 📏 none in the pane and in Playwright; 0 elements extend past the viewport |
| Spine | ✅ observed | vertical, one axis; verdict, tense and the divergence line stay together before evidence |
| States and actions | ✅ observed | the review grid collapses to one column; the FAILED boundary and state words intact |
| Quiet actions after FC-19 | ✅ | 📏 44px tall, persistent bottom rule `1px solid rgb(115, 117, 118)` |

**Artefacts:** `lab-mobile-375.png` (full page, before FC-19) and
`fc19-actions-mobile.png` (after FC-19).

**Not checked:** tablet widths; zoom to 200% and 400%; a screen-reader session;
real touch hardware; the marketing environment at mobile width beyond the one
section in the lab.

## 7. Issues discovered — and 8. Fixes applied

| # | Issue (as observed) | Where | Fix | Verification |
|---|---|---|---|---|
| **V-1** | KWD rendered as `د.ك.‏ ٨٤٥٫٥٠٠`: Arabic currency symbol and Arabic-Indic digits, which JetBrains Mono does not contain, inside a mono figure in an English UI | `Money` → `money.ts formatCurrency` picks a locale per currency (`ar-KW`) | `Money` passes `'en-US'` through the canonical formatter's own `locale` parameter (Article 20 §7). No new formatter; `money.ts` unchanged. | 📏 rendered `KWD 845.500` in mono; `states.test.jsx` asserts equality with `formatCurrency(…, 'en-US')` and no U+0660–0669 or U+06F0–06F9 digits; 📏 removing the locale makes 3 tests fail |
| **V-2** | The evidence question heading ("Is it working?") was as bright and heavy as the verdict word | `grammar.module.css .evidenceHeading` used `text.claim` | heading light → `color.text.body`, so evidence steps down from the verdict (Article 11 §3) | observed after reload: SCALE is the most lit word in its stage. No automated test (a CSS light choice). |
| **V-3** | Native checkbox and radio controls rendered light (white) on Charcoal | no `color-scheme` declared, so the form controls used the light default | `Environment` sets a fixed `color-scheme` from its ground: charcoal → dark, offWhite → light. Not a media query, not a preference (PR-9). | 📏 computed `product:dark` / `marketing:light` / `marketing-dark-section:dark`; observed dark controls. No automated test (jsdom does not compute `color-scheme`). |
| **V-4** | Quiet actions ("Quiet", "Try again", "I paused it myself", "Review closed decisions") read as plain text until hover or focus | `controls.module.css .quiet` had a transparent border on every side | 🔒 **FC-19:** `.quiet` keeps its body-light label and no box, and gains a persistent bottom rule in `border.strong` (Article 18: rules over boxes). Disabled quiet uses `interaction.disabled.border`. Standard stays fully bounded, so the two prominences stay distinct. | 📏 before hover every quiet action has `border-bottom: 1px solid rgb(115, 117, 118)` with the other sides transparent; disabled `rgb(58, 61, 65)`. Hover `rgb(25, 29, 33)`. Pressed (real held mouse, `:active` true) `rgb(35, 38, 42)`. Focus ring as §5. Height 38px desktop / 44px coarse. Observed in captures. Static test pins all three rules. |

**Not issues** (checked and cleared):

- The first hover reading was `rgba(0,0,0,0)`. It was re-measured after the 100ms
  feedback transition: `rgb(25, 29, 33)`, with 0 running animations.
- Region zoom is not supported in the Browser pane, so detail was taken from computed
  styles and Playwright element captures instead.

**Observed, not fixed (open):** the lab's own "Last activated" announcement shifts
the controls cell when it appears. It is lab chrome, not a primitive. F-3 (no
dialog or backdrop token) and F-8 (presentation decisions) stay open. FC-19's
contrast basis is the declared `border.strong` pair (📏 Phase 2: ≥ 3.46 : 1 on
Charcoal, ≥ 3.16 : 1 on Off White). It was not re-measured in the browser.

## 9. Accessibility findings

| Finding | Status |
|---|---|
| Focus visible, neutral, on `:focus-visible`, reached by real Tab presses | ✅ measured |
| Hit targets ≥ 24px fine pointer (38px observed) and ≥ 44px coarse pointer | ✅ measured |
| Quiet actions identifiable before hover (FC-19), boundary in a ≥ 3 : 1 token | ✅ fixed and measured |
| Native form controls legible on the ground (V-3) | ✅ fixed |
| Verdicts and states understandable without colour | ✅ observed |
| Figures render in JetBrains Mono with Latin digits (V-1) | ✅ fixed |
| Disabled controls: focusable, reason visible and announced | ✅ (tests; observed in lab) |
| Screen reader, zoom 200/400%, forced colours, tablet | **not performed** |

## 10. State / verdict review

- **All six verdicts** rendered in claim and list contexts, and each read correctly by
  its word. HOLD (orange), REFRESH (amber) and REALLOCATE (gold) are close in hue, as
  FC-3 predicts; the words disambiguate them. REALLOCATE's mark renders from
  `color.verdict.reallocate.mark`.
- **All 16 claim states** rendered side by side with distinct words. Observed pairs:
  - FAILED is bounded and bright, EMPTY is an unbounded finding;
  - UNAVAILABLE, NOT_CONNECTED and NOT_SUPPORTED read differently;
  - PARTIAL and STALE show the value beside their qualifier;
  - LOADING shows no figure;
  - NOT_PERMITTED shows the lock glyph and "Requires GROWTH".
- **DISABLED** is shown on buttons, a text field and a checkbox, each with its reason.
- **Measurements:** value states render mono figures with their window. The five
  absence states render state words in place of a number, keeping label and window.
  `Money` shows "Currency not reported" and "CHF amounts cannot be shown yet"
  with no digits.
- **Actions:** platform mutation is boxed with "LUMI will do this on Meta"; the human
  record is quiet with "You record what you did. LUMI changes nothing." Refused
  renders its copy with no control; processing shows the stage; 409 and role
  refusals render disabled with reasons.

## 11. Production-isolation verification

| Check | Result |
|---|---|
| Production build vs the pre-Phase-3 baseline, after V-1…V-3 | 📏 **119 / 119 files byte-identical** (every path and SHA-256 equal) |
| Lab in `dist` | 📏 no `lumi-lab` / `LumiLab` file; the string "Primitive Lab" absent from every built JS asset |
| FC-19 (V-4) and build output | not rebuilt: V-4 changes only `client/src/lumi/primitives/controls.module.css` and a LUMI test. 📏 0 application files import `client/src/lumi`, and Tailwind does not scan it (probe-verified in Phase 3), so no production asset can contain it. |
| Application imports of the lab or of `client/src/lumi` | 📏 0 |
| Routes, navigation, `index.html`, `vite.config.js` | unchanged (git; `lab.test.jsx`) |

## 12. Files changed (tracked, `git diff --name-only`)

| File | Change | When |
|---|---|---|
| `DESIGN_TOKEN_ARCHITECTURE.md` | new §16 (token consumption) | Phase 3 |
| `client/tailwind.config.js` | `'!./src/lumi/**'` content exclusion + comment | Phase 3 |
| `design-governance/LUMI_DESIGN_CONSTITUTION.md` | one row: FC-18 in Appendix A.1 | closure |

## 13. Files created (untracked)

```text
PHASE_3_PRIMITIVE_AUDIT.md                               this record
client/lumi-lab.html                                     closure · lab entry (dev only)
client/lumi-lab-review/                                  closure · 8 PNG review captures
client/src/lumi/README.md                                Phase 3 · registry (FC-18 layer names added at closure)
client/src/lumi/contract.js · index.js                   Phase 3
client/src/lumi/primitives/*.jsx · *.module.css          Phase 3 (closure edits: Environment.jsx, layout.module.css V-3; controls.module.css V-4)
client/src/lumi/grammar/*.jsx · vocabulary.js · grammar.module.css
                                                         Phase 3 (closure edits: Measurement.jsx V-1; grammar.module.css V-2)
client/src/lumi/lab/{main, LumiLab, LabSection}.jsx · lab.module.css
client/src/lumi/lab/sections/{Foundation, Controls, States, Decision}Section.jsx
                                                         closure · Primitive Lab
client/src/lumi/__tests__/lab.test.jsx                   closure
client/src/lumi/__tests__/{tokenUsage, states}.test.*    Phase 3 (closure edits: lab CSS in the audited list; FC-19 rules; V-1 locale)
```

`.claude/launch.json` was created for the review and **deleted** (§4).

## 14. Validation results

| Check | Result | When |
|---|---|---|
| LUMI tests | 📏 **188 / 188** in 7 files: tokenUsage 65 · states 50 · grammar 27 · primitives 23 · controls 14 · composition 5 · lab 4 | after FC-19 (187 before it; +1 FC-19 test) |
| Full client suite | 📏 **232 files / 3,177 tests passed**, exit 0 | after V-1…V-3, before FC-19. FC-19 touches only LUMI CSS and a LUMI test, and the LUMI tests were rerun. |
| `npm run lint:ci` | pass (exit 0) | after V-1…V-3 |
| `npm run tokens:check` | pass | after V-1…V-3; no token file changed since |
| Production build equivalence | 📏 119 / 119 byte-identical | after V-1…V-3; see §11 for FC-19 |
| Mutation: `Money` without the UI locale | 📏 caught (3 tests fail) | closure |
| Not rerun at closure (by instruction) | `check:tokens`, root `check`, root `lint`, backend tests | last results in Validation above |

**Final safety check (git, closure):**

| Area | Changed? |
|---|---|
| backend (`src/**`), API (`client/src/lib/api.js`, `client/src/api/**`), database (`prisma/**`) | no |
| routes (`App.jsx`, `routeManifest.js`, `router/**`) | no |
| production pages, landing page, app shell, `index.html`, `index.css`, `main.jsx` | no |
| product logic (`features/**`, `hooks/**`, `contracts/**`, `design-system/**`, `lib/money.ts`) | no |
| token architecture (`client/design-system/foundation/**`) | no |
| legacy tokens, legacy primitives | no |
| `client/package.json`, root `package.json`, lockfile | no |
| ThreeUI, Three.js, WebGL, shaders | none |
| Phase 4 work | none |

## Closure gate

| Closure item | Status |
|---|---|
| FC-18 recorded | ✅ Constitution Appendix A.1 + §1 |
| FC-19 implemented and verified | ✅ §7 V-4 |
| Visual review performed (desktop + narrow) | ✅ §5, §6 |
| Issues and fixes recorded exactly | ✅ §7–§8 |
| Production isolation | ✅ §11 |
| No commit, no push, no Phase 4 | ✅ |

```text
READY FOR PHASE 4 — LANDING + VISUAL LANGUAGE
```
