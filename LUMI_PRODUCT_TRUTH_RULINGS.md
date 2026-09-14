# LUMI PRODUCT TRUTH RULINGS

> **RULINGS CLOSED — 2026-09-14.** This document is the Phase 0.5 analysis: evidence, options and recommendations. Omar closed the questions as **Product Rulings PR-1…PR-13**, recorded in `design-governance/README.md` §3. **Where an option, recommendation or open question below differs from PR-n, PR-n governs.** Product-truth authority level 1 (`CLAUDE.md` → Authority). The content below is unchanged. *(Phase 1.5)*

**Phase:** 0.5 — Frontend Product-Truth Rulings · **Mode:** analysis / ruling preparation only
**Repository:** `origin/master @ a3ec11618c6b2a14ec68382ea4f10d44afb9601c` — unchanged since Phase 0 (the only untracked files are `DESIGN_SYSTEM_AUDIT.md` and this document)
**Date:** 2026-09-14
**Nothing was modified.** No application, backend, schema, style, route, component or test file was changed. Production was read only (public bundle, response headers).

**Evidence tags used throughout**

| Tag | Meaning |
|---|---|
| **FACT** | directly verified in code, contract, git history, or a production read in this phase |
| **INFERENCE** | follows from verified facts but was not directly executed or observed |
| **UNKNOWN** | cannot be established from repository evidence |
| **PRODUCT DECISION** | requires Omar's explicit ruling |

---

## 1. Executive Summary

Phase 0 returned **READY WITH ARCHITECTURAL QUESTIONS** and listed 13 questions (Q1–Q13, `DESIGN_SYSTEM_AUDIT.md` §33). This phase re-traced every question and every Phase 0.5 topic against the repository.

**Three things changed the picture.**

1. **Part of the ground is already constitutional.** The locked System Design rulings (B6-02) settle several questions the audit left open:
   - **R-1:** "Decisions are acted on. Assessments are recomputed. Neither rewrites the other." It adds that a mutation must disclose whether it targets a persisted Decision or an entity-level signal.
   - **R-4:** "No surface may derive a state from the shape of its data (`loading===false && data.length===0` is banned)."
   - **R-3:** "Allocation is a plan artifact, not a Decision."

   So the failure-vs-empty findings are **violations of a locked article**, not open questions. On verdict-vs-decision, the option "make the displayed verdict always equal the stored decision" is **not available** without reopening R-1.
2. **The audit was wrong in four places** (§2.3). The most consequential correction:
   - The Campaigns platform-execution descriptor ("Pause this campaign on Meta") is derived from the **stored** decision's verdict, not the live one (`src/services/verdict-engine/connectorVerdictService.js:659-673`).
   - The verdict pill beside it shows the **live** verdict.
   - So the product can show a live **SCALE** pill beside a button that pauses the campaign because of a stored **KILL**, with nothing telling the operator the two differ.
3. **Several audit findings are latent, not live:**
   - The first-run banner has had **no writer** since `997bcf1` (2026-07-22), so it cannot fire in production.
   - Observability's `|| 0` only masks unvalidated shape drift; the backend always returns numeric counts on a 200.
   - Unknown→HOLD cannot be reached from the live verdict feed, because the client schema is a strict enum and an unknown verdict fails the whole parse first.
   - One live defect the audit **missed**: `ContextBar`, mounted on every `/app` page, permanently shows "Context: Locked" and "Dual-Agent Ready".

**Rulings Omar must make before Phase 1:**
- how assessment vs decision is expressed (Q1 / P0-01 / P0-11);
- mutation identity and naming (Q2 / P0-02);
- which layer owns failure-vs-empty translation (P0-03 / P0-04);
- the verdict vocabulary and its colours (P0-10 / Q9);
- plan-locked navigation (Q8);
- light/dark (Q11);
- illustrative numbers (Q3);
- the Copilot's product truth (Q6).

The rest can be ruled during or after Phase 1.

**Verdict (§23): READY FOR PHASE 1 AFTER PRODUCT RULINGS.**

---

## 2. Source / Evidence Hierarchy

### 2.1 Hierarchy applied

```text
1 Repository behavior  →  2 Backend/API contracts  →  3 Locked product invariants (B6-02 R-1…R-4, B7, B8, C-series)
→  4 DESIGN_SYSTEM_AUDIT.md  →  5 LUMI Master Build Spec  →  6 Documentation / comments
```

- **Level 3 source:** locked rulings are recorded in project memory (`lumi_system_design_constitution.md`, `r3_implementation_ledger.md`, B7/B8/C-series records) and restated in code headers. They are cited as **invariants**, never as evidence of behaviour.
- **Level 5 (Master Build Spec):** still **not in the repository** or the plans directory. Only the fragments quoted in the Phase 0 / 0.5 specs are available: brand palette, KILL/HOLD/SCALE colours, thesis, anti-convergence rules.

### 2.2 ID crosswalk — the Phase 0.5 spec and the audit use different numbering

**Conflict reported, not reconciled.** The Phase 0.5 spec labels topics P0-01…P0-13, while `DESIGN_SYSTEM_AUDIT.md` uses different finding IDs and Q1–Q13. This document follows the **spec's section structure** and resolves every **Q** (all 13 have a ruling block).

| This document (spec ID) | Audit finding ID(s) | Audit question |
|---|---|---|
| §4 P0-01 Verdict vs Decision | P0-01, P0-01a | **Q1** |
| §5 P0-02 Mutation Identity | P0-02, P0-13 | **Q2** |
| §6 P0-03/04 Failure vs Empty | P0-03, P0-04, P0-40 | — (R-4) |
| §7 P0-05 Watching State | P0-10 (+ ContextBar, new) | — |
| §8 P0-06 Campaign Connection State | P0-05 | — |
| §9 P0-07 First-Run Failure | P0-06 | — |
| §10 P0-08 Observability | P0-07 | — |
| §11 P0-09 Unknown Verdict | P0-14, P0-18 | — |
| §12 P0-10 Verdict Vocabulary | P0-19, P0-15, R-7 | **Q9** |
| §13 P0-11 Decision Agreement | P0-01a | (Q1) |
| §14 P0-12 Design System Fragmentation | P0-30, P0-31 | **Q4** |
| §15 P0-13 Plan / Role Behavior | P0-12, §35 contradictions | **Q8** |
| §21 Decisions Required | P0-51, P0-50, P0-42, P0-11, P0-16 | **Q3, Q5, Q6, Q7, Q10, Q11, Q12, Q13** |

### 2.3 Corrections to `DESIGN_SYSTEM_AUDIT.md`

The repository outranks the audit, so these corrections govern.

| # | Audit said | Repository shows | Effect |
|---|---|---|---|
| C-1 | Execution risk: action "not checked against stored verdict"; `executionSignals.js` comment implied the action comes from the live payload | **FACT:** the `execution` descriptor is computed server-side from the **stored** decision's verdict (`connectorVerdictService.js:659-673`, `executabilityFor({ verdict: decisionMap.get(c.id)?.verdict … })`). The pill shows the **live** verdict (`CampaignsView.jsx:289-293`, `ConnectorCampaignsPanel.jsx:415`) | the mismatch is *displayed verdict ≠ executed call*, not *executed call ≠ stored verdict*. Severity unchanged, meaning sharper |
| C-2 | P0-06 FIRST_RUN interrupt ignores `unreadable` (live defect) | **FACT:** `marcom:firstActivation` has **no writer** in `client/src`; the `sessionStorage.setItem` was removed by `997bcf1` (2026-07-22) | latent, unreachable in production |
| C-3 | P0-07 Observability renders missing as 0 (unknown→healthy) | **FACT:** `/api/observability/live` returns all counts as numbers on 200 and 500 on failure; the page renders an error on failure (`live.js`, `Observability.jsx`) | zeros are real; `|| 0` only masks unvalidated shape drift |
| C-4 | P0-14 unknown verdict → HOLD (live) | **FACT:** `VerdictBadge`'s only live consumer receives verdicts parsed by `ConnectorVerdictValueSchema`, a strict `z.enum` of six (`connectorCampaigns.schema.ts:56-63`); an unknown value fails the whole response | latent |
| C-5 | `DecisionPill.jsx:4-12, 40-55` | actual `:17-25` (config), `:49-66` (VerdictPill) | citation drift (audit line numbers were read from a comment-stripped view) |
| C-6 | not reported | **FACT:** `ContextBar.jsx:14,23,31` — static "Context: Locked", "Dual-Agent Ready", fallback `SID _NSD87T`, on every `/app` page | new live finding (§7) |
| C-7 | P0-03 failure → "No decisions yet" | **FACT:** also shown **while loading** (`data = []` default, no `isLoading` check, `MainLayout.jsx:32`) | wider than stated |
| C-8 | not reported | **FACT:** `AllocationService.js:48-65` still mints `Decision` rows (`verdict: 'REALLOCATE'`, `DECISION_CLASS.ALLOCATION`), contrary to locked **R-3** and to the R-3 ledger item "before the frontend rebuild: stop minting Decision rows" | backend/invariant conflict affecting vocabulary (§12) |
| C-9 | not reported | **FACT:** two exported `formatCurrency` functions with different input units: `lib/currencyFormatter.js:57` takes **major** units (default `'USD'`), `lib/money.ts:69` takes **minor** units | hidden currency-semantics hazard (§18) |

---

## 3. Confirmed Product Invariants

These are locked rulings that bound every recommendation below. They were not re-litigated here.

| Invariant | Source | Repository status (this phase) |
|---|---|---|
| **R-1** Decisions are acted on; assessments are recomputed; neither rewrites the other. Only Signal Decisions have a current assessment. Verdict equality alone decides agreement. A mutation must disclose whether it targets a persisted Decision or an entity-level signal. | B6-02 | the backend implements "neither rewrites" and publishes agreement; **the frontend does not disclose** (§4, §5) |
| **R-2** Decision-first in workflow, campaign-addressed in identity. The Decision owns a destination; Campaign is a lens. The drill-down is evidence, not navigation. | B6-02 | `/app/decisions/:id` exists; not linked from Attention or Campaigns (Q10) |
| **R-3** Three Decision classes (Signal, Experiment, Guardrail). Allocation is a plan artifact, not a Decision. | B6-02 | **contradicted by writer** (C-8) |
| **R-4** One canonical absence vocabulary; no state derived from data shape; every non-KNOWN state carries a reason. | B6-02 | implemented as C-06 `KNOWLEDGE` tokens + `design-system/states/absence.js`; **violated** in shell and chart (§6–§8) |
| **B7 Ruling 3** A surface's gate equals its API's gate. | B7 | holds for primary surfaces |
| **B8-01** A strict zod enum kills the whole surface; closed vocabularies must be earned by parity proof. | B8 | the verdict enum is earned (`connectorCampaignsParity.test.js`) |
| **B8-02** Absence is a measured state, never a UI default. | B8 | as R-4 |
| **C-07** A token cannot replace a reason; unrecognised reason → no guessed action. | C-series | holds (`gatingReasonCopy.js`) |
| **C-09** Confidence is value + basis; display, never recompute. | C-series | violated in Content Lab (Q12) |
| **C-12** Live verdict and stored decision are both published and never reconciled; `decisionAgreement` names the relation. | C-series | published, **stripped by client** (§13) |
| **Contract close-out gate** written → published → parsed → **rendered** | project law | `decisionAgreement` fails at *parsed* |
| **Every displayed number traces to a real DB row** | governing law | in-app: holds; landing / AI prose: Q3 |
| **Execution surface** only PAUSE/RESUME are executable; authority is re-read at the money boundary | Security B, Slice D | holds (backend) |

---

## 4. P0-01 Verdict vs Decision

### Traced chain

```text
DISPLAY (Campaigns)
  engine.evaluate(live rows) ─► v.verdict ─► GET /api/lumi/entities/verdicts (route spreads the service result, entities.js:57-60)
  ─► useConnectorVerdicts ─► ConnectorVerdictsResponseSchema.safeParse ─► CampaignsView projection (v.verdict)
  ─► verdictByEntityId (CampaignsView.jsx:289-293, m[v.id] = v.verdict) ─► ConnectorCampaignsPanel.jsx:415 <VerdictPill verdict={LIVE}/>

DISPLAY (Attention)
  GET /entities/health ─► computeAccountHealth(canonical rows, verdictMap of LIVE verdicts) (entities.js:88-95)
  ─► overviewDerive.decisionFeed: verdict = c.verdict (LIVE), decisionId = verdictsPayload.decisionId (STORED) (overviewDerive.js:52-60)
  ─► DecisionCard.jsx:96 <VerdictPill verdict={LIVE}/>

STORED
  getLatestDecisions: prisma.decision.findMany({ entityLevel:'CAMPAIGN', status:'PROPOSED', SIGNAL scope }, orderBy createdAt desc)
  (connectorVerdictService.js:406-446) ─► decisionMap ─► decisionId, decisionVerdict (:607, :611), decisionAgreement (:621-627),
  execution = executabilityFor({ verdict: STORED, decisionId: STORED }) (:659-673)

ACTIONS
  Campaigns · Judge     PATCH /decisions/:id/judgment          id = info.decisionId (STORED)   ConnectorCampaignsPanel.jsx:532-541
  Campaigns · I executed / Not applicable  PATCH /decisions/:id/{execute|dismiss}  (STORED id; by-entity if null) :524-525
  Campaigns · Pause on Meta   POST /api/execute/meta { decisionId: STORED, ...execution(STORED verdict) }  :548 → useLumiExecution → executeWithLumi
  Attention · Judge     PATCH /decisions/:id/judgment          STORED id                        DecisionCard.jsx:187-194
  Attention · I executed / Not applicable  PATCH /decisions/by-entity/:entityId/{execute|dismiss}  (NO id)  DecisionCard.jsx:171-172
```

| Question | Answer | Tag |
|---|---|---|
| Where does `decisionVerdict` come from? | the newest PROPOSED SIGNAL campaign Decision per entity (`getLatestDecisions`) | FACT |
| Where does `decisionAgreement` come from? | `agreementOf({ live, stored, ok })` → `{ value: AGREES/DIVERGES/null, knowledge: KNOWN / NOTHING_THERE / COULD_NOT_LOOK }` (`decisionAgreement.js:82-96`) | FACT |
| Why does the client drop it? | `ConnectorVerdictRowSchema` is a plain `z.object` (strips unknown keys) and declares no `decisionAgreement` (`connectorCampaigns.schema.ts:107-137`) | FACT |
| Why was it never added? | the backend header says "Rendering it is B8's ruling" and the C-07 rule defers shared vocabularies until a client branches on them. B8 closed without that ruling. | FACT (headers) / INFERENCE (causality) |
| Does the operator see the **stored** verdict? | **No.** `decisionVerdict` is projected (`CampaignsView.jsx:372`) and consumed by no component (repo-wide grep: schema + projection only) | FACT |
| Does the operator see the **computed** verdict? | **Yes**, on both surfaces | FACT |
| What happens when they disagree? | the pill shows LIVE. Judge / I-executed / Not-applicable write to the STORED row. "Pause on Meta" (Campaigns) is offered **iff the stored verdict maps to an action** and executes the stored call. No UI states the disagreement. | FACT (paths) / INFERENCE (visible combination: e.g. SCALE pill + "Pause this campaign on Meta") |
| Who owns the action? | the **stored Decision** (by id), except Attention's I-executed / Not-applicable (by entity → the newest PROPOSED at write time) | FACT |
| Who owns the displayed verdict? | the **live assessment** | FACT |
| How often do they diverge? | not measured | **UNKNOWN** |
| Frontend bug or unresolved semantics? | **Both.** The semantics are locked (R-1: two objects, neither rewrites). The *expression* was explicitly left to B8 and never ruled, and the client strips the one field that names the relation. | FACT + PRODUCT DECISION |

### Ruling block

| Field | Content |
|---|---|
| **QUESTION** | Q1 — How is the current assessment vs the stored decision presented on acting surfaces, given B7-06 ("never shown side by side as a diff") and the published `decisionAgreement`? |
| **CURRENT EVIDENCE** | chain above; `decisionAgreement.js:14-17` names the frontend omission itself |
| **REPOSITORY LOCATIONS** | `src/services/verdict-engine/{connectorVerdictService.js:406-446,600-673, decisionAgreement.js}` · `client/src/contracts/schemas/connectorCampaigns.schema.ts:127-137` · `client/src/features/campaigns/{CampaignsView.jsx:289-293,366-372, ConnectorCampaignsPanel.jsx:415,524-548}` · `client/src/features/overview/{overviewDerive.js:52-60, components/DecisionCard.jsx:96,171-194}` |
| **BACKEND CONTRACT** | `verdict` (live), `decisionId` / `decisionVerdict` (stored, nullable), `decisionAgreement {value, knowledge}`, `execution` (keyed on stored verdict), `human*` (on stored row) |
| **CURRENT BEHAVIOR** | only live is shown; actions and execution bind to stored; divergence invisible |
| **EXPECTED / IMPLIED BEHAVIOR** | R-1: both objects stand, neither rewrites. R-1: a mutation discloses its target. C-12: agreement is a published fact. B7-06: no then/now diff rendering. |
| **CONFLICT** | the acting surface renders one object and acts on the other, contradicting R-1's disclosure clause. The "guarantee alignment" option conflicts with R-1's "neither rewrites the other". |
| **PRODUCT IMPACT** | an operator can judge, record or **execute a Meta mutation** for a call they were not shown. The Memory / accuracy populations then attribute the response to that stored call. |
| **RULING REQUIRED** | how an acting surface names *which object an action belongs to*, and what it states when `decisionAgreement` is DIVERGES / NOTHING_THERE / COULD_NOT_LOOK |
| **OPTIONS** | **A. Disclose the target (recommended).** The action region names the stored decision it acts on (its verdict and when Lumi committed to it). The agreement is stated as a fact in words, not as a diff. **B. Bind actions to the live assessment.** Not available: only PROPOSED Decision rows are actionable, and the live assessment is not persisted (R-1). **C. Guarantee alignment.** Re-sweep or supersede on divergence so displayed == stored. Requires reopening R-1 and a backend change (frozen). **D. Suppress action on DIVERGES.** Show the live verdict and withhold actions until a sweep writes a new decision. Truthful but removes a path; a product call. |
| **RECOMMENDED RULING** | **A**, with **D** as a sub-question for DIVERGES only. Rationale: the only option consistent with R-1 as locked and needing no backend change. |
| **CONFIDENCE** | High that A is R-1-consistent (FACT-based). Whether D is wanted: PRODUCT DECISION. |
| **IMPLEMENTATION CONSEQUENCE** | (later phases) the decision object primitive carries **two named slots**, assessment and decision-of-record, plus an agreement statement. `decisionAgreement` enters the client view model (§13). Actions must render inside the decision-of-record slot. |

---

## 5. P0-02 Mutation Identity

### Backend contract (FACT, `src/routes/lumi/decisions.js:1-30, 80-100`; `decisionSignalStamps.js:205-235, 266-300`)

| Route | Resolves | Race behaviour | Refusal |
|---|---|---|---|
| `PATCH /decisions/:id/{execute,dismiss}` | exactly that row, workspace-scoped | none: the id is fixed | 404 not found; 409 `DecisionNotActionable` if not PROPOSED |
| `PATCH /decisions/by-entity/:entityId/{execute,dismiss}` | **newest PROPOSED** SIGNAL decision for the entity **at write time** | a sweep landing between render and click **moves the target** (the file header states this) | 404 `NoLiveDecision` |
| `PATCH /decisions/:id/judgment` | that row | none | — |
| `POST /api/execute/meta` | `decisionId` in body; re-checked `status === 'PROPOSED'` and not dismissed (`decisionEligibility.js:62-72`) | refused if superseded between render and click | 409 not executable |

The header's own rule: by-id is preferred whenever an id exists, and by-entity "remains the correct route when there is no id to send" (a live verdict with no stored decision).

### Surface usage (FACT)

| Surface | Record "I executed" / "Not applicable" | Judge | Platform execution |
|---|---|---|---|
| Campaigns | `executeDecision(c.entityId, info.decisionId ?? null)` → **by id** when present (`ConnectorCampaignsPanel.jsx:524-525`) | by id | by id (Campaigns only) |
| Attention | `execute(entityId)` → **by entity**, although `decisionId` is in props (`DecisionCard.jsx:45,171-172`) | by id (`:187-194`) | not offered |

**Within one Attention card, Judge writes to the stored row by id, while "I executed this" writes to whatever row is newest when clicked.** FACT.

**Naming (FACT):** the human record buttons read "I executed this" / "Not applicable" under "Did you act on this?" (`DecisionLifecycle.jsx:52-66`). The platform action reads "Pause this campaign on Meta" (`LumiExecute.jsx:63`). The section header reads "Where to execute" / "Execute here" (`ExecutionContext.jsx:85-91`). Routes and hooks call both `execute`.

### Ruling block

| Field | Content |
|---|---|
| **QUESTION** | Q2 — Should Attention's Execute / Dismiss write to the stored decision id (as Campaigns does) or remain by-entity? And should "Execute" (record that I did it) and "Execute with Lumi" (platform mutation) keep sharing a word? |
| **CURRENT EVIDENCE** | tables above |
| **REPOSITORY LOCATIONS** | `src/routes/lumi/decisions.js`, `src/routes/lumi/decisionSignalStamps.js`, `src/services/execution/decisionEligibility.js`, `client/src/features/campaigns/{decisionSignals.js:24-35, useDecisionAction.js, DecisionLifecycle.jsx, LumiExecute.jsx, ExecutionContext.jsx}`, `client/src/features/overview/components/DecisionCard.jsx` |
| **BACKEND CONTRACT** | identity models already supported: **DECISION** (by id) and **ENTITY → newest PROPOSED** (by entity). No versioned identity exists. |
| **CURRENT BEHAVIOR** | two identity rules for one visible action; "execute" means two different things |
| **EXPECTED / IMPLIED BEHAVIOR** | R-1: "a mutation must disclose whether it targets a persisted Decision or an entity-level signal (never fabricate a Decision identity)". Route header: prefer by-id when an id exists. |
| **CONFLICT** | Attention uses by-entity **with an id available**, contrary to the route contract's own preference. Neither surface discloses the target (R-1). |
| **PRODUCT IMPACT** | a record intended for the call on screen can land on a newer call; accuracy and learning populations inherit the misattribution |
| **RULING REQUIRED** | (a) canonical mutation identity; (b) naming of human record vs platform mutation |
| **OPTIONS** | (a) **DECISION when an id exists, ENTITY only when no Decision exists, disclosed either way** · CAMPAIGN only · DECISION + VERSION (new model; **not justified** by repository evidence, since by-id already pins a row). (b) keep "execute" for both · reserve "execute" for the platform mutation and name the human record separately (the current button copy already does this: "I executed this") · rename both |
| **RECOMMENDED RULING** | (a) **DECISION when present, ENTITY fallback only when no Decision row exists, and the surface discloses which.** This follows the existing route contract and R-1; no new identity model. (b) Reserve "execute" for **the platform mutation Lumi performs**, and treat the human claim as a **record** ("I did it" / "Not applicable"). |
| **CONFIDENCE** | (a) High (contract + R-1). (b) Medium: naming is a PRODUCT DECISION. |
| **IMPLEMENTATION CONSEQUENCE** | one action primitive with an explicit target prop `{ kind: DECISION, id } \| { kind: ENTITY, entityId }`. Copy vocabulary distinguishes *record* from *execute*. |

---

## 6. P0-03 / P0-04 Failure vs Empty

### P0-03 Recent Decisions (FACT)

```text
GET /api/lumi/decisions/recent
 ↓ fetchRecentDecisions: response.data?.decisions || []   (no schema; malformed 200 → [])      features/shell/services.js:28-32
 ↓ useRecentDecisions: useQuery (retry: 1, staleTime 30s)                                        features/shell/queries.js; ServerStateProvider.jsx
 ↓ MainLayout: const { data: recentDecisions = [] } = useRecentDecisions()   (isLoading, isError never read)   MainLayout.jsx:32
 ↓ Sidebar prop decisions={recentDecisions}
 ↓ RecentDecisions: recentDecisions.length === 0 → "No decisions yet"                             RecentDecisions.jsx:32-34
```

- **Loading:** `data` is undefined, so it falls to `[]` and renders "No decisions yet". FACT.
- **Failure (first load):** `data` is undefined, same render. FACT.
- **Malformed 200:** `decisions || []` gives the same render. FACT.
- **Failure after a success:** react-query v5 keeps the previous `data`, so a stale list shows with no error. INFERENCE (library semantics, not executed).

### P0-04 Connections (FACT)

```text
GET /api/lumi/connections
 ↓ useConnections: safeParse; error → { data: null, loading: false, error }                       hooks/useConnections.js:18-31
 ↓ Sidebar: { data: connectionsData, loading: connectionsLoading } (error not destructured)       Sidebar.jsx:246
 ↓ hasConnector = (connectionsData?.connections ?? []).some(c => c.connected)                     :277
 ↓ showConnectCTA = role && !connectionsLoading && !hasConnector                                   :278
 ↓ render "Connect a channel · Start here"                                                           :536-556
```

On failure, `hasConnector` is false and loading is false, so the CTA shows. FACT.

### Ruling block

| Field | Content |
|---|---|
| **QUESTION** | Define LOADING / EMPTY / FAILED / UNAVAILABLE / NOT_CONNECTED, and which layer owns the translation |
| **CURRENT EVIDENCE** | both chains derive state from array shape |
| **REPOSITORY LOCATIONS** | as above; the canonical vocabulary lives in `@marcom/runtime-contracts` `KNOWLEDGE` and `client/src/design-system/states/absence.js` |
| **BACKEND CONTRACT** | `/connections` returns connection rows (connected flag, lastSyncedAt). `/decisions/recent` returns rows. **Neither publishes a KNOWLEDGE token.** |
| **CURRENT BEHAVIOR** | transport, loading and parse states collapse into "empty" and "not connected" |
| **EXPECTED / IMPLIED BEHAVIOR** | R-4: no state derived from data shape; B8-02: absence is measured; `absence.js` maps KNOWN→PRESENT, COULD_NOT_LOOK→NOT_REACHABLE, NOT_ENOUGH→NOT_MEASURED, NOTHING_THERE→NOTHING_FOUND, CANNOT_ASK→NOT_SUPPORTED/NOT_PERMITTED |
| **CONFLICT** | direct violation of R-4 in the always-mounted shell |
| **PRODUCT IMPACT** | during an outage every `/app` page claims "Lumi has decided nothing" and tells a connected account to connect |
| **RULING REQUIRED** | only **ownership and mapping**; the principle is locked |
| **OPTIONS** | ownership: (1) backend publishes a KNOWLEDGE token per read; (2) the **data layer** (hook / query adapter) owns translation of transport outcomes and the backend owns data-level absence; (3) components decide (current, banned by R-4) |
| **RECOMMENDED RULING** | **(2) with R-4's split:** see the table below |
| **CONFIDENCE** | High on the split (locked vocabulary + existing adapter pattern in `useConnectorCampaigns`); medium on whether NOT_CONNECTED needs a backend token (see UNKNOWN) |
| **IMPLEMENTATION CONSEQUENCE** | the new system's state primitive takes a **state token**, never an array, and every hook returns `{ state, data, reason }`. The shell is the first consumer. |

**Recommended semantics** (PRODUCT DECISION, recommendation only)

| State | Meaning | Owner | Maps to (existing) |
|---|---|---|---|
| **LOADING** | request in flight, no prior answer | data layer | not an absence state; must render nothing claim-bearing |
| **FAILED** | transport or contract failure (network, 5xx, 401/403 expiry, parse failure) | data layer | `COULD_NOT_LOOK` → `NOT_REACHABLE` |
| **UNAVAILABLE** | server answered but the capability or measurement is not available (e.g. `UNAVAILABLE` status, tier refusal) | backend token | `CANNOT_ASK` → `NOT_SUPPORTED` / `NOT_PERMITTED`, or domain status |
| **EMPTY** | a **successful** read that found nothing | backend (successful read) | `NOTHING_THERE` → `NOTHING_FOUND` |
| **NOT_CONNECTED** | a successful connections read reporting zero connected channels | backend fact, read by data layer | a domain fact on `/connections`, distinct from EMPTY campaigns |

UNKNOWN: whether "connected but never synced" needs its own published state. The `/connections` rows carry `lastSyncedAt`, so this INFERENCE says it is derivable from a successful read; not verified per channel.

---

## 7. P0-05 Watching State

FACT — `Sidebar.jsx:182-196` renders a pulsing green "WATCHING" pill inside `WorkspaceHQ`. It is mounted when `!collapsed && hasWorkspace && workspace` (`:466-470`). There is no data read, no API field and no condition on connection, sync, cron or verdict state. The adjacent `workspace.adSetsCount` has **no producer** in client or server, so it never renders.

FACT — `RadarStrip.jsx` shows "Monitoring" unless `hasHighAlerts`. `alertsData` has been `[]` since FE-03 (`MainLayout.jsx` FE-03 note), so it **always** reads "Monitoring".

FACT (new, C-6) — `ContextBar.jsx`, mounted in `MainLayout.jsx:105` on every `/app` page:
- green "Context: Locked" (`:23`);
- "Dual-Agent Ready" (`:31`);
- `SID _{uid.slice(0,6)}` with fallback `'NSD87T'` (`:14`).

None of these is data-backed.

FACT — `Sidebar.jsx:177` renders `Market: {workspace.market || 'EG'}`. The backend publishes `market: user.context?.market ?? null` (`src/routes/user.js:88`), and the connect-first onboarding does not collect it (INFERENCE from `997bcf1`), so most workspaces display "EG" by default.

INFERENCE — "WATCHING" / "Monitoring" imply continuous automated observation. In production the agentic cron is disabled (`AGENTIC_CRON_ENABLED=false`, worker logs read in pre-flight 1). Sync cadence was not verified per workspace.

| Field | Content |
|---|---|
| **QUESTION** | Is WATCHING a real product state, a UI mode, a static label, or a conditional status? |
| **CURRENT EVIDENCE** | above |
| **REPOSITORY LOCATIONS** | `client/src/components/layout/{Sidebar.jsx:177-196, RadarStrip.jsx, ContextBar.jsx, MainLayout.jsx:32-45,105}` |
| **BACKEND CONTRACT** | none; no field backs any of the four labels |
| **CURRENT BEHAVIOR** | **C. static labels**, styled as live status (green, pulsing) |
| **EXPECTED / IMPLIED BEHAVIOR** | R-4 / B8-02: a state is published by the backend or it does not exist |
| **CONFLICT** | unknown rendered as healthy and active |
| **PRODUCT IMPACT** | asserts monitoring, context and AI readiness regardless of truth; the "EG" market default fabricates a workspace attribute |
| **RULING REQUIRED** | whether Lumi has a **measured liveness state** at all |
| **OPTIONS** | (1) no liveness claim in the shell; (2) a conditional status derived from published facts (last successful sync time, connector state), stated as a fact ("Last synced 2h ago"), not a mode; (3) keep as brand ornament (conflicts with R-4) |
| **RECOMMENDED RULING** | **(1) now; (2) only when the backend publishes a sync/monitoring fact.** Ornamental status is not carried into the new system. |
| **CONFIDENCE** | High (locked R-4) |
| **IMPLEMENTATION CONSEQUENCE** | the design system has **no "live" or "watching" indicator primitive** unless it is bound to a published timestamp or state token |

---

## 8. P0-06 Campaign Connection State

FACT:
- `CampaignsView.jsx:459` sets `hasConnectorData = connectorCampaigns.length > 0`. The comment above it (`:455-458`) states this is "a question about the array", not whether the server measured the account.
- `useConnectorCampaigns` starts `campaigns = []` and leaves `[]` on transport error (`hooks/useConnectorCampaigns.js`).
- There is no page-level loading or error gate before the chart (`CampaignsView.jsx:467-604`).
- `PerformanceChart.jsx:13-27`: when `spend === 0`, it shows "Connected campaigns have no spend to allocate yet." if `hasConnectorData`, otherwise "No campaign data yet. Connect Meta to see budget allocation."
- **The page never reads `/connections`** (no `useConnections` in the Campaigns closure), so "Connect Meta" is inferred from an empty array.

| State | What the chart shows today | Distinguishable today? |
|---|---|---|
| loading | "No campaign data yet. Connect Meta…" | **no** |
| failed | same (the panel above shows the real error) | **no** (contradiction on one page) |
| connected, no campaigns synced | same | **no** |
| not connected | same | **no** (never measured) |
| campaigns, zero scored spend | "Connected campaigns have no spend to allocate yet." | yes |
| scored spend | allocation bar | yes |

| Field | Content |
|---|---|
| **QUESTION** | What should the chart communicate for each state? (semantics only) |
| **CURRENT EVIDENCE / LOCATIONS** | above; `client/src/components/campaign-analysis/PerformanceChart.jsx`, `client/src/features/campaigns/CampaignsView.jsx` |
| **BACKEND CONTRACT** | campaigns read (rows), verdicts read (rows with `spendMinor`), connections read (not consumed here) |
| **CURRENT BEHAVIOR** | four states collapse into one instruction |
| **EXPECTED / IMPLIED BEHAVIOR** | R-4; C-07 (an instruction only when the cause is known) |
| **CONFLICT** | a failed read issues an onboarding instruction |
| **PRODUCT IMPACT** | a connected operator is told to connect Meta during an outage or a slow load |
| **RULING REQUIRED** | per-state meaning |
| **OPTIONS / RECOMMENDED RULING** | **LOADING:** no claim. **FAILED:** "could not read", no instruction. **NOT_CONNECTED** (successful connections read, none connected): the only state allowed to instruct connection. **CONNECTED, NOTHING SYNCED:** state the sync fact, no connect instruction. **NO SCORED SPEND:** as today. **SCORED:** the evidence. The chart may not decide connection state from campaign rows. |
| **CONFIDENCE** | High (R-4, C-07) |
| **IMPLEMENTATION CONSEQUENCE** | evidence visualizations receive a state token and the connection fact from the data layer (§6) |

---

## 9. P0-07 First-Run Failure

FACT:
- `overviewInterrupts.js:28-29`: FIRST_RUN fires when `c.firstRunFlag && !c.hasAnyData`. CONNECT (`:47-55`) additionally requires `!c.unreadable`.
- `pickInterrupt` returns null while loading (`:77-78`).
- `hasAnyData = connectorCampaigns.length > 0` (`useOverviewModel.js:168`).
- `firstRunFlag` reads `sessionStorage['marcom:firstActivation']` (`useDismissals.js:20,28`).
- **No code in `client/src` writes that key.** The writer `sessionStorage.setItem('marcom:firstActivation', '1')` was deleted in `997bcf1` (2026-07-22). Its comments (`useDismissals.js:7`, `FirstRunBanner.jsx:6`) still say "written by onboarding". **COMMENT WRONG (legacy).**

So in production the flag is never set, and FIRST_RUN cannot render. The failure path is **latent**: it would reproduce the moment any writer returns. INFERENCE: stale sessionStorage from before 2026-07-22 cannot survive, because sessionStorage is per-tab session.

| Field | Content |
|---|---|
| **QUESTION** | Should first-run UI require a successful read before making a recommendation? |
| **CURRENT EVIDENCE / LOCATIONS** | above; `client/src/features/overview/{overviewInterrupts.js, useDismissals.js, components/FirstRunBanner.jsx}` |
| **BACKEND CONTRACT** | none for first run (client session flag) |
| **CURRENT BEHAVIOR** | unreachable; if reachable, a failure would produce onboarding advice |
| **EXPECTED / IMPLIED BEHAVIOR** | B8-02's ruling on CONNECT: "on a failed read we do not know whether they have one" |
| **CONFLICT** | FIRST_RUN rule and CONNECT rule disagree; comments claim a writer that does not exist |
| **PRODUCT IMPACT** | none live today; dead guided first-run UX |
| **RULING REQUIRED** | yes/no on the principle; whether first-run guidance exists at all in the new product |
| **OPTIONS** | (1) any recommendation (connect, sync, enrich) requires a successful read establishing the precondition; (2) first-run guidance is shown regardless of reads |
| **RECOMMENDED RULING** | **(1).** Also flag that first-run guidance currently has no source of truth. Whether a first-run state should exist (e.g. a published "never synced" fact) is a PRODUCT DECISION. |
| **CONFIDENCE** | High on (1); UNKNOWN on intended first-run UX |
| **IMPLEMENTATION CONSEQUENCE** | instructions are a state-gated primitive: they render only from a KNOWN precondition |

---

## 10. P0-08 Observability Missing Values

FACT:
- `src/routes/observability/live.js` computes `active`, `paused`, `queued` from a status `groupBy` with `|| 0` per status, `failed_last_hour` from `count()`, `queue.depth` from `.length`, and `avg_wait_ms` initialised to `0` and averaged only when depth > 0. All fields are always numeric on 200. Any Prisma failure returns **500**.
- `Observability.jsx` fetches three endpoints with `Promise.all`. On error it sets `error` and renders the error branch (401/403 have dedicated copy). It has no schema validation.
- `MetricsSummary.jsx:29-43` applies `|| 0` to six fields.

So a 0 on screen means:

| Source | Value | Meaning |
|---|---|---|
| status with no rows | 0 | **real zero** |
| `avg_wait_ms` with an empty queue | 0 | **not applicable**, rendered as "0 ms" |
| backend field renamed or removed (shape drift) | `undefined` → 0 | **missing masked as zero** (latent; no validation) |
| request failure | error branch | failure shown honestly |

| Field | Content |
|---|---|
| **QUESTION** | Can this surface legitimately display zero when source data is absent? |
| **CURRENT EVIDENCE / LOCATIONS** | above; `src/routes/observability/live.js`, `client/src/pages/Observability.jsx`, `client/src/components/observability/MetricsSummary.jsx` |
| **BACKEND CONTRACT** | numeric counts, unversioned, unvalidated client-side |
| **CURRENT BEHAVIOR** | real zeros today; missing would silently become zero |
| **EXPECTED / IMPLIED BEHAVIOR** | `null ≠ 0` (R-4, UI governing law) |
| **CONFLICT** | latent only; plus `avg_wait_ms: 0` conflates "no queue" with "zero wait" |
| **PRODUCT IMPACT** | low today (URL-only surface, see Q5) |
| **RULING REQUIRED** | principle only |
| **OPTIONS / RECOMMENDED RULING** | **Zero may be displayed only when the source measured zero. Absent is absent. Not-applicable (no queue → no wait) is its own state.** The surface's survival is Q5. |
| **CONFIDENCE** | High |
| **IMPLEMENTATION CONSEQUENCE** | metric primitives accept `null` and render absence; they never coerce |

---

## 11. P0-09 Unknown Verdict

### Trace (FACT)

```text
Prisma enum Verdict {KILL HOLD SCALE WATCH REALLOCATE REFRESH}      prisma/schema.prisma:160-168
engine VERDICT (same six, frozen)                                    src/services/verdict-engine/verdictTypes.js:13-20
 ↓ GET /entities/verdicts
 ↓ ConnectorVerdictValueSchema = z.enum([six])  — strict, earned by parity test   client/src/contracts/schemas/connectorCampaigns.schema.ts:40-63
     unknown value ⇒ whole ConnectorVerdictsResponse fails ⇒ useConnectorVerdicts: verdicts=[], error set (hooks/useConnectorVerdicts.js:101-105)
 ↓ (parsed only) consumers:
     VerdictPill (DecisionPill.jsx:17-25,49-66)      unknown ⇒ neutral fallback style, text shows the raw token; config includes non-engine TEST
     VerdictBadge → getSignalTokens (signals.js:96-101) unknown ⇒ console.warn + HOLD tokens; SIGNALS also includes OPTIMIZE
     campaignGrouping.js:16-28                         unknown ⇒ UNSCORED band (not dropped)
     decision.schema.ts:19 VerdictSchema = z.enum([six])   (decision history/detail)
     inbox.schema.ts:18 verdict: z.string().nullish()      (open)
```

| Question | Answer | Tag |
|---|---|---|
| Can an unknown verdict reach `VerdictBadge` today? | No. Its only live consumer (`ContentLabView.jsx:310-313`) renders only for parsed connector verdicts. | FACT |
| Can one reach `VerdictPill`? | via inbox (`z.string`) it can, and it renders neutral with the raw text | FACT |
| What is unknown→HOLD? | a **latent fallback** in a legacy signals map, **wrong semantics** (it asserts a real verdict) | FACT + classification |
| Safety of the strict enum? | `connectorCampaigns.schema.ts:43-49` rests it on "render.yaml builds the client from the same commit as the server". Production does **not** use `render.yaml` (dashboard config differs), but the observed deploy log shows client and server built from the same checkout. The premise holds **in fact** while citing the wrong source. | FACT (log) / CONFLICT (cited source) |

**Classification:** legacy fallback plus a latent invalid-state mapping. It is not the schema's fault (strict by design), and not intentional semantics.

| Field | Content |
|---|---|
| **QUESTION** | What must LUMI do with an unknown / unrecognised verdict? |
| **REPOSITORY LOCATIONS** | above |
| **BACKEND CONTRACT** | six verdicts, DB-enforced; the client enum is parity-tested |
| **CURRENT BEHAVIOR** | parse failure (connector feed) · neutral raw token (Pill) · HOLD (Badge, latent) · UNSCORED (grouping) |
| **EXPECTED / IMPLIED BEHAVIOR** | B8-01 (closed vocabulary is earned, unknown = contract failure); R-4 (unknown ≠ a known state); C-07 (unrecognised ⇒ no guessed meaning) |
| **CONFLICT** | four different behaviours for one condition; HOLD is a guess |
| **RULING REQUIRED** | one canonical behaviour |
| **OPTIONS** | (1) unknown = contract failure: the read is FAILED (current strict-enum behaviour), and a verdict primitive never receives an unknown; (2) render the raw token as "unrecognised verdict" with no semantic colour and no action; (3) map to a known verdict (current Badge; rejected by R-4) |
| **RECOMMENDED RULING** | **(1) for every closed-vocabulary feed. (2) as the primitive's defensive behaviour for open feeds (inbox). Never (3).** Non-engine tokens (`TEST`, `OPTIMIZE`) are not verdicts. |
| **CONFIDENCE** | High |
| **IMPLEMENTATION CONSEQUENCE** | the verdict primitive accepts only the canonical vocabulary plus an explicit `unrecognised` / absent state; no fallback colour maps to a verdict |

---

## 12. P0-10 Verdict Vocabulary

### Where generated (FACT)

| Verdict | Generated by | Meaning in code | Action (`verdictToActionType`, `verdictTypes.js:54-65`) | Executable in production today |
|---|---|---|---|---|
| **KILL** | verdict engine, revenue track (0.9); guardrail sweep writes `hit.verdict` (GUARDRAIL class) | stop spend | PAUSE_CAMPAIGN / PAUSE_ADSET | **yes** (PAUSE) |
| **SCALE** | verdict engine; **Experiment** class writes `'SCALE'` for a winning readout (`agenticPlanner.js:~232`) | grow spend | SCALE_CAMPAIGN / INCREASE_BUDGET | no (not self-contained) |
| **HOLD** | verdict engine | within healthy parameters | none | — |
| **WATCH** | verdict engine: awareness saturation (`verdictEngine.js:377-378`) **and** "no rule could be evaluated" admission (`:403`), distinguished only by `rootCause` | monitor / insufficient evidence | none | — |
| **REFRESH** | verdict engine: creative fatigue, low CTR (`:431-437`), awareness tier (`:375`) | swap creative | REFRESH_CREATIVE | no |
| **REALLOCATE** | verdict engine: inefficient scaling, audience mismatch (`:439-445`); **AllocationService** mints Decision rows `verdict:'REALLOCATE'`, `DECISION_CLASS.ALLOCATION` (`AllocationService.js:48-65`) | move budget | REALLOCATE_BUDGET | no |

**Findings (FACT)**

- All six are valid, current, DB-enforced product states; none is legacy. `TEST` (`DecisionPill`) and `OPTIMIZE` (`signals.js`) are **not** engine verdicts; they are legacy.
- The `verdict` column is **shared across decision classes**: SIGNAL (engine), GUARDRAIL (rule action), EXPERIMENT (SCALE on a win), ALLOCATION (REALLOCATE). The same token therefore makes different kinds of claim depending on `decisionClass`.
- **REALLOCATE is both a verdict and, for ALLOCATION rows, a decision type.** Under locked **R-3**, allocation is not a Decision, so those rows contradict the invariant (C-8). The R-3 ledger listed "stop minting Decision rows" as a **backend item before the frontend rebuild**; it is still open.
- **WATCH carries two meanings** (a saturation signal vs "we could not evaluate"), separated only by `rootCause`.
- Frontend treatment is unequal:
  - Attention bands: ACT_NOW = KILL, REALLOCATE; WATCH = WATCH, REFRESH; HEALTHY = HOLD, SCALE (`overviewDerive.js:78-80`).
  - The chart coarsens to three lanes.
  - Two colour maps disagree for REFRESH (indigo vs blue) and REALLOCATE (cyan vs amber) (`DecisionPill.jsx:17-25`, `signals.js:44-63`).
- The Master Spec fragments give colours for KILL / HOLD / SCALE only. **No colours are proposed here.**

### Ruling request

| Field | Content |
|---|---|
| **QUESTION** | Q9 — What are the semantic colours for WATCH, REFRESH, REALLOCATE in the new palette? (And, prerequisite: is the six-verdict vocabulary one semantic tier?) |
| **REPOSITORY LOCATIONS** | `prisma/schema.prisma:160-168`, `src/services/verdict-engine/{verdictTypes.js, verdictEngine.js}`, `src/services/allocation-engine/AllocationService.js:48-65`, `packages/runtime-contracts/src/decisionClass.js`, `client/src/components/ui/DecisionPill.jsx`, `client/src/design-system/signals/signals.js`, `client/src/features/overview/overviewDerive.js:78-80` |
| **BACKEND CONTRACT** | six-value enum; `decisionClass` published per Decision (C-10); `rootCause` published on verdicts |
| **CURRENT BEHAVIOR** | six verdicts rendered with inconsistent colours; bands and lanes grouped client-side |
| **EXPECTED / IMPLIED BEHAVIOR** | brand gold must not substitute semantic truth (Master Spec fragment); R-3 class taxonomy |
| **CONFLICT** | (a) no approved colours for 3 of 6; (b) REALLOCATE-as-Decision vs R-3; (c) one token across classes; (d) WATCH's dual meaning; (e) band grouping owned by the frontend |
| **PRODUCT IMPACT** | the design system cannot encode verdict semantics without these rulings |
| **RULING REQUIRED** | (1) whether the six are **one tier** or **grouped** (the intervention / monitor / healthy grouping exists in `overviewDerive.js` but is not a published contract); (2) colours for WATCH / REFRESH / REALLOCATE, **or** a ruling that they share a grouped colour; (3) whether `decisionClass` changes how a verdict is presented; (4) whether WATCH-by-admission is presented as a verdict or as an absence; (5) acknowledgement that allocation REALLOCATE rows remain until the frozen backend is reopened |
| **OPTIONS** | (1) six distinct semantic colours · three grouped families (act / monitor / healthy) with a per-verdict label · colour only for the three with actions and neutral for the rest. (4) WATCH-admission shown as WATCH · shown as `NOT_ENOUGH` absence using `rootCause` |
| **RECOMMENDED RULING** | Rule the **grouping first**; colours follow the grouping. For (4), present an admission-WATCH (`rootCause` INSUFFICIENT_DATA / TOO_EARLY) as an **absence reason**, not a signal, consistent with R-4. **No colour values are recommended here.** |
| **CONFIDENCE** | FACTS high; the grouping is a PRODUCT DECISION |
| **IMPLEMENTATION CONSEQUENCE** | verdict tokens are named semantically and disjoint from brand tokens; the band grouping, if ruled, becomes one shared constant consumed by every surface |

---

## 13. P0-11 Decision Agreement

### Trace (FACT)

```text
connectorVerdictService.js:621-627  decisionAgreement: agreementOf({ live:{verdict}, stored: decisionMap.get(id) ?? null, ok: decisionIdentityOk })
decisionAgreement.js:82-96          !ok → {value:null, knowledge:COULD_NOT_LOOK}; no stored → {null, NOTHING_THERE};
                                    else {AGREES|DIVERGES, KNOWN}  (verdict equality only — R-1; confidence ignored)
entities.js:57-60                   GET /entities/verdicts → res.json({ ...result })  (no route-level projection)
lib/api.js → useConnectorVerdicts.js:101  ConnectorVerdictsResponseSchema.safeParse
connectorCampaigns.schema.ts:107-137     ConnectorVerdictRowSchema = z.object({...}) — no decisionAgreement key → STRIPPED
CampaignsView.jsx:320-405                verdictInfoByEntityId: explicit projection list — no decisionAgreement
consumers                                0  (repo-wide grep: backend service + backend test only)
```

| Question | Answer | Tag |
|---|---|---|
| Exact meaning | whether today's recomputed verdict equals the verdict of the newest PROPOSED SIGNAL decision, with KNOWLEDGE saying whether that comparison could be made | FACT |
| Nullable / optional | always present on each verdict row; `value` is null when `knowledge ≠ KNOWN` | FACT |
| Consumers | none in the client | FACT |
| Removal accidental? | not removed: **never admitted**. The backend defers rendering to B8 (`decisionAgreement.js:28-38`), and B8 closed without it. | FACT (headers) / INFERENCE (not deliberate on the client side) |
| Frontend logic expecting it? | none. The `CampaignsView.jsx:366-372` comment anticipates the pair "never reconciled" but reads only `decisionVerdict`. | FACT |

| Field | Content |
|---|---|
| **QUESTION** | Should `decisionAgreement` become part of the canonical frontend view model? |
| **BACKEND CONTRACT** | published, C-06 KNOWLEDGE-tokened |
| **CURRENT BEHAVIOR** | published → **not parsed** → not rendered (fails the close-out gate) |
| **EXPECTED / IMPLIED BEHAVIOR** | C-12; close-out gate; R-1 |
| **CONFLICT** | the one R-1-consistent statement of the relation is discarded |
| **RULING REQUIRED** | admit or not; how its three knowledge cases read |
| **OPTIONS** | (1) admit into the view model with all three cases (KNOWN AGREES / DIVERGES, NOTHING_THERE, COULD_NOT_LOOK); (2) derive agreement client-side from `verdict` vs `decisionVerdict` (loses COULD_NOT_LOOK; violates "a state is published by the backend or it does not exist"); (3) omit |
| **RECOMMENDED RULING** | **(1).** It is the backend-published expression required by Q1. Option (2) reintroduces the exact failure the backend header documents (outage read as "never decided"). |
| **CONFIDENCE** | High |
| **IMPLEMENTATION CONSEQUENCE** | schema admission (a later phase, schema-scoped) plus a render requirement in the decision object primitive. Rendering is bounded by B7-06 (named, not a diff). |

---

## 14. P0-12 Design System Fragmentation

### Verified usage (FACT; import scan of non-test files at `a3ec116`)

| Layer | Importers | Live responsibility | Hidden product logic? | Genuinely dead? |
|---|---|---|---|---|
| `src/primitives/*.tsx` (Shell, Panel, Button, Stack, Cluster; CVA) | `@/primitives/*` imported only by `src/layouts/*.tsx` (all unreachable) and re-exported by `components/primitives/index.js` | none live | no | **dead in practice** (reachable only via re-export) |
| `components/primitives/*` (Text, typography ×5, VerdictBadge, flows ×8) | 3 files: `ContentLabView.jsx`, `AuthPage.jsx`, `components/assemblies/DecisionTrustCluster.jsx` (dead) | typography on Auth; **VerdictBadge in Content Lab** | **yes:** `VerdictBadge` → `signals.js` verdict→style map with unknown→HOLD | partially (flows unused) |
| `design-system/patterns/*` | 8 files: DetailGrammar in 3 detail views; PageHeader; EmptyState in Settings; MetricTile in CopilotPage | detail grammar, headers | **yes:** `DetailGrammar` consumes `absence.js` state semantics | EvidencePanel, RecommendationCard, ErrorState, LoadingState: 0 consumers |
| `components/ui/*` | 33 importers | most live UI | **yes:** `DecisionPill` verdict map (incl. `TEST`); `RecentDecisions` empty-state claim | no |
| (adjacent) `design-system/states/{absence,confidence}.js` | 5 + 4 | locked state grammar | **pure product logic** | no |

Dependency direction (FACT): `components/primitives/index.js` → `src/primitives`; `layouts/*` → `src/primitives`; patterns → `design-system/states`; `components/ui/DecisionPill` has no dependency on `signals.js`, so the two verdict maps are independent duplicates.

**Deletion safety:**
- `src/primitives` and `src/layouts`: INFERENCE safe (no live consumer), **but** `components/primitives/index.js` re-exports `src/primitives`, so a filename-based delete breaks that barrel.
- Any layer holding verdict or state mapping: **not safe to delete** before its semantics are extracted.

| Field | Content |
|---|---|
| **QUESTION** | Q4 — Are `TAXONOMY-FREEZE.md` / `PRIMITIVE-FREEZE.md` / CLAUDE.md file-size budgets superseded by the reset? (+ migration principle) |
| **CURRENT EVIDENCE** | `client/design-system/TAXONOMY-FREEZE.md:46-50` ("Current Adoption: 4% … New primitives BLOCKED", dated June 2026); `client/src/components/primitives/PRIMITIVE-FREEZE.md`; CLAUDE.md "File Size Budget" (page ≤ 300, primitive ≤ 150), exceeded today by `TestingView.jsx` 719 and 5 others |
| **BACKEND CONTRACT** | n/a |
| **CURRENT BEHAVIOR** | four layers, no canonical one; the written freeze blocks new primitives |
| **EXPECTED / IMPLIED BEHAVIOR** | reset spec: "the old design system is not the design authority" |
| **CONFLICT** | a reset necessarily violates the written freeze unless superseded |
| **RULING REQUIRED** | explicit supersession of the freeze docs; keep or restate the file-size budgets |
| **OPTIONS** | supersede all · supersede freeze docs, keep CLAUDE.md budgets for new code · keep all |
| **RECOMMENDED RULING** | **Supersede the June 2026 freeze documents for the new system. Restate size budgets in the Phase 1 constitution** (they are engineering discipline, not product truth). **Migration principle:** see below. |
| **CONFIDENCE** | High on the principle; supersession is a governance PRODUCT DECISION |
| **IMPLEMENTATION CONSEQUENCE** | Phase 1 starts with a governance record replacing the freeze docs |

```text
OLD LAYERS
  ↓  (1) inventory semantics per component: verdict maps, state mapping, gating, identity, currency, copy that states a fact
  ↓  (2) extract semantics into framework-neutral modules with behaviour tests (no markup)
  ↓  (3) the new canonical system consumes those modules; no new primitive re-implements a mapping
  ↓  (4) prove parity per surface against the extracted tests
  ↓  (5) delete old layers by import graph, never by filename
NEW CANONICAL SYSTEM
```

---

## 15. P0-13 Plan / Role Behavior

| Contradiction | Comment | Actual code | History (FACT, `git blame`) | Classification |
|---|---|---|---|---|
| Sidebar plan-locked items | `Sidebar.jsx:63-66`: "renders LOCKED (dimmed + upgrade tooltip) rather than hidden — that's the deliberate upsell" | `Sidebar.jsx:248-256`: "locked items are hidden completely, never shown with a lock"; `navItems = tools.filter(roleAllowed && (planLoading \|\| canAccess(plan)))` | comment `f054b41` 2026-07-14 "feat(plan-gating)"; code `9ea2686` 2026-07-15 "fix(nav): **hide plan-locked nav items instead of showing them with a lock**" | **LEGACY COMMENT.** The code is a deliberate reversal a day later. Product intent for the new system: **PRODUCT INTENT UNKNOWN** (Q8). |
| Attention "nothing executes" | `DecisionCard.jsx:14`: "Read + navigate only. Nothing here executes" | `:171-172` wires `onExecute` / `onDismiss` (human record, by entity) | comment `32613e2` 2026-07-28; wiring `99000ca` 2026-08-06 "feat(decisions): the operator can finally answer a verdict" | **LEGACY COMMENT** (the capability was added later on purpose) |
| First-run writer | `useDismissals.js:7`, `FirstRunBanner.jsx:6`: flag "written by onboarding" | no writer | writer removed `997bcf1` 2026-07-22 | **COMMENT WRONG** (and dead feature, §9) |
| Strict verdict enum safety | `connectorCampaigns.schema.ts:43-49` cites render.yaml | production uses dashboard config; the same-commit build is observed in the deploy log | pre-flight 1 observation | **COMMENT CITES WRONG SOURCE** (premise holds) |

Role and plan runtime facts (FACT):
- `RoleContext` defaults to STRATEGIST on error or loading-miss ("mirrors the backend's null→STRATEGIST"). That is **err-open in the UI**; the backend re-reads authority at the money boundary (Security B/C).
- `usePlan` floors an absent plan to FREE (`hooks/usePlan.js:19-25`), which is **err-closed**.
- Route gates: §3 of the audit.

| Field | Content |
|---|---|
| **QUESTION** | Q8 — Should plan-locked navigation items be hidden (current code) or shown locked (what the Sidebar header comment says)? |
| **REPOSITORY LOCATIONS** | `client/src/components/layout/Sidebar.jsx:55-133,248-261`, `client/src/hooks/usePlan.js`, `client/src/components/auth/PlanGate.jsx`, `client/src/components/plan/UpgradePrompt.jsx`, `client/src/context/RoleContext.jsx` |
| **BACKEND CONTRACT** | `requirePlan` on APIs; plan on `GET /api/user/workspace` |
| **CURRENT BEHAVIOR** | nav hides locked items; direct URL shows `UpgradePrompt` (NOT_PERMITTED expressed on the page, not in the nav) |
| **EXPECTED / IMPLIED BEHAVIOR** | R-4 permission axis: NOT_PERMITTED is a state, not an absence of the item. B7 Ruling 3: surface gate = API gate. |
| **CONFLICT** | nav expresses entitlement as absence; the page expresses it as a state |
| **PRODUCT IMPACT** | FREE workspaces cannot discover Memory, Testing, Measurement, Intelligence or Publishing from navigation |
| **RULING REQUIRED** | hidden vs locked (monetisation and IA) |
| **OPTIONS** | hidden (current) · locked with upgrade affordance (original intent, 07-14) · hidden in nav, discoverable elsewhere |
| **RECOMMENDED RULING** | **PRODUCT DECISION — no recommendation on monetisation.** Evidence note: "locked" is the expression consistent with R-4's permission axis (NOT_PERMITTED as a stated state); "hidden" is consistent with the 07-15 decision and with CLIENT-role behaviour (items never render for a CLIENT). |
| **CONFIDENCE** | FACTS high; intent UNKNOWN |
| **IMPLEMENTATION CONSEQUENCE** | the nav item primitive either supports a NOT_PERMITTED state or does not; decide before primitives |

---

## 16. Playwright / Verification Strategy

### Verified (FACT)

- Config `client/playwright.config.cjs`:
  - `baseURL http://localhost:10000`;
  - **no `webServer`**, so nothing starts the app;
  - JSON report path `/tmp/pw-results.json`.
- `@playwright/test` is a devDependency. There is **no npm script** and **no GitHub workflow** that runs it.
- Specs were last changed `d5e611d` (2026-05-12). There are 58 committed files under `client/test-results/` (videos, screenshots, error contexts).
- Every committed failure is `page.goto: net::ERR_CONNECTION_REFUSED`, so **no test ever reached the app** in those artifacts.

| Spec | Tests | Target | Status |
|---|---|---|---|
| `csv-upload.spec.cjs` | 2 | CSV dropzone / upload spinner | **RETIRED FLOW:** CSV upload deleted (Option A, PR #164) |
| `decision-feed.spec.cjs` | 4 | "Command Center" mode cards, INPUT / THEATER FSM | **RETIRED FLOW:** `useDecisionFSM` deleted (Phase 9) |
| `onboarding.spec.cjs` | 2 | step-1 company name (`input[placeholder*="Acme"]`, "Continue" disabled) | **PARTIALLY STALE:** the 9-step wizard was replaced by NameStep (`997bcf1`); NameStep's placeholder is still "e.g. Acme Marketing", so the selector may still match but the flow assertions target the old wizard. UNKNOWN without running. |
| `auth.spec.cjs` | 4 | login page elements, empty submit disabled, validation, `/app` → login redirect | **RELEVANT:** the flow exists; `/app` → `/login?next=` was observed in production |
| `ux-quality.spec.cjs` | 7 | console errors (landing, login), 44px touch targets, img alt, keyboard Tab, mobile horizontal scroll, "Context: Locked" bottom bar | **6 relevant** checks. The seventh **protects a false claim** ("Context: Locked" is static, §7). |

Every failure is due to **infrastructure** (no server). Stale selectors and routes affect the 6 retired or partially stale tests. **No test protects product truth** (verdicts, decisions, states, gates, money).

| Field | Content |
|---|---|
| **QUESTION** | What should replace these tests in the new frontend verification strategy? |
| **RULING REQUIRED** | the verification layers for the reset |
| **RECOMMENDED RULING** | **(1)** behaviour tests on extracted product-logic modules (§18), markup-independent. **(2)** state-contract tests: every surface state renders from a token, never from array shape (R-4), across LOADING / FAILED / UNAVAILABLE / EMPTY / NOT_CONNECTED. **(3)** the existing real-router harness (PARITY-02: route table generated from `App.jsx`) extended to gates and redirects. **(4)** an authenticated browser harness with a seeded workspace per role and plan, measuring layout, touch targets, contrast, keyboard. **(5)** the six still-relevant auth/UX checks re-expressed there. **Retire** the committed artifacts and the retired-flow specs *after* (1)–(4) exist. |
| **CONFIDENCE** | High |
| **BLOCKS PHASE 1?** | NO |

---

## 17. Landing Performance Finding

### Measured in production this phase (FACT)

`index.html` loads `index-BS0rr8x2.js` (script) plus modulepreload `vendor-react`, `vendor-firebase`, and the stylesheet.

| Asset | Raw | gzip (measured) | br (measured) | Served encoding |
|---|---|---|---|---|
| `index-BS0rr8x2.js` | 584,759 | 164,591 | 167,397 | `Content-Encoding: br` |
| `vendor-react` | 179,878 | 58,962 | 60,535 | br |
| `vendor-firebase` | 166,042 | 33,614 | 33,679 | br |
| `index-Dn9gzeJZ.css` | 106,596 | 28,198 | 27,950 | br |
| **Sum** | **1,037,275** | **285,365** | **289,561** | |

- The audit's "≈286 KB gzipped" is **measured**, not estimated. Browsers are actually served **brotli, ≈290 KB**.
- **Authenticated application code is included** in the landing entry. The minified entry contains strings from:
  - `OverviewView` ("Connect a channel to get started");
  - `CopilotPanel` ("Ask about your campaigns");
  - `ContextBar` ("Dual-Agent Ready");
  - Settings ("Revenue data", account deletion endpoint);
  - Tools placeholder ("Paste any ad copy").

  Control: fictional string absent; landing string present.
- **Route splitting exists** for 16 lazy routes (`App.jsx` `lazy(...)`). Landing, Auth, Onboarding, Home (Attention), Content Lab, Copilot, Tools, Settings and Observability are **static imports** (`App.jsx:18-31`).
- Real-user impact (first paint, TTI on target networks) was **not measured**: UNKNOWN.

**Classification: ARCHITECTURAL DECISION** (public vs app bundle boundary for the reset), backed by a measured OBSERVATION. It is not a performance defect proven by user-facing metrics. **Blocks Phase 1: NO.**

---

## 18. Hidden Product Logic

**PURE UI** = presentation only · **UI + PRODUCT LOGIC** = mixed; the semantics must be extracted before deleting the component · **PRODUCT LOGIC** = no markup, keep and extract · **UNKNOWN**.

| Location | Contains | Class | Delete-safe after visual rebuild? |
|---|---|---|---|
| `features/campaigns/verdictEvidence.js` (514) | C-09 dimensions value + basis, three-state limiting flags | PRODUCT LOGIC | **no:** extract |
| `features/campaigns/gatingReasonCopy.js` (122) | C-07 reason → copy; unknown reason → no action | PRODUCT LOGIC | no: extract |
| `features/campaigns/executionSignals.js` (84) | platform execution identity (decisionId required) | PRODUCT LOGIC | no |
| `features/campaigns/decisionSignals.js` (79) | **by-id vs by-entity routing** | PRODUCT LOGIC | no (§5) |
| `features/campaigns/useDecisionAction.js` (88) | `terminalStateFor` 409 code → terminal state | UI + PRODUCT LOGIC | extract the pure fn |
| `features/campaigns/useLumiExecution.js` (200) | execution lifecycle states, polling | UI + PRODUCT LOGIC | extract states |
| `features/campaigns/LumiExecute.jsx` | action-type copy, refusal-reason copy | UI + PRODUCT LOGIC | extract copy map |
| `features/campaigns/judgmentVocabulary.js` (85), `useDecisionJudgment.js` (143) | R13 judgment vocabulary + 409 reconciliation | PRODUCT LOGIC / UI + PRODUCT LOGIC | no |
| `features/campaigns/executionContext.js` (245) | `ACTIONABLE_VERDICTS`, ad-set pick | PRODUCT LOGIC | no |
| `features/campaigns/campaignGrouping.js` (98) | verdict bands; unknown → UNSCORED | PRODUCT LOGIC | no |
| `features/campaigns/{hypothesisViewModel,counterfactualViewModel}.js` | reasoning view models | UI + PRODUCT LOGIC | extract |
| `features/campaigns/CampaignsView.jsx:320-405` | **field allowlist projection** (drops anything unlisted) | UI + PRODUCT LOGIC | no: it is where fields die (§13) |
| `features/campaigns/pdfData.js`, `lib/pdfExport.js` (550) | PDF content, verdict ranking, gating copy | UI + PRODUCT LOGIC | extract |
| `features/overview/overviewDerive.js` (251) | **band membership** (ACT_NOW = KILL, REALLOCATE …), decision feed join | PRODUCT LOGIC | no (§12, §19 flag) |
| `features/overview/overviewState.js` (269), `overviewInterrupts.js` (81), `overviewPlan.js` (130) | account state incl. `unreadable`, interrupt rules, slot plan | PRODUCT LOGIC | no |
| `features/overview/useDismissals.js` (55) | session dismissal (dead first-run key) | UI | yes (after Q on first-run) |
| `features/overview/components/PacingWidget.jsx` (148), `intelligence/blended-truth/AllocationPanel.jsx` (176) | spend-period NOT_MEASURABLE semantics (#474) | UI + PRODUCT LOGIC | extract |
| `features/intelligence/insights/promotionCopy.js` (87) | C-18 promotion outcome copy | PRODUCT LOGIC | no |
| `features/intelligence/proof/OutcomeEvidence.jsx` | 7 outcome statuses + unrecognised | UI + PRODUCT LOGIC (exemplar) | extract branch table |
| `lib/money.ts` (130) | **minor-unit currency exponents**, `formatCurrency(minor)` | PRODUCT LOGIC | no |
| `lib/currencyFormatter.js` (176) | `formatCurrency(**major**, default 'USD')`, locale map (ar-EG …) | UI + PRODUCT LOGIC | **hazard:** same name, different unit (C-9) |
| `lib/accountAggregate.js` (180) | aggregate absence labels, currency agreement | PRODUCT LOGIC | no |
| `lib/verdictRank.js` (47) | verdict ordering | PRODUCT LOGIC | no |
| `lib/rowIntegrity.js` (64) | unreadable vs absent row | PRODUCT LOGIC | no |
| `lib/contentRecommendations.js` (95) | verdict + signalType → content recommendations | PRODUCT LOGIC | no |
| `design-system/states/absence.js` (99), `confidence.js` (91) | locked absence and confidence semantics | PRODUCT LOGIC | no |
| `design-system/signals/signals.js` | verdict → style, unknown → HOLD | UI + (wrong) PRODUCT LOGIC | replace; do not port |
| `components/ui/DecisionPill.jsx` | verdict → style (+ TEST) | UI + PRODUCT LOGIC | replace after vocabulary ruling |
| `contracts/schemas/*` (41) | parse layer, strict/open vocabulary choices | PRODUCT LOGIC | no |
| `router/ProtectedRoute.jsx` (273), `components/auth/{RoleGate,PlanGate,RequireUserRole}.jsx`, `hooks/{usePlan,useCollabRole,useUserRole}.js`, `context/RoleContext.jsx` | **role gates, plan gates, onboarding redirect**, err-open / err-closed choices | PRODUCT LOGIC | no |
| `components/layout/Sidebar.jsx` `tools` array | per-item roles, plan, group | PRODUCT LOGIC inside UI | extract the declaration |
| `app/routeManifest.js`, `App.jsx` route + redirect table | deep links, OAuth return address | PRODUCT LOGIC | no |
| `features/content-lab/ContentLabView.jsx:172-175` | **client confidence bucketing** (0.8 / 0.6) | UI + PRODUCT LOGIC (boundary violation, Q12) | do not port |
| `components/layout/{ContextBar,RadarStrip}.jsx`, Sidebar WATCHING | static status | PURE UI (false claims) | yes, do not port |
| `components/ui/{Skeleton,EmptyPanel,HelpTip,Pagination,ConfirmModal}` | presentation | PURE UI | yes, after replacement |
| `pages/demo/Operations/*` | demo execution panels (inline styles, state config) | UNKNOWN (Q5) | pending Q5 |

**Answer to the section's question.** Everything classed **PURE UI** can be deleted once replaced. Everything classed **PRODUCT LOGIC** or **UI + PRODUCT LOGIC** must first be **extracted into markup-independent modules with behaviour tests** (§14 principle), or the reset silently reverts locked contracts: C-07, C-09, C-12, R13, B8-02, #474, the currency minor-unit fix, and the gates. Two items are explicitly **not** to be ported: `signals.js` unknown→HOLD and Content Lab confidence bucketing.

---

## 19. Product-Truth Boundary

```text
BACKEND OWNS                      FRONTEND OWNS                     AI OWNS
─────────────                     ─────────────                     ────────
Data truth                        Presentation                      Explanation
Decision truth                    Interaction                       Narration
Execution truth                   Navigation                        Interpretation assistance
Authorization truth               State expression
Measurement truth                 Evidence organization
Currency truth                    Decision comprehension
Lifecycle truth                   Action affordance
```

### Where repository evidence contradicts the boundary (flagged, not modified)

| # | Contradiction | Side that owns it today | Evidence | Tag |
|---|---|---|---|---|
| B-1 | **Band membership** (which verdicts are "act now") is decided in the frontend | frontend | `overviewDerive.js:78-80`; the backend `agendaItem` also carries a `band` for agenda items (`agenticTypes.js:90`), so there are **two band authorities** for different populations | FACT / PRODUCT DECISION (§12) |
| B-2 | **Confidence label** derived client-side | frontend | `ContentLabView.jsx:172-175` | FACT (Q12) |
| B-3 | **State derived from data shape** (empty / connected) | frontend | §6, §8 | FACT (violates R-4) |
| B-4 | **Liveness / context / AI readiness asserted with no data** | frontend | §7 | FACT |
| B-5 | **Field admission** (which backend facts reach the UI) decided by a hand-written projection and schemas | frontend | `CampaignsView.jsx:320-405`, `connectorCampaigns.schema.ts` | FACT; admission is legitimately frontend-owned, but dropping a published truth fact is not |
| B-6 | **Role defaults to STRATEGIST** on error or loading in the UI | frontend (display only) | `RoleContext.jsx:8-17`; backend authority re-read at the money boundary | FACT; acceptable only because the backend is authoritative |
| B-7 | **Currency default `'USD'`** and **market default `'EG'`** when absent | frontend | `currencyFormatter.js:57`, `Sidebar.jsx:177` | FACT (missing → fabricated value) |
| B-8 | **Allocation Decision rows** contradict the backend's own locked taxonomy | backend | `AllocationService.js:48-65` vs R-3 | FACT (frozen; ruling needed on sequencing) |
| B-9 | **AI prose may contain numbers** with no row provenance in the UI | AI | `useCopilot.js:37-43` renders `answer` verbatim | FACT (Q3) |
| B-10 | **Verdict coarsening** (6 → 3 lanes) in a chart | frontend | `CampaignsView.jsx` `connectorTotals` | FACT |

---

## 20. Product Ruling Matrix

| ID | Question | Fact | Unknown | Product Decision | Recommended Ruling | Blocks Phase 1? |
|---|---|---|---|---|---|---|
| P0-01 / Q1 | Assessment vs stored decision on acting surfaces | live shown; judge / record / **Meta execute bind to stored**; divergence invisible | divergence frequency | how actions disclose their target; behaviour on DIVERGES | Option A: disclose the decision-of-record + agreement in words; D (withhold on DIVERGES) as sub-ruling | YES |
| P0-02 / Q2 | Mutation identity + "execute" naming | by-id vs by-entity split within one card; route contract prefers by-id | — | canonical identity; naming | DECISION when present, ENTITY fallback, disclosed; "execute" = platform mutation, human = record | YES |
| P0-03/04 | Failure vs empty; owning layer | shell derives state from shape (also while loading) | "connected but never synced" publication | ownership / mapping only (principle locked by R-4) | data layer owns transport states, backend owns data absence; token-driven state | YES |
| P0-05 | WATCHING / ContextBar / Radar | static, unbacked; market defaults "EG" | real sync cadence per workspace | whether a measured liveness state exists | no liveness claim unless bound to a published fact | NO |
| P0-06 | Campaign chart states | four states collapse into "Connect Meta" | — | per-state meaning | only a successful NOT_CONNECTED read may instruct connection | NO |
| P0-07 | First-run on failure | rule ignores `unreadable`; **no writer since 997bcf1** | intended first-run UX | whether first-run exists | recommendations require a successful read of their precondition | NO |
| P0-08 | Observability zeros | real zeros on 200; `\|\| 0` masks drift | — | principle only | zero only when measured; absent is absent; N/A is its own state | NO |
| P0-09 | Unknown verdict | strict enum → parse failure; Badge unknown→HOLD latent; Pill neutral; TEST/OPTIMIZE non-engine | — | canonical behaviour | unknown = contract failure; defensive "unrecognised" for open feeds; never map to a verdict | NO |
| P0-10 / Q9 | Verdict vocabulary + colours | 6 valid DB-enforced verdicts; shared across 4 classes; REALLOCATE also an allocation Decision (vs R-3); WATCH dual meaning; two inconsistent maps | Master Spec beyond fragments | grouping; colours for WATCH / REFRESH / REALLOCATE; class-aware presentation; admission-WATCH | rule grouping first, colours follow; admission-WATCH as absence reason | YES |
| P0-11 | `decisionAgreement` in view model | published, stripped, 0 consumers | — | admit or not | admit all three knowledge cases | YES |
| P0-12 / Q4 | Fragmentation + freeze supersession | 4 layers; `src/primitives` dead in practice; logic in 3 layers | — | supersede freeze docs | supersede; restate budgets; extract → consume → prove → delete by graph | NO |
| P0-13 / Q8 | Plan-locked nav; comment contradictions | both contradictions are LEGACY COMMENTS; hide was a deliberate 07-15 reversal | original monetisation intent | hidden vs locked | PRODUCT DECISION (R-4 permission axis favours stated NOT_PERMITTED) | YES |
| Q3 | Traceability of landing visuals / AI prose numbers | landing uses illustrative figures; AI answers render verbatim | — | whether the law covers illustrative / AI numbers | rule explicitly; if illustrative is allowed, it must be visibly marked as illustrative | YES |
| Q5 | URL-only surfaces survive? | copilot + 3 tools are placeholders; observability and demo ops live, ungated by role | real usage | keep / drop | inventory ruling; no semantics encoded | NO |
| Q6 | Copilot product truth; chat-first vs anti-convergence | live panel on Attention; "Coming soon" page; landing "NEW · Ask anything" | — | which truth; interaction model | one truth across surfaces; interaction model ruled before AI surface design | YES |
| Q7 | "Never shared" vs network consent | claim on landing; opt-in consent route exists | what network features share | copy truth | reconcile claim with consent semantics before landing rebuild | NO |
| Q10 | Decision destination links | links only from Decisions list and experiment details | — | IA edges | follow R-2: the decision object links to its own destination | NO |
| Q11 | Light / dark | app light; `index.html` `class="dark"`; Master Spec names Charcoal | Master Spec intent | theme model | rule before tokens | YES |
| Q12 | Backend confidence label | client buckets 0.8 / 0.6 in Content Lab only | — | label ownership | backend publishes (C-09: display, never recompute) or remove the label | NO |
| Q13 | Growth Strategy one surface | 5 panels, 14 endpoints, one route | — | IA split | IA ruling; no design-system semantics | NO |
| Playwright | Old suite | never reached app; 6 retired / stale; 1 protects a false claim; none protect product truth | onboarding spec relevance | strategy | behaviour + state-contract + router + authenticated harness | NO |
| Landing bundle | ≈285 KB gzip / ≈290 KB br | authenticated code in public entry | real-user impact | public / app split | ARCHITECTURAL DECISION for the reset | NO |

---

## 21. Decisions Required From Omar

### Ruling blocks for Q3, Q5, Q6, Q7, Q10, Q11, Q12, Q13

**Q3 — Does "every number traces to a DB row" apply to (a) illustrative landing and marketing visuals and (b) numbers inside AI prose?**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: the landing hero mock ("Alexandria Villas — July", KILL 94%), the "Why Lumi said KILL" timeline (CTR 1.8% → 0.48%, frequency 7.1) and SignalToAction are hard-coded (`client/src/pages/LandingPage/{HeroSection,WhyKillSection,SignalToActionSection}.jsx`). FACT: Copilot, "Lumi's read" and narratives render AI text verbatim (`hooks/useCopilot.js:37-43`, `AccountStateHero.jsx`, Leadership). |
| BACKEND CONTRACT | copilot `answer` string; narratives `sections` + `evidenceRefs` |
| CURRENT BEHAVIOR | illustrative numbers unmarked; AI numbers without provenance |
| EXPECTED / IMPLIED | governing law as stated without scope |
| CONFLICT | the law has no stated scope for marketing or AI text |
| OPTIONS | (a) marketing exempt · exempt only if visibly marked illustrative · banned (real anonymised data only). (b) AI may not state numbers · may state numbers only when citing a published value · allowed |
| RECOMMENDED | (a) exempt **only if visibly marked as illustrative**. (b) AI numbers only when they cite a published value (narratives already carry `evidenceRefs`). |
| CONFIDENCE | medium (PRODUCT DECISION) |
| IMPLEMENTATION CONSEQUENCE | an "illustrative" marker primitive; AI text primitives distinguish cited from uncited figures |

**Q5 — Do URL-only surfaces survive?**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: `/app/copilot` placeholder ("Coming soon"); `/app/tools/{score,calendar,marketing}` placeholders ("Coming Soon", 23 LOC each); `/app/observability` live (3 endpoints); `/app/demo/operations` live (7 endpoints, execute/* reads); none in nav; no route role gate on any of them (`App.jsx:382-448`) |
| BACKEND CONTRACT | `/api/observability/*` gated by workspace, not role; `/api/execute/*` operator-gated by mount (Security C) |
| CURRENT BEHAVIOR | reachable by URL |
| CONFLICT | placeholders state future capabilities as pages; demo surface in production app |
| OPTIONS | keep · drop · move ops surfaces to `/admin` |
| RECOMMENDED | drop placeholders; rule observability and demo ops as **internal** (admin) or drop. PRODUCT DECISION. |
| UNKNOWN | real usage (no analytics read) |
| IMPLEMENTATION CONSEQUENCE | inventory only |

**Q6 — Copilot product truth; chat-first vs anti-convergence**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: live `CopilotPanel` slot on Attention (`POST /api/lumi/copilot`, read-only, ephemeral); `/app/copilot` "Coming soon / Join the waitlist"; landing "NEW · Ask anything … Real answers from live data — in seconds" (observed in production DOM) |
| BACKEND CONTRACT | copilot answers grounded server-side; never executes |
| CONFLICT | three contradictory statements of one capability; chat bubbles and prompt box conflict with the anti-convergence rules |
| OPTIONS | one live capability expressed as (a) chat panel · (b) question-scoped explanation attached to a verdict / decision (explain *this*) · (c) not a product surface yet |
| RECOMMENDED | one truth across all three surfaces. Interaction model (b) is the one consistent with "AI explains, narrates, helps interpret" and anti-convergence. PRODUCT DECISION. |
| CONFIDENCE | medium |
| IMPLEMENTATION CONSEQUENCE | determines whether the design system has a conversational primitive at all |

**Q7 — "Your campaign data stays in your workspace. Never shared." vs `POST /api/lumi/network/consent`**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: claim in `SocialProofSection.jsx`; consent route consumed by Memory (`/app/memory` closure) |
| UNKNOWN | what the network feature shares, and whether consent is off by default (not traced in this phase) |
| CONFLICT | an absolute claim beside an opt-in sharing mechanism |
| OPTIONS | qualify the claim ("never shared without your consent") · remove the network feature · keep |
| RECOMMENDED | rule after a backend read of network-consent semantics; qualify rather than assert absolutes |
| IMPLEMENTATION CONSEQUENCE | landing copy truth only |

**Q10 — Decision links to its destination and back**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: links to `/app/decisions/:id` exist in `DecisionHistoryView.jsx:46`, `TestingView.jsx:169`, `TestDetailView.jsx:165`, `HoldoutDetailView.jsx:192`; none from Attention or Campaigns; the detail links back only to the list (`DecisionDetailView.jsx:99`) |
| EXPECTED | R-2: the Decision owns a destination; Campaign is a lens; the drill-down is evidence, not navigation |
| RECOMMENDED | the decision object links to its own destination wherever shown; the detail links to its campaign lens and outcome evidence. PRODUCT DECISION (IA). |
| IMPLEMENTATION CONSEQUENCE | decision object primitive has an address affordance |

**Q11 — Light, dark, or both?**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: tokens are light (`#F8F6F2` ground); no dark mode ("DARK MODE PREPARATION (Future)", `index.css`); `index.html` `class="dark"`, `theme-color #0A0B0F`; Master Spec palette includes Charcoal `#0B0F14` and Off White `#F7F7F3` |
| UNKNOWN | Master Spec theme intent (not in repository) |
| OPTIONS | light only · dark only · both from the start · light first with tokens ready for dark |
| RECOMMENDED | PRODUCT DECISION. Rule before token work. |
| IMPLEMENTATION CONSEQUENCE | token architecture (single vs themed) |

**Q12 — Should the backend publish a confidence label?**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: `ContentLabView.jsx:172-175` buckets `decision.confidence` ≥ 0.8 High, ≥ 0.6 Medium; confidence rung vocabulary exists in `design-system/states/confidence.js` (B8-05) |
| EXPECTED | C-09: display, never recompute |
| OPTIONS | backend publishes label · remove label, show value + basis · keep client bucketing |
| RECOMMENDED | backend-published label, or value + basis only; never client thresholds |
| IMPLEMENTATION CONSEQUENCE | a later backend/schema slice; not a design-system blocker |

**Q13 — Does Growth Strategy remain one surface?**

| Field | Content |
|---|---|
| CURRENT EVIDENCE | FACT: `/app/intelligence/insights` owns 23 files / 2,844 LOC and 14 endpoints across goals, economics, plans (+ promote), approvals, fatigue |
| EXPECTED | B7 axes; R-3 (plans / allocation are artifacts, not Decisions) |
| RECOMMENDED | IA ruling after Phase 1; no design-system semantics encoded |

### Consolidated decision list (ordered by Phase 1 dependency)

1. **Q11** theme model.
2. **P0-10 / Q9** verdict grouping, then colours; admission-WATCH presentation.
3. **P0-03/04** state ownership and the five-state mapping.
4. **Q1 + P0-11** assessment vs decision expression; admit `decisionAgreement`.
5. **Q2** mutation identity and "execute" vocabulary.
6. **Q8** plan-locked nav: hidden vs NOT_PERMITTED.
7. **Q3** illustrative and AI numbers.
8. **Q6** Copilot truth and interaction model.
9. **Q4** supersede freeze docs (governance, at Phase 1 start).
10. **After Phase 1:** Q5, Q7, Q10, Q12, Q13; P0-05 to P0-09 principles (already implied by R-4); the sequencing of R-3 allocation-row removal (frozen backend).

---

## 22. Phase 1 Implications

- **The design constitution inherits locked articles, not the old UI.** R-1, R-2, R-3, R-4, B8-01, C-07, C-09 and C-12 are inputs. The constitution must not re-decide them.
- **Primitives must be state-token driven.** No component may accept an array and infer LOADING / EMPTY / FAILED / NOT_CONNECTED (R-4, §6).
- **The decision object has two named slots** (assessment, decision-of-record) and an agreement statement, pending Q1 (§4, §13).
- **The action primitive carries an explicit target** (DECISION / ENTITY), pending Q2.
- **Verdict tokens are semantic and disjoint from brand tokens.** Colours only after the grouping ruling (§12). No fallback colour maps to a verdict (§11).
- **No liveness, context or "AI ready" status primitive** without a published fact (§7).
- **Extraction precedes replacement** for every PRODUCT LOGIC / UI + PRODUCT LOGIC module in §18. `signals.js` unknown→HOLD and client confidence bucketing are not ported.
- **Governance:** supersede the June 2026 freeze documents explicitly (Q4).
- **Backend is frozen:**
  - `decisionAgreement` admission is a client schema change (allowed in a later phase).
  - R-3 allocation-row removal and a backend confidence label are backend changes that need their own authorisation.
- **Verification plan** (§16) should be ruled alongside Phase 1 so parity is provable before deletion.

---

## 23. Phase 0.5 Verdict

**STOP conditions encountered.** They were reported, not resolved.

- **Locked invariants contradicted:**
  - by frontend behaviour: R-1 disclosure (§4, §5) and R-4 shape-derived state (§6–§8);
  - by a backend writer: R-3 allocation Decision rows (C-8).
- **Documentation contradicts behaviour:** 4 comments (§15). The audit itself contains 4 material corrections and one citation drift (§2.3).
- **The Master Build Spec is not in the repository.** Theme and colours for 3 of 6 verdicts cannot be checked against it.

None of these requires a backend change to *understand*. Each open item is a product ruling this document prepares, not decides.

```text
READY FOR PHASE 1 AFTER PRODUCT RULINGS
```
