# LUMI ANTI-CONVERGENCE

```text
Status   FOUNDATION — mandatory governance, not design taste; awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
```

## 0. Why this exists

Convergence is the default outcome. Component libraries, framework defaults,
AI-generated layouts and "best practice" screenshots all pull every product
toward the same dark SaaS interface with an accent colour.

LUMI's quality bar fails if the result reads as **"a nice dark SaaS UI with gold
accents."** It must communicate that LUMI reveals signal, organises evidence,
produces decisions, connects action to outcome, and accumulates memory, and it
must be identifiable **without its logo**.

Charcoal with gold is not, by itself, distinctive. It is one step from that
failure. **Identity must come from the grammar and its expression** (the
Decision Spine, tense, illumination hierarchy, measured absence), not from the
palette.

---

## 1. When the tests run

| Artefact | Tests required | Recorded where |
|---|---|---|
| Any new component (COMPONENT_RULES.md CMP-10) | AC-1…AC-6 | component header + review record |
| Any new surface or major layout | AC-1…AC-6 | review record |
| Landing and marketing sections | AC-1…AC-6 | review record |
| A token or palette change | AC-1, AC-4 | review record |
| Minor variant of an approved component | AC-5, AC-6 | PR description |

**Outcome rule.**

- **AC-5 (Transfer) FAIL → blocked.**
- **AC-6 (Why LUMI) FAIL → blocked.**
- A FAIL on AC-1…AC-4 blocks unless the review record names the resemblance and
  explains why LUMI needs it (for example, a text input looks like a text input
  because that is what makes it usable).

---

## 2. The tests

### AC-1 · Visual resemblance test

**Question:** With logo and product copy removed, does this artefact look like
a recognisable product, framework default or template?

**Procedure**

1. Replace the wordmark and every LUMI noun with neutral placeholders.
2. Compare against:
   - the default output of the underlying framework (stock Tailwind or shadcn
     components with default tokens);
   - the dominant AI assistant products;
   - the dominant analytics dashboards.
3. List every resemblance. Note especially framework-default values (for example
   a stock framework blue, default radii, default shadows).

**Fail signals**

- stock component styling with only the colour changed;
- default radii and shadows;
- the gold used the way other products use their accent (every primary button,
  links, focus, active tab).

### AC-2 · Structural resemblance test

**Question:** Is the *layout skeleton* the same as a generic product, even if the
styling differs?

**Procedure:** Reduce the artefact to grey boxes. Would the box diagram be
equally valid for a generic analytics or AI product?

**Fail signals**

- the page is a KPI strip → chart grid → table;
- a left nav → header with search and avatar → equal-card grid;
- a chat column beside content;
- a hero → three feature cards → pricing trio → FAQ, as the whole marketing
  structure with no product-specific band.

**LUMI pass signal:** the skeleton only makes sense for **a call and its
grounds**. A primary axis carries VERDICT → WHY → EVIDENCE → ACTION → OUTCOME →
MEMORY, or a partition of open calls by what the person has done.

### AC-3 · Behavioural resemblance test

**Question:** Does it *behave* like a generic product?

**Fail signals**

- the primary interaction is typing a prompt;
- results stream in like chat;
- the product greets the user conversationally;
- a "suggested prompts" row;
- infinite feeds;
- notifications that count unread items;
- "Approve / Reject" buttons implying LUMI acts when the person is actually
  recording;
- actions offered for every verdict.

**LUMI pass signal:**

- the surface opens with the call;
- actions exist only where the backend offers them, bound to a Decision id;
- absence names its cause;
- nothing moves at rest.

### AC-4 · Decorative resemblance test

**Question:** Is any element present only to make the product look modern,
intelligent or premium?

**Fail signals:** any VISUAL_BOUNDARIES.md VB-F1…VB-F16 signal. In particular:

- sparkles or orbs;
- gradients;
- glows;
- glass;
- pulses;
- decorative charts;
- background grids;
- emoji status;
- upsell shimmer.

**Procedure:** Remove the element. If no information is lost, it was
decoration: **remove it**.

### AC-5 · Transfer test

**Question:** Could this component be dropped into **ChatGPT, Claude, Gemini,
Perplexity, or a generic SaaS product** with almost no change?

**Procedure**

1. Write one sentence describing what the component does, with LUMI nouns
   removed.
2. If the sentence is still a complete and useful description of a component in
   one of those products, the answer is YES.

**YES → FAIL.**

**Interpretation for primitives.** A text input, checkbox or focus ring *will*
transfer. That is acceptable only at the primitive layer (CMP-01), which is
grammar-agnostic by definition. The Transfer Test is decisive for **components
and surfaces** (CMP-02 and up).

### AC-6 · Why LUMI test

**Question:** Why does this component exist **specifically in LUMI**?

**Procedure:** Write the answer in one or two sentences that must reference at
least one of:

- a grammar object;
- a locked ruling;
- a published contract field.

If the answer can only reference generic user needs ("users want to see their
data", "it looks clean"), it fails.

**Examples**

| Component | Why LUMI answer | Result |
|---|---|---|
| `TenseLabel` | "Constitution R-1 and PR-1: every verdict is NOW or AT DECISION, and a live verdict must never pass as the stored one." | PASS |
| `ActionGroup` (by decision id, platform vs record) | "PR-2 binds every action to a Decision id; B8-03 invariant 9 requires 'LUMI will do this' and 'I did this' to be unmistakable." | PASS |
| `MeasurementNote` | "B8-01 L-6: a figure without its window does not appear." | PASS |
| `StatCard` with delta arrow | "Shows a metric and how it changed." | **FAIL** — generic; no window, no claim |
| "AI Insights" panel with sparkle | "Shows AI-generated insights." | **FAIL** — generic; PR-8 |

---

## 3. Explicit failure patterns

Each is a real instance from the legacy frontend (audit §17, §18, §22, §23),
or a common convergence it resembles.

| # | Pattern | Tests failed | Legacy instance | LUMI alternative |
|---|---|---|---|---|
| F-1 | Persistent chat panel with "Ask about your campaigns…", bubbles and typing indicator on the home view | AC-2, AC-3, AC-5 | `CopilotPanel` on Attention | Copilot entered from a Decision, explaining its evidence (PR-8) |
| F-2 | "AI Copilot" page with bot icon, "Early access" chip and tiles | AC-1, AC-4, AC-5 | `CopilotPage` | not built on (PR-8) |
| F-3 | Sparkles on "Lumi's read" | AC-4, AC-5 | `Sparkles` icon | no icon; the reasoning itself |
| F-4 | KPI strip / stat cards as the page header | AC-2, AC-5 | `KpiStrip`, `StatCard`, `MetricTile` | the call first; figures as evidence with windows |
| F-5 | Static liveness: "WATCHING" pulse, radar strip | AC-3, AC-4 | `Sidebar.jsx:182-196`, `RadarStrip` | nothing, unless a published process state (PR-11) |
| F-6 | Pseudo-system status: "Context: Locked", "Dual-Agent Ready", fabricated SID | AC-1, AC-4 | `ContextBar.jsx:14,23,31` | removed (PR-10) |
| F-7 | Glow shadows on primary CTAs | AC-1, AC-4 | `shadow-accent-glow`, `shadow-gold-glow` | neutral action styling; no glow |
| F-8 | Animated gradient loader | AC-4 | `LumiLoader` | structure first, light on arrival (MOTION_RULES.md MO-4) |
| F-9 | Coloured verdict pill with the word inside, at 9–10 px | AC-1, AC-5 | `DecisionPill` sizeConfig | verdict word + mark, legibility floor |
| F-10 | Landing: capability card grid, "trusted by" trio, pricing trio | AC-2, AC-5 | `CapabilitiesGrid`, `TrustedBy`, `Pricing` | product bands that show a call and its grounds, illustrative and labelled (PR-7) |
| F-11 | Landing claim "Always watching" | AC-3 | `CapabilitiesGrid` | forbidden (Constitution Article 30) |
| F-12 | Emoji as status icons | AC-1, AC-4 | Observability `MetricCard` `▶ ⏸ ⏳ ✖` | functional icons + published status |
| F-13 | Decorative workflow and collision graphs | AC-4 | Operations demo graphs | none unless Article 23's three answers exist |
| F-14 | Hiding plan-locked features | AC-3 | `Sidebar.jsx:248-256` | shown locked (PR-4) |
| F-15 | Shimmer skeleton loaders | AC-1, AC-4 | common convergence | STATE_RULES.md §1 |
| F-16 | Framework-default blue for an informational state | AC-1 | WATCH's value equals a stock framework blue | referenced only as `verdict.watch`; never used for links or info states (DESIGN_TOKEN_ARCHITECTURE.md §4) |

---

## 4. Record format

```text
ARTEFACT        <name / path / Figma frame>
DATE · REVIEWER <date> · <name>
AC-1 Visual      PASS | FAIL — resemblances: …  justification (if kept): …
AC-2 Structural  PASS | FAIL — …
AC-3 Behavioural PASS | FAIL — …
AC-4 Decorative  PASS | FAIL — elements removed: …
AC-5 Transfer    PASS | FAIL — neutral sentence: "…"
AC-6 Why LUMI    PASS | FAIL — "…" (cites: grammar object / ruling / contract field)
RESULT          APPROVED | BLOCKED
```
