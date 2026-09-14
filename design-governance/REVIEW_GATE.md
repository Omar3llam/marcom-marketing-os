# LUMI REVIEW GATE

```text
Status   FOUNDATION — mandatory; awaiting its own first approval at G-1
Date     2026-09-14 · base a3ec116
Approver Omar (Product Owner). Author self-assessment is never approval (Constitution Article 36).
```

## RG-0 · The rule

No work moves **from foundation to implementation**, or between later phases,
without passing its gate.

> **If any critical answer is NO, do not proceed.**

A gate records, for every question, an answer, **the evidence**, and the
approver. An answer without evidence counts as NO.

## RG-1 · The gates

| Gate | Moves from → to | Artefacts reviewed |
|---|---|---|
| **G-1** | Phase 1 Foundation → Phase 2 Design Tokens | the 10 `design-governance/` documents + `DESIGN_TOKEN_ARCHITECTURE.md` |
| **G-2** | Phase 2 Tokens → Primitives | token files, resolved light steps, contrast-pair manifest, lint and resolver results |
| **G-3** | Primitives → Decision objects (grammar components) | primitives with accessibility contracts; AC records |
| **G-4** | Decision objects → Surfaces | grammar components with all states rendered on the reaching path |
| **G-5** | Each surface → merge | the surface, behavioural parity against the pinned legacy behaviour, identity tests on the rendered result |
| **G-6** | Surface parity proven → legacy removal | the hidden-logic register (Constitution Article 37) closed for that surface |

The gates follow the migration sequence in the Phase 1 brief (§37) and in
Constitution Article 37. Every implementation gate (G-2 onward) also inherits
the repository's delivery rules: one slice per PR, based on `master`, verified
from `origin/master` by content, never by badge (`CLAUDE.md`, PR Base Rule).

## RG-2 · Gate questions

**C = critical.** A NO on a critical question stops the gate.

| # | Question | C | Evidence required |
|---|---|---|---|
| Q-1 | **Product truth preserved?** No rule, token or component contradicts backend truth, the Constitution (R-1…R-8), or PR-1…PR-13 | C | a citation per affected rule; no state derived from data shape; no recomputation |
| Q-2 | **LUMI grammar visible?** The artefact expresses grammar objects, and supporting objects serve them | C | PRODUCT_GRAMMAR.md mapping per component or surface |
| Q-3 | **Visual identity distinctive?** Identifiable without the logo | C | Identity Test 1 (RG-4) on the artefact |
| Q-4 | **No generic AI convergence?** | C | ANTI_CONVERGENCE.md AC-1…AC-6 records; no VB-F4…VB-F7, VB-F11 signal |
| Q-5 | **No generic SaaS convergence?** | C | AC-2, AC-5 records; no VB-F10, VB-F13, VB-F14 signal |
| Q-6 | **State semantics preserved?** Every contract-producible state is expressed distinctly | C | STATE_RULES.md coverage table per component; failure ≠ empty, missing ≠ zero, unknown ≠ healthy |
| Q-7 | **Accessibility considered?** WCAG 2.2 AA where practical | C | contrast-pair verification; keyboard / focus / target / semantics checklist |
| Q-8 | **Responsive principles defined / honoured?** | C | Constitution Article 25 table applied; no hidden capability at any width |
| Q-9 | **Performance considered?** | — | bundle and font budget measurements; motion on composited properties only |
| Q-10 | **Numeric truth?** No fabricated or unwindowed figure; illustrative figures labelled | C | PR-7 checklist |
| Q-11 | **Action identity?** Actions bound to a Decision id; verdict ≠ action | C | PR-2 / PR-5 checklist; no by-entity mutation where an id is held |
| Q-12 | **Conflicts registered?** Every discovered conflict is in Appendix A of the Constitution, not silently resolved | C | Appendix A diff |
| Q-13 | **Authority diff done?** The artefact was checked against the actual Master Build Spec | C for G-2 onward | reviewer confirms the spec was available (⚠️ FC-10) |

## RG-3 · Record format

```text
GATE            G-n  <from → to>
DATE            <date>
ARTEFACTS       <paths / frames>
Q-1 … Q-13      YES | NO — evidence: …
CONFLICTS       <new FC-n, or "none">
IDENTITY TESTS  Test 1: <YES/NO>   Test 2: <YES/NO>
AUTHOR SELF-ASSESSMENT   <answers>
APPROVER        <name> — APPROVED | BLOCKED — <date>
```

## RG-4 · Final identity tests

These are run at every gate from G-1 onward. At G-1 there is no rendered
artefact, so they are run on the **specification**. From G-3 onward they must
be re-run on rendered artefacts, and a specification-level pass does not carry
over.

**Test 1.** Remove the LUMI logo. Does this feel like generic AI or SaaS?
Expected **NO**. YES → FAIL.

**Test 2.** Does the system make sense *because* LUMI reveals what matters and
organises decisions, evidence, actions, outcomes and memory? Expected **YES**.
NO → FAIL.

---

# RG-5 · Phase 1 run — author self-assessment for G-1

```text
Run date   2026-09-14
Base       a3ec116
Runner     Claude Code (author) — NOT approval; Omar approves G-1
```

## RG-5.1 · Phase 1 completion gate (brief §45)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Design Constitution exists | ✅ | `design-governance/LUMI_DESIGN_CONSTITUTION.md`: all 25 required topics (Brand Core → Articles 1–5; Grammar → 6–8; Visual Territory + Boundaries → 10; Color → 12; Layout, Density, Surfaces, Cards, Borders, Radius → 14–19; Typography → 20; Accessibility → 21; Iconography → 22; Data Visualisation → 23; Motion → 24; Responsive → 25; Performance → 26; State Semantics → 27; Anti-Convergence, Governance, Review → 34–36) |
| 2 | Product Grammar exists | ✅ | `PRODUCT_GRAMMAR.md` §2–§10: 9 objects × 7 fields |
| 3 | Visual Boundaries exist | ✅ | `VISUAL_BOUNDARIES.md` §2: 8 approved; §3: 16 forbidden |
| 4 | Component Rules exist | ✅ | `COMPONENT_RULES.md` CMP-01…CMP-12 (all 10 required topics) |
| 5 | State Rules exist | ✅ | `STATE_RULES.md` §1–§15: 14 required states + NOT_SUPPORTED, each with meaning / trigger / allowed / forbidden |
| 6 | Motion Rules exist | ✅ | `MOTION_RULES.md` MO-1…MO-8 (purpose, timing, easing, reveal, feedback, transition, reduced, forbidden) |
| 7 | Anti-Convergence exists | ✅ | `ANTI_CONVERGENCE.md` AC-1…AC-6 + 16 failure patterns |
| 8 | Reference Policy exists | ✅ | `REFERENCE_POLICY.md` RP-0…RP-7 |
| 9 | Review Gate exists | ✅ | this document |
| 10 | Token architecture exists | ✅ | `DESIGN_TOKEN_ARCHITECTURE.md`: 10 categories; brand vs product-state separation (§4) |
| 11 | Brand foundation documented | ✅ with FC-10 | Constitution Articles 1–5; logo requirements in VISUAL_BOUNDARIES.md §5. The approved asset is not in the repository, so variant measurements wait for it |
| 12 | Typography locked | ✅ families and roles · 🧪 sizes | Constitution Article 20; sizes are Phase 2 (DESIGN_TOKEN_ARCHITECTURE.md §9) |
| 13 | Color semantics locked | ✅ | Constitution Article 12; token separation §4; 📏 contrast and ΔE measured |
| 14 | Theme direction locked | ✅ | Constitution Article 13 (PR-9) |
| 15 | Verdict vocabulary locked | ✅ | PRODUCT_GRAMMAR.md §2 (PR-5; Prisma `enum Verdict`) |
| 16 | Copilot boundary documented | ✅ | Constitution Article 32; PRODUCT_GRAMMAR.md §12 |
| 17 | Product grammar documented | ✅ | PRODUCT_GRAMMAR.md |
| 18 | Hidden product logic risks documented | ✅ | Constitution Article 37 register (12 entries) |
| 19 | No backend changes | ✅ | `git status` at run time: only untracked new documents; `git diff --stat` against `a3ec116` empty |
| 20 | No application behaviour changes | ✅ | same evidence: no tracked file modified |
| 21 | No screen rebuild | ✅ | same evidence: no file under `client/src` created or modified |
| 22 | No old frontend deletion | ✅ | same evidence: no deletion in `git status` |

**Completion gate: 22 of 22 items satisfied.** Item 11 carries FC-10 and item
12 carries Phase 2 proposals; neither leaves a required document or ruling
missing.

## RG-5.2 · G-1 questions — author self-assessment

| # | Answer | Evidence |
|---|---|---|
| Q-1 Product truth preserved | YES | every rule cites its ruling or code; STATE_RULES.md triggers are published vocabularies; FC-7 and FC-8 mark where a published trigger or contract is missing, instead of inventing one |
| Q-2 Grammar visible | YES | Constitution Articles 6–9; PRODUCT_GRAMMAR.md |
| Q-3 Distinctive | YES at specification level | RG-5.3 |
| Q-4 No AI convergence | YES | VB-F4…F7, F11; AC-3; PR-8 boundary |
| Q-5 No SaaS convergence | YES | Articles 14, 17, 23; VB-F10, F13; AC-2 |
| Q-6 State semantics | YES | STATE_RULES.md; FC-6 added NOT_SUPPORTED rather than collapsing it |
| Q-7 Accessibility | YES | Article 21, with 📏 measured palette constraints turned into rules |
| Q-8 Responsive | YES | Article 25 |
| Q-9 Performance | YES | Article 26 (📏 landing first load 285,365 B gzip) |
| Q-10 Numeric truth | YES | Article 28; MO-4 forbids count-up |
| Q-11 Action identity | YES | Article 29; PRODUCT_GRAMMAR.md §6; FC-8 |
| Q-12 Conflicts registered | YES | Constitution Appendix A: FC-1…FC-11, none silently resolved |
| Q-13 Authority diff | **NOT POSSIBLE at G-1** *(at Phase 1 run time; superseded by RG-5.6 — the spec is now registered)* | the Master Build Spec was not in the repository (FC-10). Q-13 is critical **from G-2**, so it does not block G-1; it is a Phase 2 entry condition |

## RG-5.3 · Identity tests — specification level

**Test 1 — Remove the logo. Generic AI or SaaS? → NO.**

The palette alone would fail this test: Charcoal with a gold accent is a common
premium-dark look. The specification does not rely on it. With the logo and
product nouns removed, a surface built to these documents still has six
mechanisms that a generic product does not:

1. **The Decision Spine.** A single axis carrying VERDICT → WHY → EVIDENCE →
   ACTION → OUTCOME → MEMORY, instead of a KPI strip and card grid.
2. **Tense marking.** Every verdict is labelled NOW or AT DECISION, with
   divergence stated as a fact, never diffed.
3. **Illumination hierarchy.** The brightest element is a *word* (the call), not
   a chart or a hero number. Unknown values are unlit structure with a named
   reason, never skeleton shimmer.
4. **Measured absence.** 15 distinct, reason-carrying states. Failure never looks
   like emptiness, and a dash never stands alone.
5. **Every figure in mono with its window.** No figure without a window, and no
   number animating through values it never had.
6. **Actions that know their target.** "LUMI will do this" and "I did this" are
   typographically distinct, never coloured by the verdict, and absent where the
   backend refuses them.

None of the six transfers into a chat assistant or a generic dashboard without
bringing LUMI's product model with it (AC-5).

**Test 2 — Does the system make sense because LUMI reveals what matters and
organises decisions, evidence, actions, outcomes and memory? → YES.**

Each mechanism above exists **only** because of that model:

- the spine is the product model in reading order;
- tense exists because decisions and assessments never rewrite each other;
- illumination is "light reveals what matters" as behaviour;
- measured absence is evidence-led honesty;
- mono figures with windows are the numeric-truth law;
- action identity is the decision-to-outcome link.

Remove the model and every mechanism loses its reason to exist.

**Caveat, recorded rather than implied.** Both answers are made on the
specification. They become binding evidence only when re-run on rendered
artefacts at G-3 and later (RG-4).

## RG-5.4 · Entry conditions carried into Phase 2

1. **G-1 approved** by Omar.
2. **FC-5** confirmed. This is the reading that PR-1's side-by-side example
   honours B7-06 by naming the divergence rather than diffing it.
3. **FC-9.** A governance change updates `CLAUDE.md` to point at
   `design-governance/`.
4. **FC-10.** The Master Build Spec is made available for the G-2 authority diff.

## RG-5.5 · Verdict

```text
READY FOR PHASE 2 — DESIGN TOKENS
```

This verdict is the author's. G-1 approval remains Omar's.

## RG-5.6 · Phase 1.5 addendum — entry-condition status (2026-09-14)

The Phase 1 record above is kept as written. Status of its entry conditions
after Governance Synchronization (`GOVERNANCE_SYNC.md`):

| RG-5.4 item | Status |
|---|---|
| 1. G-1 approved | **open** — Omar |
| 2. FC-5 confirmed | 🔒 **RULED 2026-09-14** — NOW vs AT DECISION in one Decision experience; disagreement in language; never a visual diff |
| 3. FC-9 `CLAUDE.md` pointer | ✅ **done** |
| 4. FC-10 Master Build Spec available | ✅ **done** — registered verbatim (`README.md` §2.1). 🔒 **Version 2026-09-13 Brand Identity Lock approved as authoritative, 2026-09-14** |
| *new* — spec divergences FC-12…FC-17 | 🔒 **FC-12 RULED** (reset wins; legacy landing is not visual authority) · 🔒 **FC-13 RULED** (PR-6 verdict colours; no reversion to implementation colours) · 🔒 **FC-16 RULED** (locked IA wins; no browsable Campaigns list, filter or sort) · 🔒 **FC-14, FC-15, FC-17 RULED NON-BLOCKING** (gold principles only, never a universal interaction colour · disabled / partial token roles only, no invented component behaviour · numbering and audit location are documentation) (Constitution Appendix A.1) |
| *new* — Governance Sync | ✅ **approved by Omar, 2026-09-14** |
| *new* — approved logo source | **open** — 🔒 ruled 2026-09-14: blocks brand implementation only, **not** token architecture (`brand/README.md`) |
| *new* — commit | **not authorized.** Omar inspects the exact governance diff first |

Q-13 (authority diff) is now **possible**. Appendix A.1 is its first pass. The
clause-by-clause diff stays a G-2 obligation.
