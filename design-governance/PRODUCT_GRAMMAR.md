# LUMI PRODUCT GRAMMAR

```text
Status   FOUNDATION — part of LUMI_DESIGN_CONSTITUTION.md (Article 6); awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
Rule     This grammar invents no product semantics. Every definition below is
         extracted from locked rulings or backend code, and the source is named.
```

The grammar is the set of **objects the interface is made of**. Components,
layouts and tokens exist only to express these objects. A component that
expresses none of them needs the justification in COMPONENT_RULES.md CMP-02.

Rule IDs follow the namespaces in LUMI_DESIGN_CONSTITUTION.md: Constitution
R-n, PR-n, B7/B8 rulings, and C-nn contracts.

---

## 1. The objects and how they relate

```text
                        ATTENTION  (a VIEW over open items — not a noun)
                            │ opens
                            ▼
  MEASUREMENT ─ qualifies every figure below ─────────────────────────────┐
                                                                          │
  VERDICT ──► REASON ──► EVIDENCE ──► ACTION ──► OUTCOME ──► MEMORY       │
     │  (NOW: assessment · AT DECISION: stored)                           │
     └──── belongs to ───► DECISION (the unit of work; owns a destination)┘
```

- **DECISION** is the container object of the loop. VERDICT, REASON, EVIDENCE,
  ACTION and OUTCOME are read *through* a Decision (the Decision Spine,
  Constitution Article 8).
- A **current assessment** (NOW) is a VERDICT with REASON and EVIDENCE but **no
  ACTION**, because nothing has been committed (Constitution R-1, PR-1).
- **MEMORY** sits across Decisions (the ACROSS axis). On a single Decision it
  appears only as that Decision's own frozen provenance, never as live memory
  (Constitution R-5, R-6; B7 Ruling 3b).
- **ATTENTION** is how NOW is entered. **Campaign** is a lens (SUBJECT), not a
  grammar object: it is the evidence history of a subject across many calls
  (B7-05).
- **MEASUREMENT** is the epistemic envelope every figure travels in.

**Navigation axes** (B7, locked): `NOW · Attention` · `THEN · Decision` ·
`SUBJECT · Campaign` · `ACROSS · Memory`. The IA and this grammar are separate
things: axes are where you go, objects are what you read.

**Decision classes** (Constitution R-3, `DecisionClass` enum):
`SIGNAL · GUARDRAIL · EXPERIMENT` have a destination. `ALLOCATION` is a storage
class **without** a destination (`hasDestination()`,
`src/services/decisions/decisionClassScope.js:247-264`). A class changes *what
exists*, not how it is styled (B7-04).

---

## 2. VERDICT

| Field | Definition |
|---|---|
| **Definition** | LUMI's classification of an entity's performance call. The six canonical values, all distinct and all semantic, are `KILL · HOLD · SCALE · WATCH · REFRESH · REALLOCATE` (🔒 PR-5; Prisma `enum Verdict`, `prisma/schema.prisma:160-168`). |
| **Purpose** | State the call in one word, so everything else on the surface can be read as its grounds. |
| **User question** | *What did LUMI conclude?* |
| **Information relationship** | Always in exactly one **tense**: NOW (current assessment, Signal class only) or AT DECISION (stored). Belongs to a Decision when stored. Grounded by REASON and EVIDENCE. **Separate from ACTION**: verdict → eligibility → supported action? → action (PR-5). A Guardrail's call reads as **episode state** (active breach / resolved), not as a verdict snapshot (B7-04 R-F). |
| **Visual priority** | **Highest** on any surface where it appears: the most illuminated word, set in Inter, neutral high-contrast tone, with its verdict colour mark beside it. The word is mandatory; colour is secondary (Constitution Articles 12 and 21, FC-3). |
| **Allowed states** | AVAILABLE (a verdict exists) · gated with a C-07 reason — `NO_MEASURABLE_DELIVERY`, `NO_CANONICAL_WINDOW`, `CANONICAL_EVIDENCE_STALE` (`packages/runtime-contracts/src/gatingReason.js:43-50`), so no verdict renders and the reason does · NOT_PERMITTED (e.g. `SCORING_HIDDEN`) · FAILED · LOADING. Divergence between NOW and AT DECISION is shown as a named fact (`decisionAgreement`, C-12). |
| **Must not become** | a button or action affordance · a colour-only chip · a filled pill with text inside · a health score · a gold badge · a client-side derivation (no recomputing, no bucketing) · an `unknown → HOLD` fallback (the legacy `signals.js` did this, audit P0-14) · a verdict mark on an ALLOCATION row presented as a Decision · a live verdict dressed as the stored one (PR-1) |

---

## 3. REASON

| Field | Definition |
|---|---|
| **Definition** | Why this verdict was reached. On a **stored Signal Decision**: the reasoning frozen at commitment — `diagnosis`, `hypotheses`, `counterfactuals` (rejected alternatives with `rejectedBy`, `preferredBecause` and their own confidence). On a **current assessment**: entity-scoped live reasoning (`CampaignReasoning`), valid only while its own `verdict` matches the verdict it explains (B7-04, B8-03). |
| **Purpose** | Show that LUMI **considered** rather than merely computed. The rejected alternative's strength is often the whole question (B8-03). |
| **User question** | *Why?* |
| **Information relationship** | Immediately follows VERDICT on the spine; precedes EVIDENCE. Shares the tense of the verdict it explains and never borrows reasoning from the other tense. |
| **Visual priority** | Second-highest. Declarative sentences; doubt lives in a figure, not in hedged prose (B8-01 L-3). |
| **Allowed states** | AVAILABLE · **not produced by this class** — the section does not render at all (Guardrail has no hypotheses, B7-04 R-E) · `[]` on a Signal meaning "the engine ran and found no mechanism", which is a finding, vs `null` meaning "nothing supplied", which is an absence (B7-04; only when the contract publishes the distinction) · FAILED · LOADING |
| **Must not become** | generated prose presented as the cause · reasoning from a pass that did not decide, shown as the cause (B8-03) · live `CampaignReasoning` placed on a stored Decision · a Guardrail borrowing Signal reasoning (R-E) · a paragraph of hedges |

---

## 4. EVIDENCE

| Field | Definition |
|---|---|
| **Definition** | The measurements a claim was made over, **named by the claim** through `evidenceReference.entityIds`, each carrying its population, window and basis (B7-05, B8-04, C-09). |
| **Purpose** | Let a person check a call without leaving it. |
| **User question** | *What supports it?* |
| **Information relationship** | Entered **from a claim, never from a tree** (B7-05). Grouped by the question it answers: is it working (canonical verdict evidence) · is the creative using itself up (fatigue) · what is its state now (operational; drives no verdict) · what happened after we acted (daily + outcome) (B8-04). A child entity (ad set, ad) appears only because a claim named it; performance verdicts are campaign-level, so they never name an ad set (B8-04). |
| **Visual priority** | Medium. Figures in JetBrains Mono with windows; less light than VERDICT and REASON. |
| **Allowed states** | AVAILABLE · STALE (`CANONICAL_EVIDENCE_STALE`, with the period stated) · NOT_MEASURED · INSUFFICIENT_DATA · NO_CONVERSIONS · MIXED_CURRENCY · UNAVAILABLE · FAILED · LOADING · NOT_PERMITTED |
| **Must not become** | an entity-tree browser · "all evidence" · a sortable metric table with no claim above it · a chart-first overview · a default KPI strip · a figure without a window · two populations merged into one series · a rate derived from a windowless aggregate (`spendMinor` never becomes a rate) |

---

## 5. DECISION

| Field | Definition |
|---|---|
| **Definition** | A persisted commitment: a `Decision` row of class `SIGNAL`, `GUARDRAIL` or `EXPERIMENT`, with status `PROPOSED · EXECUTED · DISMISSED · SUPERSEDED · RESOLVED` (`prisma/schema.prisma:1398-1434`). It is **the unit of work**, and it owns a destination of its own (Constitution R-2; B7 Ruling 1; `/app/decisions/:id`, read by `getDecisionDetail`, `src/services/decisions/decisionDetail.js:232`). |
| **Purpose** | Hold the call LUMI committed to, and everything that happened to it: action, execution, outcome. |
| **User question** | *What did LUMI decide — and what became of it?* |
| **Information relationship** | Owns ACTION, execution and OUTCOME (PR-1). Is **never rewritten** by a later assessment (Constitution R-1). Written only when the verdict **changes**, so `PROPOSED` means "still open", never "new" (B7-01). Class layer: Signal (hypotheses, rejected alternatives, confidence with its weak dimension) · Guardrail (rule, threshold, observed breach, episode; **no confidence figure**, since 0.9 is a constant) · Experiment (hypothesis + readout from its live object) (B8-03). Addressable without Campaign (B7 Ruling 1); the Decision destination is ungated (B7 Ruling 3a). |
| **Visual priority** | The Decision is the **frame** of the spine rather than a competing element. Its identity (class, status, committed time in mono) is quiet metadata; its verdict is the loudest word. |
| **Allowed states** | AVAILABLE (by status) · FAILED · LOADING · refused as a destination (typed 409 `NotADecisionDestination` for ALLOCATION, and a separate refusal for an unclassified row; never a 404) · a 409 on action because it is no longer PROPOSED, which is a state and not an error toast |
| **Must not become** | a campaign row · "new" because it is open · a card in a grid of equal cards · an ALLOCATION presentation (Constitution R-3) · a destination that shows live memory beside the committed call (B7-06) · a Decision identity fabricated for an entity that has none (Constitution R-1) |

**Naming hazard.** The word "Decisions" was spent twice on other axes in the
legacy sidebar: "Today's decisions" pointed to Overview (NOW), and "Decision
queue" to Campaigns (SUBJECT) (B7 F-N2). In the new system the word belongs to
THEN.

---

## 6. ACTION

| Field | Definition |
|---|---|
| **Definition** | An operation bound to a **specific Decision by `decisionId`** (🔒 PR-2). There are two kinds, which must be typographically unmistakable (B8-03 invariant 9). **PLATFORM MUTATION** — LUMI changes the world: `POST /api/execute/meta`, which requires a `decisionId`. Today it is only `KILL → PAUSE_CAMPAIGN` on `META`, offered only when the server's executability descriptor says `supported: true` (`src/services/execution/decisionExecutability.js:31-67`). **HUMAN RECORD** — a person records a claim: executed-by-me, dismiss, judgment, outcome (`PATCH /decisions/:id/{execute,dismiss,judgment}`, which returns 409 when the Decision is no longer PROPOSED). |
| **Purpose** | Let a person act on, or record their response to, the call they are looking at, and only that call. |
| **User question** | *What should happen — and what can I do about this decision?* |
| **Information relationship** | Belongs to a stored DECISION. **Never** attached to a NOW assessment (PR-1; B8-04). `Verdict ≠ Action` (PR-5): a verdict may have no action (`NOT_EXECUTABLE.NO_ACTION_FOR_VERDICT` for HOLD / WATCH; `NEEDS_OPERATOR_INPUT` for SCALE / REFRESH). A platform mutation's lifecycle becomes PROCESSING → SUCCESS or FAILED (`ExecutionStatus`), and then OUTCOME. |
| **Visual priority** | Grouped in one **action group** adjacent to the Decision it acts on. Neutral structural styling; **never verdict-coloured**, never gold by default. A platform mutation carries more visual weight and a confirmation; a human record is lighter and phrased in the first person. |
| **Allowed states** | available · refused with a `NOT_EXECUTABLE` reason (the refusal **is** the copy, B8-01 L-11) · PROCESSING (in flight) · SUCCESS · FAILED (including `TIMED_OUT`, `CANCELLED`) · 409 no-longer-open · NOT_PERMITTED (role) |
| **Must not become** | a generic "Approve / Execute" implying LUMI acts when it records (B8-03) · a control offered where the backend refuses it · a verb implying every verdict is executable · a mutation that resolves "latest decision" at write time when an id was available (PR-2) · a control on a live assessment · an **ENTITY ACTION** (see below) |

**ENTITY ACTION — reserved, not available (⚠️ FC-8).** PR-2 requires that an
action on an entity with no Decision be explicit. **No backend contract exists
for it.** Execution without a Decision is refused (`NOT_EXECUTABLE.NO_DECISION`:
"a real mutation the Proof Engine can never attribute"), and by-entity signal
routes return `404 NoLiveDecision`. The grammar reserves the target kind
`ENTITY`, so the discriminator exists (`target: DECISION(id) | ENTITY(id)`). No
component may render an ENTITY action until a contract publishes one.

---

## 7. OUTCOME

| Field | Definition |
|---|---|
| **Definition** | What happened after a Decision was acted on. It has two parts: the **platform result** of a mutation (`ExecutionRequest` lifecycle: `EXECUTED_SUCCESS`, `EXECUTED_FAILED`, `TIMED_OUT`, `CANCELLED`), and the **measured outcome evidence** (seven statuses: `MEASURABLE · INSUFFICIENT_COVERAGE · UNSUPPORTED · NOT_OBSERVED · AMBIGUOUS · UNAVAILABLE · NOT_MEASURABLE`; exemplar `client/src/features/intelligence/proof/OutcomeEvidence.jsx`). |
| **Purpose** | Close the loop honestly: did acting on the call change anything we can measure? |
| **User question** | *What happened?* |
| **Information relationship** | Follows ACTION on the spine; feeds LEARNING and MEMORY. Belongs to its Decision; outcome evidence is readable at FREE through the Decision destination (B7 navigation discovery). |
| **Visual priority** | Medium. Appears only after an action exists; `NOT_OBSERVED` is a measured state that renders, while "no action yet" draws no outcome stage. |
| **Allowed states** | each of the seven outcome statuses as its own state · an unrecognised status as its own refusal, never inheriting a neighbour (the exemplar's `:221` branch) · execution lifecycle states · FAILED · LOADING |
| **Must not become** | an accuracy percentage without its denominator (C-14) · implied causation ("performance improved because…") · a zero for unmeasured · a success celebration · a before/after chart with mismatched windows |

---

## 8. MEMORY

| Field | Definition |
|---|---|
| **Definition** | Institutional knowledge across Decisions: learned beliefs (`AccountPattern`) with **four temporal facts** — since when, how often tested, how often right, what it replaced (C-14, B8-05) — and their state (`CONFLICTED`, promoted to policy, `ESTABLISHED`, `EMERGING`, `SUPERSEDED`) (B7-06). One surface, read two ways: *what has LUMI learned?* and *what repeats?* (B7 Ruling 2). **Distinct** from a Decision's **provenance**, the memory measured at commitment and frozen by value (Constitution R-5, R-6). |
| **Purpose** | Show that the system compounds rather than merely observes. "Became policy" leads, because it is the proof of compounding (B7-06). |
| **User question** | *What did we learn? What keeps happening?* |
| **Information relationship** | ACROSS axis; the destination is GROWTH-gated, while provenance **on a Decision** is ungated (B7 Ruling 3b). Feeds future assessments by **confidence only, never verdict** (Constitution R-1). A promoted pattern is a live `GuardrailRule`, whose Decisions are countable. |
| **Visual priority** | Medium-high on its own destination: a belief is a statement first, with its four facts as mono metadata. Low and frozen on a Decision (provenance). |
| **Allowed states** | AVAILABLE · `accuracy: null` as NOT_MEASURED (never a percentage) · EMPTY as a finding (no beliefs extracted) · NOT_PERMITTED (plan) · FAILED · LOADING · **absent until published** on a Decision (the destination shows no memory until provenance is published; B7-06, C-16) |
| **Must not become** | a chart of patterns learned over time (B8-05) · a live pattern placed beside a stored Decision (hindsight; B7-06) · a promote affordance on a non-promotable kind · `accuracy` alone · a surface for recurrence **below** the extraction threshold, which is absent truth, not a missing screen (B7 Ruling 2) · generated prose |

---

## 9. ATTENTION

| Field | Definition |
|---|---|
| **Definition** | The **default view** of what is open and needs a person now. It is not a noun and has no id (B7-02, R-N3). Its population is open Decisions **plus** other attention items: fatigue predictions, pacing alerts, test suggestions, running experiments (B7-03 re-derived). It is partitioned by what the human has done and **ordered by severity, then impact** (recency partitions, never sorts; class never sorts) (B7-03, B8-02 attention). |
| **Purpose** | Answer the first question of every session without asking the person to browse. |
| **User question** | *What matters now?* |
| **Information relationship** | Opens into THEN (the item's own destination, R-D). Experiment enters through its **live object**, not its historical Decision (R-A). Deduplicated by attention-item semantics — entity scope for Signal, episode for Guardrail, experiment id for Experiment — **never by entity alone** (R-C). |
| **Visual priority** | The home of the product. Each item leads with its call and *why now*, then the class-specific "why credible" slot (B8-02 attention). The single gold attention signal in a region belongs here. |
| **Allowed states** | AVAILABLE · EMPTY as the **result** "nothing needs you" only where the backend publishes it; "nothing new" is a result, not an absence (B8-01 L-9) · FAILED (the account could not be read, never "empty", B8-02) · LOADING · account-level NOT_CONNECTED (**PARTIAL trigger**, FC-7) |
| **Must not become** | an inbox · "you're all caught up" (no acknowledgement fact exists, B7-03) · a "reviewed" / "new" / "acknowledged" state (R-B) · a KPI dashboard · a chart · a campaign list · class filters · allocation rows · generated narration at read time (`ON_READ` never narrates) |

---

## 10. MEASUREMENT

| Field | Definition |
|---|---|
| **Definition** | The epistemic envelope of any figure or claim: **value + window + basis + knowledge token + reason**, stamped with the **clock** it belongs to. There are four clocks — evidence, assessment, decision, learning — and one "last updated" can be true of one and false of the other three (B7-01-A). Confidence is shown only where it is a measurement (Signal: `sample · completeness · temporal`, multiplied, capped at 0.97) (B8-01, `confidenceEngine.js`). |
| **Purpose** | Make "how do we know, how sure, as of when?" answerable for every number without a second screen. |
| **User question** | *How do we know this, how sure are we, and as of when?* |
| **Information relationship** | Qualifies EVIDENCE, VERDICT confidence and OUTCOME. The knowledge axis (C-06 tokens), the permission axis and the process axis stay independent (Constitution R-4, B7-01-B). |
| **Visual priority** | Low light, **never dropped**. Mono, adjacent to the figure it qualifies, legible at the floor size. |
| **Allowed states** | every state in STATE_RULES.md; a knowledge token the adapter does not recognise **throws** (`client/src/design-system/states/absence.js:92-97`) |
| **Must not become** | a figure without a window · confidence as a percentage where it is a constant (Guardrail 0.9, allocation 0.8) · `MIN_IMPRESSIONS` presented as a statistical bound · a single "last updated" for four clocks · a client-computed staleness, band or rate · hedged prose substituting for a number |

---

## 11. Supporting objects

Supporting objects never appear on their own authority (Constitution Article 6).

| Object | Serves | Rule |
|---|---|---|
| **Metric** | EVIDENCE, MEASUREMENT | always with window and basis; mono; an absent value is a state, not `0` or a bare `—` |
| **Chart** | EVIDENCE, OUTCOME | only with the three written answers (Constitution Article 23) |
| **Table** | EVIDENCE (claim-named rows), operational lists | never the page's reason to exist; CMP-05 |
| **Filter** | a population the surface already asserts | a filter never creates a population the backend does not publish (for example, no client "class" filters on Attention) |
| **Navigation** | the four axes + Connectors (FE-05) | plan-locked items shown locked (PR-4); not-live items hidden; Copilot is not a destination (PR-8) |
| **Container** | an Article 17 justification | never decorative, never a default |

---

## 12. Not grammar objects — boundaries

**Copilot** (🔒 PR-8). Copilot is a *contextual reasoning interface*, entered
**from** a grammar object, explaining REASON, EVIDENCE, OUTCOME or MEMORY
already on that object.

- It is never VERDICT, DECISION, ACTION or MEASUREMENT authority.
- It never writes a Decision or executes.
- It states a number **only if the number is in the evidence supplied to it**
  (PR-7). Until a response contract can mark which evidence each numeral came
  from, a Copilot surface renders **no AI-authored numerals**.
- The current "Coming soon" route is not built upon.

**Campaign** (SUBJECT lens). A history of judgments about a subject, not a
history of its metrics (B8-04). It has no browsable list ordered by a metric
(B7-08). A live-assessment block may appear in it **with no controls**.

**Connector.** It explains absence and never gates a claim (Constitution R-8).
Its destination publishes one line per capability; there is no single
"Connected ✓" verdict (B8-06).

**Plan / Allocation.** A plan artifact (`/plans/:id`), never a Decision
(Constitution R-3).

---

## 13. Vocabulary hazards

| Word | Hazard | Rule |
|---|---|---|
| **WATCH / watching** | WATCH is a verdict; "WATCHING" was a static pseudo-status (PR-11); "Always watching" is landing copy contradicting B7-01 | "watching" is never used for system liveness |
| **Execute** | means both "LUMI performs a platform mutation" and "I record that I executed it" (audit Q2) | two different verbs for two different actions; "Execute" alone never labels a human record |
| **Decisions** | spent on NOW and SUBJECT in the legacy nav (B7 F-N2) | belongs to THEN |
| **Memory** | means pattern memory, provenance, chat history and the Anthropic Memory API in different parts of the repo | in the UI, "Memory" means the ACROSS destination only; provenance is "what LUMI knew at the time" |
| **Confidence** | the same column name across four writers; only Signal measures it | shown only where it is a measurement |
| **Healthy** | `LOOP_HEALTH.HEALTHY` is published; a UI "healthy" default is not | UNKNOWN ≠ HEALTHY |
