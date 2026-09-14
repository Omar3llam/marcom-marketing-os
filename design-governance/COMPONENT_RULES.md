# LUMI COMPONENT RULES

```text
Status   FOUNDATION — rules only; NO component is built in Phase 1; awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
```

These rules govern the component library that Phases 3 onward will build.
They apply equally to a designer adding a Figma component and to an engineer
adding a file.

---

## CMP-01 · When a primitive is justified

A **primitive** is a grammar-agnostic building block: text role, button, input,
rule, surface, icon, focus ring, visually-hidden text, live region.

A primitive is justified only when **all** hold:

1. It expresses a **token category**, not a look: it has no semantic colour and
   no product meaning.
2. At least two grammar components need it **with the same behaviour**.
3. Its accessibility contract (role, name, keyboard, focus, target size) is
   written before its visuals.
4. It has no data fetching and no product state logic.

A primitive that knows about verdicts, Decisions or plans is not a primitive.
It belongs in CMP-02.

## CMP-02 · When a component is justified

A **component** expresses a grammar object (PRODUCT_GRAMMAR.md) or a supporting
object in its service.

A component is justified only when it can state, in its header:

```text
GRAMMAR OBJECT    which of VERDICT · REASON · EVIDENCE · DECISION · ACTION · OUTCOME
                  · MEMORY · ATTENTION · MEASUREMENT it expresses (or which it serves)
CONTRACT          the published fields it renders, and their schema
STATES            every state from STATE_RULES.md that its contract can produce,
                  and how it expresses each
WHY LUMI          its answer to the Why LUMI Test (ANTI_CONVERGENCE.md AC-6)
```

A component whose contract can produce a state it does not express is
**incomplete**, however correct its happy path is (B8-02: a view model that
cannot express "we could not read it" is incomplete).

**Name it by grammar, never by look.** Good: `VerdictMark`, `DecisionSpine`,
`EvidenceGroup`, `TenseLabel`, `ActionGroup`, `MeasurementNote`,
`NotPermittedState`. Bad: `GoldPill`, `FancyCard`, `InfoBox`, `StatTile`.

## CMP-03 · Truth boundaries every component obeys

1. **Render, never recompute.** No verdict, class, confidence band, eligibility,
   executability, rate or staleness is derived in a component. The server
   publishes it (audit §31; PR-3).
2. **No fallbacks at the presentation boundary.** No `?? []`, `?? 0`, `|| 0`,
   `?? 'USD'`, default tone, or `unknown → HOLD` (B8-02; audit P0-14).
3. **An unknown token throws or renders an explicit refusal.** It never
   inherits a neighbour's rendering.
4. **An action takes a `decisionId`.** Where a component holds a Decision id, it
   never calls a by-entity mutation (🔒 PR-2).
5. **No action where the backend refuses one.** The `NOT_EXECUTABLE` reason is
   rendered as the copy (B8-01 L-11).
6. **No AI-authored numerals** unless the response contract marks each numeral's
   evidence (🔒 PR-7, PR-8).
7. **No static status** (🔒 PR-10, PR-11).

## CMP-04 · When a card (bounded container) is justified

Ask in order. Stop at the first YES.

| # | Question | If YES |
|---|---|---|
| 1 | Is this region **one meaningful object** (one Decision, one experiment, one belief)? | container allowed |
| 2 | Is it an **evidence group** sharing one population and window? | container allowed |
| 3 | Is it a **decision group** sharing one Attention partition? | container allowed |
| 4 | Is it the **action group** of one Decision? | container allowed |
| 5 | Can this region be **independently unavailable or failed** while its neighbours are fine? | container allowed |
| — | none of the above | **no container**: use alignment, a spacing tier, or a rule |

**Automatic fail** in any of these cases:

- equal containers tiled only because there are several items;
- a container used to make content look important;
- containers nested inside containers without a second CMP-04 YES;
- a container whose only content is one metric.

## CMP-05 · When to use a table

A table is justified when **all** hold:

1. The rows are **parallel records of one kind**, and the reader needs to
   compare them on the **same named attributes**.
2. The population is **named by a claim or by an operational destination**
   (connectors, executions, team, audit log). It is never "all entities".
3. Every numeric column carries its window in the header or as a caption.
4. Sorting, if offered, uses only orderings the backend publishes or that are
   meaning-neutral (name, time). **A metric-ordered list of campaigns turns the
   surface into a dashboard** (B7-08: Campaigns has no browsable list; B8-04:
   sortable metric tables are forbidden unless a claim names them).

On narrow layouts a table becomes a list of labelled records (Constitution
Article 25). A table is never the first thing on a decision-bearing surface.

## CMP-06 · When to use a chart

Only with the three written answers (Constitution Article 23):

```text
WHAT QUESTION?   WHAT EVIDENCE?   WHAT DECISION?
```

Additionally:

- one population and one window per axis;
- gaps for absent points, not zeros;
- currency charts obey `MIXED_CURRENCY`;
- no animated growth from zero;
- an accessible text equivalent that states the finding, not just
  "chart of spend".

## CMP-07 · When to use a badge

A badge is a small, **non-interactive** label for a **published categorical
fact**. Permitted badges:

- the verdict mark (always paired with its word);
- Decision class;
- Decision status;
- tense (`NOW` / `AT DECISION`);
- plan lock;
- execution stage.

A badge is **not**:

- a button;
- a count of unread items (no acknowledgement fact exists, B7-03);
- "NEW" on a Decision (open ≠ new, B7-01);
- "AI" or "✨";
- "LIVE" or "WATCHING" (PR-11);
- a decoration;
- a pill-shaped chip by default (Constitution Article 19).

Maximum one verdict badge per Decision. Maximum one badge per categorical fact.

## CMP-08 · When to use Gold

Gold is permitted for exactly three jobs (Constitution Article 12):

| Job | Rule |
|---|---|
| **LUMI mark** | per VISUAL_BOUNDARIES.md §5 |
| **Attention signal** | one per region, on the single item that needs a person first |
| **REALLOCATE verdict mark** | via `verdict.reallocate` tokens, never via brand tokens (DESIGN_TOKEN_ARCHITECTURE.md §4) |

Gold is **never**:

- a button fill by default;
- a link;
- a focus ring;
- hover or selected state;
- a success colour;
- a border for emphasis;
- a gradient;
- a glow;
- a large area;
- text on Off White or Warm Gray (📏 2.21 : 1 and 1.84 : 1).

## CMP-09 · When to use semantic verdict colours

1. Only to mark a **verdict** on a Decision or on an assessment, as a mark
   **beside** the verdict word.
2. Never on an action control. The Pause button is not KILL-red (PR-5).
3. Never as text at body size. KILL on Charcoal is 4.02 : 1 (📏).
4. Never as a fill with text inside it. No neutral reaches 4.5 : 1 on a KILL
   fill (📏).
5. Never as a category palette for unrelated data (channels, campaigns, chart
   series).
6. Never to show change between two verdicts (B7-06: named, not diffed).
7. On marketing pages, only inside Charcoal sections (📏 FC-4).
8. No new verdict colours without a ruling.

## CMP-10 · When to create a new component

Create one only when **all** hold:

1. It passes CMP-01 (primitive) or CMP-02 (component).
2. **No existing component expresses the same grammar object with the same
   states.** Check the new registry, which is created in Phase 3 and supersedes
   `client/design-system/ui-registry.md`.
3. It passes the Transfer Test and the Why LUMI Test (ANTI_CONVERGENCE.md).
4. It respects the file-size budgets in `CLAUDE.md` (UI primitive ≤ 150 lines).
   These are **not** superseded by PR-13 (FC-9).
5. It imports nothing from the legacy primitive layers:
   - `client/src/primitives`;
   - `client/src/components/primitives`;
   - `client/src/components/ui` legacy maps such as `DecisionPill.verdictConfig`;
   - `client/src/design-system/signals/signals.js`.

## CMP-11 · When to consolidate

Consolidate when **any** holds:

1. Two components express the **same grammar object** with the same states,
   whatever their look.
2. Two colour maps, formatters or state adapters exist for the same concept.
   Examples: two `formatCurrency`s (PR-12), two verdict maps (audit §15).
3. A component's variants differ by look only, not by grammar or state.

Consolidation **never** merges different grammar objects because they look
alike. A Decision and an assessment share visual parts; they are not one
component with a `tense` switch that hides controls. The action group is absent
from an assessment by construction (PR-1).

**Legacy consolidation targets** (audit §27), each to be resolved into one new
home in later phases:

- state containers;
- loaders;
- panels;
- metric displays;
- verdict display and colour maps;
- the typography API;
- modals;
- error boundaries;
- currency formatting;
- server-state fetching;
- colour token namespaces.

## CMP-12 · Definition of done for any component (Phase 3 onward)

- [ ] Header: grammar object · contract · states · why LUMI.
- [ ] Every contract-producible state rendered and tested, including the
      reaching path (written → published → parsed → **rendered**).
- [ ] No fallback values; an unknown token throws or refuses.
- [ ] Uses tokens only; token-resolution and lint checks pass.
- [ ] Keyboard, focus, name, role, target size and contrast verified.
- [ ] Reduced-motion behaviour defined for any motion.
- [ ] Transfer Test and Why LUMI Test recorded (ANTI_CONVERGENCE.md).
- [ ] No VB-F finding (VISUAL_BOUNDARIES.md).
