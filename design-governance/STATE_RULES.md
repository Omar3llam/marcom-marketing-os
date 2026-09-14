# LUMI STATE RULES

```text
Status   FOUNDATION — part of LUMI_DESIGN_CONSTITUTION.md (Article 27); awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
Bound by 🔒 PR-3 · Constitution R-4 · B8-01 · B8-02 · C-06 · C-07
```

## 0. The law

> **A state is published by the backend, or it does not exist.**
> The design system decides how a state *looks and reads*. It never decides
> *which* state is true.

```text
failed   → never silently empty
missing  → never silently zero
unknown  → never silently healthy
```

### 0.1 Architecture (PR-3)

```text
API  →  DATA / CONTRACT STATE  →  VIEW MODEL  →  UI STATE EXPRESSION
        (backend owns truth)       (carries it,     (design system owns
                                    never invents)   expression only)
```

### 0.2 The three independent axes (Constitution R-4, B7-01-B)

| Axis | Question | Source | Examples |
|---|---|---|---|
| **Knowledge** | What do we know about this claim? | C-06 `KNOWLEDGE` tokens: `KNOWN · COULD_NOT_LOOK · NOT_ENOUGH · NOTHING_THERE · CANNOT_ASK` (`packages/runtime-contracts/src/epistemicStatus.js`) | AVAILABLE, EMPTY, NOT_MEASURED |
| **Permission** | May this seat or plan ask? | entitlement reasons: `NOT_ENTITLED · PLAN_REQUIRED · ROLE_REQUIRED · SCORING_HIDDEN` (`client/src/design-system/states/absence.js:60-62`); HTTP 403; `PlanGate` | NOT_PERMITTED |
| **Process** | What is the system doing right now? | published lifecycles: `ExecutionStatus` (`packages/runtime-contracts/src/executionStatus.js`); the client's own request lifecycle | LOADING, PROCESSING, SUCCESS |

A surface **never collapses two axes into one state**. A CLIENT seat on a
fully scored account is `KNOWN + NOT_PERMITTED`. Showing only one of the two
forces a choice between two lies (Constitution R-4).

### 0.3 The adapter (B8-02, locked)

- **Token for shape, reason for copy.** The C-06 token decides which state and
  whether a retry is honest. The domain reason decides the words.
- The locked adapter `absenceState()` maps tokens to six presentation values:
  `PRESENT · NOT_REACHABLE · NOT_MEASURED · NOTHING_FOUND · NOT_SUPPORTED · NOT_PERMITTED`.
- **An unrecognised token throws** (`absence.js:92-97`). There is no safe default
  for an unknown epistemic position.
- The new state primitives **consume** this adapter. They never copy it.

### 0.4 Banned everywhere

- `loading === false && data.length === 0`, and any state derived from array
  length, `null`, `undefined` or response shape (Constitution R-4).
- `?? []`, `?? 0`, `|| 0`, `?? 'USD'`, or a default tone at a presentation
  boundary (B8-02 §3).
- Stale rows displayed under a failure banner as if current. Collections empty
  **beside** the error, never instead of it (B8-02).
- A single generic "empty" component used for more than one of the states below.

### 0.5 Trigger availability

Every state below carries one of these labels:

| Label | Meaning |
|---|---|
| **PUBLISHED** | the backend or runtime contract publishes the trigger today |
| **CLIENT-OWNED** | a fact only the client can observe (its own request lifecycle); allowed because it is not a claim about the account |
| **PARTIAL** | published for some scopes but not others; the rule states which scopes may render it |

---

## 1. LOADING

| Field | Rule |
|---|---|
| **Meaning** | The client has asked and not yet received an answer. This is a statement about the request, **never** about the account. |
| **Trigger** | CLIENT-OWNED: a request is in flight. A cancellation is **neither** a failure **nor** an absence (B8-02). |
| **Allowed UI expression** | The surface's **structure** is present (headings, labels, the spine), with values unlit. A quiet, non-looping indicator only when the wait is perceptible (the threshold is a Phase 2 motion token). An accessible busy state (`aria-busy`). Previously confirmed content may stay visible **only** while it is still the answer to the same request, for example during pagination. |
| **Forbidden UI expression** | EMPTY copy while loading (audit P0-05: "No campaign data yet" during load) · zeros or dashes as placeholder values · shimmer or pulsing skeletons (continuous animation, MOTION_RULES.md) · a skeleton shaped like invented content · "LUMI is analysing / thinking…" narrative (no published process says that) · a full-page takeover when only one region is loading |

## 2. AVAILABLE

| Field | Rule |
|---|---|
| **Meaning** | We looked, and the claim can be made. |
| **Trigger** | PUBLISHED: `KNOWLEDGE.KNOWN` → `ABSENCE.PRESENT`, or a successful, contract-valid read whose contract declares the value complete. |
| **Allowed UI expression** | The value, lit according to the illumination hierarchy, with its window, basis and clock (MEASUREMENT). Partial knowledge that the backend publishes as KNOWN with a qualifier (for example `COMPLETENESS_STATE.INCOMPLETE`) renders the value **and** the qualifier together. |
| **Forbidden UI expression** | A figure without its window · confidence shown where it is a constant · rounding or reformatting that changes meaning (currency without its code; minor units shown as major) |

## 3. EMPTY

| Field | Rule |
|---|---|
| **Meaning** | We looked, and there is nothing. **A finding, an answer, not an absence** (B8-02: `NOTHING_FOUND`). |
| **Trigger** | PUBLISHED: `KNOWLEDGE.NOTHING_THERE` → `ABSENCE.NOTHING_FOUND` (for example `READINESS_STATE.NEVER_SYNCED` for a connector), **or** a successful, contract-valid read whose contract **declares** that an empty collection means "nothing exists in this population". Where a contract does not declare that, the gap is registered as a contract finding. It is never decided in the UI. |
| **Allowed UI expression** | A declarative sentence naming **what** was looked at and that nothing is there ("No open decisions on this account."). An action only when the domain reason names a remedy the operator can take. "Nothing new" is a result (B8-01 L-9). |
| **Forbidden UI expression** | Rendering EMPTY after a failure · deriving it from `[]` alone · a zero in place of "none" · a cheerful illustration or mascot · a generic CTA that assumes a cause ("Connect a channel") without a published reason · "You're all caught up" (no acknowledgement fact exists, B7-03) |

## 4. FAILED

| Field | Rule |
|---|---|
| **Meaning** | Our read or mutation did not complete. We do not know the answer. |
| **Trigger** | CLIENT-OWNED + PUBLISHED: a transport error, a non-2xx response, or a contract **parse failure** (B8-01: a response that fails its schema is a failure, not data). Knowledge `COULD_NOT_LOOK` → `ABSENCE.NOT_REACHABLE`. For mutations, a failed request, or `ExecutionStatus.EXECUTED_FAILED`, `TIMED_OUT` or `CANCELLED`. |
| **Allowed UI expression** | Names **which claim** could not be read. The minimum copy is "Something went wrong" plus the scope. A retry control, because a retry is honest here (`absence.js:35`). Regions that did load remain valid and are not blanked. A failure that governs content is shown in place, not only as a toast. |
| **Forbidden UI expression** | EMPTY copy (audit P0-03: sidebar "No decisions yet" on a failed read) · a connect or onboarding instruction (audit P0-04) · zero · hiding the region · previous data presented as current · a toast as the only trace of a failed read · technical stack traces or raw error codes as the main copy |

## 5. UNAVAILABLE

| Field | Rule |
|---|---|
| **Meaning** | The backend answered, and says this claim cannot currently be provided. Distinct from FAILED: the system was reached and **reported**. |
| **Trigger** | PUBLISHED: a 200 carrying an unavailability status. Examples: OutcomeEvidence `UNAVAILABLE`; `AVAILABILITY_STATE.NOT_RECORDED` → `COULD_NOT_LOOK`; attribution `EVIDENCE_STATUS.UNAVAILABLE`; `AccountAggregateService` `unavailable` reasons (§14 and §15 cover the two with their own names). |
| **Allowed UI expression** | The reason's copy, in place of the value, with the structure kept. A retry only when the reason implies time or a transient dependency. |
| **Forbidden UI expression** | Treating it as EMPTY · treating it as FAILED, which blames the network · treating it as NOT_MEASURABLE (the exemplar keeps them apart: `UNAVAILABLE ≠ NOT_MEASURABLE`) · zero |

## 6. NOT_CONNECTED

| Field | Rule |
|---|---|
| **Meaning** | A connector required for this claim is not connected. |
| **Trigger** | **PARTIAL (⚠️ FC-7).** **Published per connector:** `READINESS_STATE.NEVER_SYNCED` (`NOTHING_THERE`) and the C-04 readiness projection. **Not published at account level:** `GET /lumi/connections` returns `{ workspaceId: null, connections: [] }` when the workspace cannot be resolved, which is the same payload as "nothing connected" (`src/routes/lumi/connections.js:38`; C-04A OPEN). |
| **Allowed UI expression** | Per capability, not per source: one line stating what LUMI cannot say without the connector (B8-06). Where the absence is met, only its **consequence** appears, and the action appears only for CONNECTOR or PERMISSION remedies (B8-06). Account-level "connect a channel" **only** from a trigger that distinguishes it from an unresolved workspace, which does not exist until C-04A lands. |
| **Forbidden UI expression** | Rendering from `connections: []` · rendering on a failed connections read (audit P0-04) · a single "Connected ✓" or "Not connected" verdict for a source (B8-06) · treating as FAILED · blocking a claim because a connector is absent, since connectors **explain** absence and never gate a claim (Constitution R-8) |

## 7. NOT_PERMITTED

| Field | Rule |
|---|---|
| **Meaning** | The claim exists or may exist, and this seat or plan is not entitled to ask. The operator **can** change this one. |
| **Trigger** | PUBLISHED: `KNOWLEDGE.CANNOT_ASK` with an entitlement reason → `ABSENCE.NOT_PERMITTED`; HTTP 403 from `requirePlan` or a role gate; `PlanGate`. |
| **Allowed UI expression** | Plan lock (🔒 PR-4): the capability is **shown, locked**, naming the plan that unlocks it, reached through the existing `UpgradePrompt`. Role lock: names that a role is required. Current role-gating behaviour is unchanged because PR-4 does not rule it. The knowledge axis stays visible where the backend publishes it (`KNOWN + NOT_PERMITTED`). |
| **Forbidden UI expression** | Hiding an existing plan-locked capability (the legacy `Sidebar.jsx:248-256` hide filter) · a teaser containing fake or blurred data · a gold glow upsell · collapsing it into NOT_SUPPORTED, which tells the operator nothing can be done · collapsing it into EMPTY |

## 8. NOT_SUPPORTED *(added — ⚠️ FC-6)*

| Field | Rule |
|---|---|
| **Meaning** | The question does not apply here. Nothing the operator does will change it. |
| **Trigger** | PUBLISHED: `KNOWLEDGE.CANNOT_ASK` without an entitlement reason → `ABSENCE.NOT_SUPPORTED` (`absence.js:42,91`). Examples: `NOT_EXECUTABLE.UNSUPPORTED_CHANNEL`; OutcomeEvidence `UNSUPPORTED`. |
| **Allowed UI expression** | Two cases. **Not produced by this class:** the section does not render at all (a Guardrail has no hypotheses, B7-04 R-E). **Not supported for this entity or channel where a person would expect it:** a short statement of why, with no action. |
| **Forbidden UI expression** | An upgrade or connect prompt · an empty heading · treating as NOT_PERMITTED |

## 9. STALE

| Field | Rule |
|---|---|
| **Meaning** | The value was measured correctly, and the period it describes has aged past a **declared** threshold. It is knowledge with a temporal qualifier, not ignorance. |
| **Trigger** | PUBLISHED: `READINESS_STATE.STALE` (connector; `CONNECTOR_STALE_HOURS`), which maps to `KNOWN` · gating reason `CANONICAL_EVIDENCE_STALE` (no verdict is issued) · `STAGE_STATE.STALE` (agentic loop stage). |
| **Allowed UI expression** | The value **with** its age and window stated, at the same prominence as the value. For `CANONICAL_EVIDENCE_STALE`, no verdict renders; the reason does. Each of the four clocks (evidence, assessment, decision, learning) carries its own time (B7-01-A). |
| **Forbidden UI expression** | A client-computed staleness from timestamps with an invented threshold · a single "last updated" for four clocks · hiding the age · fading the value until it looks absent · rendering a stale verdict as current |

## 10. PROCESSING

| Field | Rule |
|---|---|
| **Meaning** | A published lifecycle is in flight. This is the process axis, not knowledge. |
| **Trigger** | PUBLISHED: `IN_FLIGHT_STATUSES` = `PENDING · QUEUED · EXECUTING · 'RETRYING'` (`packages/runtime-contracts/src/executionStatus.js:44-49`). `RETRYING` is listed there as a literal that `ExecutionStatus` does not declare; the design system renders it only if it arrives. **Not published:** assessment computation (`COMPUTING`, B7-01-B). |
| **Allowed UI expression** | The named stage of the platform action ("Queued on Meta", "Executing"), attached to the Decision it belongs to. A live-region announcement on transition. The terminal states are SUCCESS or FAILED, and an indicator never runs forever, because `TIMED_OUT` exists. |
| **Forbidden UI expression** | Optimistic "done" before a terminal status · SUCCESS on acceptance (202 / `QUEUED`) · "LUMI is computing / thinking / watching" for the assessment sweep, which is not published (B7-01: LUMI does not pretend it was watching) · a spinner detached from its Decision |

## 11. SUCCESS

| Field | Rule |
|---|---|
| **Meaning** | A requested change reached a terminal success that the backend confirmed. |
| **Trigger** | PUBLISHED: `ExecutionStatus.EXECUTED_SUCCESS` (platform mutation); a 2xx mutation response that returns the persisted record (human record: stamp, dismissal, judgment). |
| **Allowed UI expression** | The **changed state itself**, visible on the object (Decision status, execution record), with a short confirmation that names what changed and where. A platform success ("Paused on Meta") and a human record ("Recorded: you paused this") use different verbs (Constitution Article 29). Announced through a live region. |
| **Forbidden UI expression** | A success toast with no visible state change · celebration (confetti, checkmark bursts, gold flashes) · SUCCESS on queue acceptance · implying OUTCOME ("performance improved") from an execution success |

## 12. NOT_MEASURED

| Field | Rule |
|---|---|
| **Meaning** | We established what there is, and this value was not measured (not reported, or cannot be measured over this window). |
| **Trigger** | PUBLISHED: `KNOWLEDGE.NOT_ENOUGH` → `ABSENCE.NOT_MEASURED` · `AccountAggregateService` `UNAVAILABLE.NOT_MEASURED` ("No contributing row reported the field at all. Distinct from a measured 0.", `src/services/analysis/AccountAggregateService.js:70-71`) · pacing and allocation `NOT_MEASURABLE` (#474) · OutcomeEvidence `NOT_MEASURABLE`. |
| **Allowed UI expression** | Example: "This metric cannot currently be measured." with its reason, in the value's slot, as structure without light. A dash as a value is allowed **only** with the reason stated at the same claim level. |
| **Forbidden UI expression** | `0` (a zero is a measurement; `AccountAggregateService` header) · a bare `—` with no reason · treating as INSUFFICIENT_DATA or NO_CONVERSIONS when a more specific reason exists |

## 13. INSUFFICIENT_DATA

| Field | Rule |
|---|---|
| **Meaning** | Data exists, and it does not meet the bar required to make this claim. |
| **Trigger** | PUBLISHED: `KNOWLEDGE.NOT_ENOUGH` with a sufficiency reason · OutcomeEvidence `INSUFFICIENT_COVERAGE` · C-07 gating `NO_MEASURABLE_DELIVERY` ("we measured it over the verdict window, and it delivered nothing to judge"). |
| **Allowed UI expression** | What is missing to make the claim, where the backend names it. Confidence dimensions with their weak dimension (C-09). |
| **Forbidden UI expression** | Presenting a product threshold as a statistical bound (`MIN_IMPRESSIONS = 1000` is `CALIBRATION: UNKNOWN`) · showing a gated call as a low-confidence verdict · the word "insufficient" for a failure · a percentage progress bar toward a threshold the backend does not publish |

## 14. NO_CONVERSIONS

| Field | Rule |
|---|---|
| **Meaning** | Spend is known; conversions are not (or are zero), so a ratio such as CPA has no denominator. |
| **Trigger** | PUBLISHED: `AccountAggregateService` `UNAVAILABLE.NO_CONVERSIONS` (`:75-78`) · `EconomicsService` reason `NO_CONVERSIONS` ("no realized CAC to assess against"). |
| **Allowed UI expression** | Spend renders; the ratio does not, and the reason stands in its place. The remedy points at conversion tracking, **not** at a sync, because the backend separates the two for that exact reason ("one waits for a sync, the other waits for conversion tracking"). |
| **Forbidden UI expression** | CPA shown as `0`, `∞`, `—` without the reason, or computed client-side · merging with NOT_MEASURED |

## 15. MIXED_CURRENCY

| Field | Rule |
|---|---|
| **Meaning** | The contributing rows are in more than one currency, and nothing in the system converts between them. A sum would be a number in no currency. |
| **Trigger** | PUBLISHED: `AccountAggregateService` `UNAVAILABLE.MIXED_CURRENCY` (`:72-74`): value `null` for currency-bearing figures; currency-free counts survive intact. |
| **Allowed UI expression** | The refusal stated plainly. Counts that survive render normally. Per-currency figures only where the backend publishes them separately. |
| **Forbidden UI expression** | Summing · client-side conversion · "first non-USD currency wins" (the legacy `CampaignsView` behaviour this reason replaced) · a silent `USD` default (🔒 PR-12) · plotting currencies on one axis |

---

## 16. UNKNOWN ≠ HEALTHY

"Healthy", "OK", green, and the absence of a warning are **claims**. Each one
renders only from a published value, for example `LOOP_HEALTH.HEALTHY`
(`src/services/agentic-loop/agenticTypes.js:53-57`). With no published value,
health is not shown. The UI may not choose a default tone (B8-02 §3), and it
may not treat an unmeasured dimension as good (C-09: `below(null) === false`
once rendered UNKNOWN as GOOD).

## 17. Composition rules

1. **States are per claim, not per page.** One region may be FAILED while its
   neighbour is AVAILABLE. A page-level state is used only when the whole page
   depends on a single read.
2. **Axes compose, not override.** A NOT_PERMITTED claim that the backend also
   publishes as STALE keeps both facts available. How emphasis is ordered when
   axes coincide is a Phase 3 primitive decision, and must preserve every
   published fact.
3. **Domain vocabularies are narrowed, never flattened.** OutcomeEvidence's
   seven statuses keep seven expressions, even though several share a C-06
   token. The token picks the shape and the reason picks the copy.
4. **Instructions are stricter than descriptions.** An instruction ("connect",
   "upgrade", "retry") renders only when the reason names that remedy. A wrong
   instruction is the C-07 defect (B8-02: "The interrupt is an INSTRUCTION, not
   a description").
5. **Every state primitive is tested on the reaching path**, not only in
   isolation: written → published → parsed → **rendered** (contract close-out
   gate).

## 18. DISABLED and PARTIAL (🔒 FC-15, Omar 2026-09-14 — non-blocking)

Both are **valid semantic states**. Phase 2 defines their **token roles** only.
Their exact expression per component is decided in the relevant component or
state phase. Nothing here invents that behaviour.

| State | Trigger rule (already binding) |
|---|---|
| **PARTIAL** | Renders only from a **published** qualifier that the data is incomplete, for example `COMPLETENESS_STATE.INCOMPLETE` or aggregate bounds `NON_UNIFORM`. Never inferred from a short list or missing fields. |
| **DISABLED** | An interaction state. It carries a reason from a **published** refusal or permission (for example a `NOT_EXECUTABLE` reason, a role or plan gate, or a 409 no-longer-open). Never derived from data shape, and never shown without its reason. |
