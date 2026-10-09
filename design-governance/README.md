# design-governance/ — LUMI Design System Governance

```text
Status    CURRENT AUTHORITY for LUMI design (from Phase 1, pending Review Gate G-1 approval)
Created   2026-09-14 · Phase 1 — Design Constitution + Visual Foundation
Synced    2026-09-14 · Phase 1.5 — Governance Synchronization (GOVERNANCE_SYNC.md)
Base      a3ec116
```

This folder is where LUMI's design authority lives. It was written **from
zero** as a reset, not a refresh. The legacy frontend and its design system are
**evidence and migration infrastructure**, not a design authority.

> **Backend = truth · Constitution = product meaning · Design System = expression · Frontend = implementation**

---

## Current execution roadmap checkpoint — 2026-10-09

This checkpoint records the **current Frontend + Design System Reset**. It does
not replace the verbatim Master Build Spec, the Product Constitution, or the
historical B5/B6/B7/B8/B9 programme.

| Phase / slice | Verified state | Boundary |
|---|---|---|
| Product truth + backend contracts (B5/B6/B9), IA (B7), state/UI contracts (B8) | LOCKED | Do not reopen during the frontend reset without new contradictory evidence |
| Reset Phases 0–7 | Completed as the prerequisite to current Phase 8, per merged Phase 7 and Phase 8 work | Not a launch-readiness claim |
| Phase 8 — Landing | **ACTIVE** | PRs #552–#557 landed, including copy/evidence, signup/accessibility, responsive landing and official brand integration |
| P8-06A — LUMI Brand v1 placement | **CLOSED · PRODUCT OWNER APPROVED 2026-10-09** | Existing Header symbol and Footer stacked lockup only; PR #557 on master at `83dc912`; see [brand/README.md](brand/README.md) |
| P8-04B | **DEFERRED — DATA PROVENANCE BLOCKED** | Product Owner approved 2026-10-09; not implemented, completed or cancelled. Re-entry requires verified evidence and explicit approval; see [scoped ruling and follow-up register](PHASE_8_SCOPED_DEFERRAL.md) |
| P8-06B | **CLOSED · PRODUCT OWNER APPROVED 2026-10-09 · NO MATERIAL CHANGE REQUIRED** | Measurement-first first-load audit; no source changes. Local synthetic evidence only, not field performance certification |
| Phase 9 — Motion | **NOT STARTED** | Cannot start until Phase 8 is formally closed by the Product Owner; requires its own gate |
| Phase 8 final closure gate | **PENDING SEPARATE PRODUCT OWNER CLOSURE APPROVAL** | Independent audit completed; scoped deferral ruling approved 2026-10-09. Phase 8 remains ACTIVE; no full Master Spec, production, live OAuth or launch certification |
| Phases 10–18 | **FUTURE** | App shell, IA/UX, surface migration, cleanup, governance and QA under the Master Build Spec |
| Phases 19–23 | **FUTURE** | Production/full-loop verification, dogfood, private beta and launch |

**Execution discipline:** Codex is the execution agent for narrowly scoped slices on fresh
`origin/master`. It performs discovery first, uses RED → GREEN where applicable, runs
relevant checks, opens focused PRs for changes, and verifies merged content on trunk.
The Product Owner approves product/design rulings and phase gates. Do not promote PR
descriptions, historic roadmaps, test counts or design previews over repository truth.
**Numeric truth:** Real performance numbers must trace to authorized data and real
source/database evidence. Under locked PR-7, clearly labelled illustrative examples
are permitted as illustrations, never as real customer or product results. AI may
state a performance number only if it exists in supplied evidence.

---

### Phase 8 scoped deferral ruling — 2026-10-09

**Approved by Omar, Product Owner.** [The exact ruling and tracked follow-up
register](PHASE_8_SCOPED_DEFERRAL.md) formally defer P8-04B with its data-provenance
blocker retained. Actual application previews, three substantial real-UI visuals,
pricing and meaningful marketing event tracking remain outstanding, not delivered,
waived or silently removed. Their timing requires separate approved planning and
scope decisions; no milestone is assigned here. Unsupplied brand variants remain
SOURCE PENDING and do not invalidate the approved Header/Footer placement.

Phase 8 may proceed to its formal closure decision against approved scoped
acceptance criteria. **Phase 8 remains ACTIVE pending separate final Product Owner
approval; Phase 9 remains NOT STARTED.** This is not full Master Spec completion,
production performance, live OAuth or public launch-readiness certification.

### P8-06B close-out evidence and limitations — 2026-10-09

- **Product Owner decision:** Approved `NO MATERIAL CHANGE REQUIRED` on 2026-10-09 for the narrowly scoped Landing First-Load Hygiene slice. This is an authorized no-change close-out, not approval of any broader auth/bootstrap change.
- **Baseline audited:** master `83dc91282b694b8289f3169af079d2717ec1075a` (before governance-only PR #558), production build on local Chromium. Five cold runs per profile, with documented synthetic mobile throttling.
- **Observed:** 12 initial requests; browser-reported transfer 327,327 B; desktop median FCP 156 ms; simulated mobile median FCP 2,084 ms. Five-font preload regressed mobile median FCP to 2,388 ms. Single-font hint showed no material gain.
- **Safety:** no protected-view/Zod/private-API loading observed. Deferring Firebase/shared provider/bootstrap or globally splitting shared CSS was not proven safe within this slice.
- **Verification reported by Codex:** 13 focused files / 348 tests passed; production build, brand/browser, reflow and logged-out route tests passed. Full frontend suite, fresh lint and architecture checks not rerun because no production code changed. Real OAuth and live authenticated sessions not exercised.
- **Measurement boundary:** local synthetic evidence, **not** production traffic, field Core Web Vitals, or production performance certification. Raw evidence reported at the executor-local `C:/Users/user/.codex/audits/p8-06b/`, not attached to this repository; treat accessibility of that path as environment-dependent.
- **Repository changes for P8-06B:** none. This governance record does not change landing code, brand assets, auth, routes or Master Build Spec. **Historical close-out status:** Phase 8 ACTIVE; P8-04B BLOCKED; Phase 9 NOT STARTED. The later scoped deferral ruling above records the current P8-04B disposition without rewriting that audit.

---

## 1. Documents

| Document | Answers | Start here if you are… |
|---|---|---|
| [PHASE_8_SCOPED_DEFERRAL.md](PHASE_8_SCOPED_DEFERRAL.md) | Approved 2026-10-09 scoped deferral, independent audit evidence, outstanding-work register and separate Phase 8 closure gate | reviewing Phase 8 closure or planning re-entry |
| [LUMI_DESIGN_CONSTITUTION.md](LUMI_DESIGN_CONSTITUTION.md) | What LUMI is, how it looks, and the laws every design obeys. Includes the foundation-conflict register (Appendix A) | anyone — **read first** |
| [PRODUCT_GRAMMAR.md](PRODUCT_GRAMMAR.md) | The nine objects the interface is made of, and what each must never become | designing or building any screen |
| [VISUAL_BOUNDARIES.md](VISUAL_BOUNDARIES.md) | Approved and forbidden visual territory, with recognisable signals; logo direction | reviewing an artefact |
| [COMPONENT_RULES.md](COMPONENT_RULES.md) | When a primitive, component, card, table, chart, badge, gold or verdict colour is justified | creating a component |
| [STATE_RULES.md](STATE_RULES.md) | 15 states, each with meaning, **published trigger**, allowed and forbidden expression | anything that loads, fails or can be absent |
| [MOTION_RULES.md](MOTION_RULES.md) | Why things move, how, and what never moves | adding any animation |
| [ANTI_CONVERGENCE.md](ANTI_CONVERGENCE.md) | Six tests that stop LUMI looking like every other AI or SaaS product | reviewing any new component or surface |
| [REFERENCE_POLICY.md](REFERENCE_POLICY.md) | How external references may and may not be used | bringing in inspiration |
| [REVIEW_GATE.md](REVIEW_GATE.md) | The mandatory gates between phases, and the Phase 1 run | moving work between phases |
| [../DESIGN_TOKEN_ARCHITECTURE.md](../DESIGN_TOKEN_ARCHITECTURE.md) | The implemented token architecture (Phase 2): layers, namespaces, environments, contrast manifest, legacy status. Current token implementation authority: `client/design-system/foundation/` | working with tokens |
| [LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md](LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md) | **Authority level 3.** The governing implementation brief for the whole rebuild, stored verbatim (§2.1) | planning any rebuild phase |
| [brand/README.md](brand/README.md) | **Authority level 4.** LUMI Brand v1: two owner-approved Illustrator SVG exports (2026-10-08); optional variants remain source pending | brand implementation |

**Preserved evidence** (repository root, not modified by Phase 1):

- `DESIGN_SYSTEM_AUDIT.md` — Phase 0 audit
- `LUMI_PRODUCT_TRUTH_RULINGS.md` — Phase 0.5 ruling pack

---

## 2. Authority hierarchy

*Synchronized in Phase 1.5. This order replaces the seven-level list written in
Phase 1.*

```text
1. PRODUCT TRUTH          Backend / API behaviour and DB-backed product behaviour
                          · LUMI_PRODUCT_TRUTH_RULINGS.md, closed as PR-1…PR-13 (§3)
                          · locked Product Constitution (B6-02 R-1…R-8) and B7 / B8 rulings
2. DESIGN AUTHORITY       design-governance/ — Constitution, Product Grammar, Visual Boundaries,
                          Reference Policy, Component Rules, State Rules, Motion Rules,
                          Anti-Convergence, Review Gate, this README · DESIGN_TOKEN_ARCHITECTURE.md
3. MASTER BUILD SPEC      design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md
4. APPROVED BRAND ASSETS  design-governance/brand/  (LUMI Brand v1: primary stacked lockup + symbol)
5. HISTORICAL MATERIAL    §4, plus the legacy frontend implementation. Evidence, never authority.
                          DESIGN_SYSTEM_AUDIT.md (Phase 0) is preserved evidence at this level.
```

**Derivation** — how authority flows into work:

```text
MASTER BUILD SPEC
      ↓
DESIGN CONSTITUTION · PRODUCT GRAMMAR · VISUAL BOUNDARIES · STATE · MOTION · COMPONENT RULES
      ↓
IMPLEMENTATION
```

**Conflict resolution** — when sources disagree:

```text
PRODUCT TRUTH  >  DESIGN CONSTITUTION  >  MASTER BUILD SPEC interpretation  >  LEGACY MATERIAL
```

- The spec is the brief; the governance documents are its binding interpretation.
  Where a governance document and the spec disagree, the governance document
  governs **and the disagreement is registered** in the Constitution's Appendix A.
  Nothing is reconciled silently.
- There is **one** design constitution. The spec's own "Phase 1: LUMI Design
  Constitution" section (§9) is satisfied by `LUMI_DESIGN_CONSTITUTION.md`, not by a
  second document.
- A lower source never overrides a higher one.

### 2.1 Master Build Spec — provenance

| Field | Value |
|---|---|
| Registered path | `design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md` |
| Source | `LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC_FINAL_V2_UPDATED(1).md`, supplied by Omar (local Downloads, modified 2026-09-13 17:17) |
| Integrity | copied byte-for-byte; SHA-256 `915B3C238891590B0AB073723DDCA8A22FDAA069371A5387FBFC7E7D7D47180C`, 54,052 bytes, 2,506 lines (working-tree copy) |
| Why this version | Two earlier files exist: `…_MASTER_BUILD_SPEC.md` (2026-09-09) and `…_FINAL_V2.md` (2026-09-10). Only this one carries the "LATEST UPDATE — BRAND IDENTITY LOCK (SEPTEMBER 2026)", the brand palette, "01 / Current Base" and the Figma-to-code rule — every passage the Phase 1 brief quoted from the Master Spec, and the "September 2026" spec PR-13 names. Its differences from V2 are rewrites inside §5 and §10. 🔒 **Approved as authoritative by Omar, 2026-09-14.** The 09-09 and 09-10 versions are not authority. |
| Edits | **none.** The file is not annotated. Interpretation lives in the governance documents, never inside the source. |
- **Figma is the visual source of truth. The repository is the behavioural
  source of truth**: behaviour, state, routing, permissions, API, measurement,
  currency and data integrity.
  **P8-06A exception (Product Owner, 2026-10-08):** the two exact Illustrator
  SVG exports registered in `brand/README.md` are authoritative for current
  LUMI Brand v1; neither Figma nor the original `.ai` is required for their use.
  Their approved internal gradient does not authorize decorative UI gradients.
- These documents **encode** levels 1–3 for design use. Where they quote a
  ruling or code, the source is cited so it can be checked.

---

## 3. Product Owner Rulings — Phase 0.5 closure (🔒 LOCKED, Omar, 2026-09-14)

Omar numbered these R-1…R-13. They are renamed **PR-n** here because those
numbers collide with the B6-02 Constitution's R-1…R-8 (⚠️ FC-1). The content is
unchanged.

| ID | Ruling | Core |
|---|---|---|
| **PR-1** | Assessment vs stored Decision | Separate objects. Assessment = NOW, recomputed, Signal only. Decision = THEN, owns action, execution and outcome, never rewritten. Disagreement must be shown. `decisionAgreement` enters the canonical view model. |
| **PR-2** | Action target / mutation identity | An action identifies its Decision by `decisionId`; never "newest decision" at mutation time. With no Decision, it must be explicitly an ENTITY ACTION. Execute = a supported, deterministic platform action attached to that Decision; today KILL → Meta → Pause Campaign. |
| **PR-3** | State ownership | API → contract state → view model → UI expression. The backend owns truth; the frontend owns expression and never derives state from data shape. FAILED ≠ EMPTY, NOT_CONNECTED ≠ FAILED, EMPTY ≠ ZERO, UNKNOWN ≠ HEALTHY. |
| **PR-4** | Plan-locked navigation | EXISTS + PLAN-LOCKED → show locked. NOT LIVE / DEPRECATED → hide. |
| **PR-5** | Six verdicts | KILL · HOLD · SCALE · WATCH · REFRESH · REALLOCATE are all distinct semantic verdicts. Verdict ≠ Action. |
| **PR-6** | Verdict colours | KILL `#C74646` · HOLD `#D97732` · SCALE `#3D9B6D` · WATCH `#3B82F6` · REFRESH `#B7791F` · REALLOCATE `#D4A017`. Gold is not the generic verdict colour. Brand gold `#D4A017`. |
| **PR-7** | Numbers on landing pages and in AI | No fabricated numbers. Illustrative data only if explicitly labelled. AI states a number only if it exists in the supplied evidence. |
| **PR-8** | Copilot | Not a primary surface. A contextual reasoning interface, not verdict engine, decision writer, numeric truth or execution authority. The "Coming soon" route is not built upon. |
| **PR-9** | Theme | Dark-first product (Charcoal); light-first marketing with controlled Charcoal sections; no theme switch in V1. |
| **PR-10** | Context Bar | No static pseudo-system-status ("Context: Locked", "Dual-Agent Ready", fabricated SID). |
| **PR-11** | WATCHING | Not a static badge. Shown only when backed by an actual monitoring condition. |
| **PR-12** | Currency formatting | One canonical money contract; minor vs major explicit; currency from data; no silent USD. |
| **PR-13** | Governance | The Master Build Spec + locked Product Constitution supersede conflicting historical frontend and design documents. Superseding does not delete evidence: old documents become HISTORICAL. |

---

## 4. Historical documents (PR-13)

Their status is declared **here** and they are **not edited or deleted**,
because they remain evidence. Where they conflict with this folder, this folder
governs.

| Document | Former role | Status |
|---|---|---|
| `client/design-system/TAXONOMY-FREEZE.md` | blocked new primitives below 80% adoption | HISTORICAL |
| `client/design-system/ui-registry.md` | component registry | HISTORICAL — superseded by the Phase 3 registry (COMPONENT_RULES.md CMP-10) |
| `client/design-system/component-states.md` | state guidance | HISTORICAL — superseded by STATE_RULES.md |
| `client/design-system/PRIMITIVE-INVENTORY.md` | primitive census | HISTORICAL |
| `client/design-system/ADOPTION-COVERAGE.md` | adoption metrics | HISTORICAL |
| `client/design-system/CVA-API-CONTRACT.md`, `CVA-USAGE-EXAMPLES.md` | CVA primitive API (0 live consumers, audit §5) | HISTORICAL |
| `client/design-system/SEMANTIC-DUPLICATE-ANALYSIS.md` | duplicate analysis | HISTORICAL |
| `client/src/components/primitives/PRIMITIVE-FREEZE.md` | froze primitive creation | HISTORICAL |
| `client/src/components/ASSEMBLY-ARCHITECTURE.md`, `ASSEMBLY-CANDIDATES.md` | assembly layer rules | HISTORICAL |
| `client/src/primitives/README.md`, `client/src/layouts/README.md` | unreachable layers (audit §29) | HISTORICAL |
| `FEED_PAGE_REDESIGN_V4.2.md` (repository root) | earlier redesign | HISTORICAL |
| `client/DESIGN-SYSTEM-REFACTOR.md` | May 2026 styling refactor ("JSON = Source of truth") | HISTORICAL *(added Phase 1.5)* |
| `client/MIGRATION-MAP.md` | legacy → semantic class migration ("Active governance") | HISTORICAL *(added Phase 1.5)* |
| `client/TYPOGRAPHY-QUICK-REF.md` | "Design System v2.0" legacy typography role classes | HISTORICAL *(added Phase 1.5)*; the classes still exist in the legacy implementation |
| `MARCOM-ARCHITECTURE.md` §3C "Styling" and §13 "Component Registry" | named legacy tokens and `ui-registry.md` as canonical / source of truth | HISTORICAL for those two sections only; the rest of the architecture document is unaffected *(added Phase 1.5)* |
| `design-system-figma/` | May 2026 Claude Design handoff bundle, addressed to coding agents; includes copies of legacy token files. **Not** the Figma brand file of Master Build Spec §45 | HISTORICAL *(added Phase 1.5)* |
| `client/design-system/tokens/*.json` **values** | formerly self-described as "Design Token Source of Truth" | LEGACY INPUTS — **not** the token source of truth. The current token implementation authority is `client/design-system/foundation/` (Phase 2). The existing UI still renders with these values during migration, so the files are not deleted and no value is changed. Since Phase 2 their own headers read "LEGACY" (comments only). Disposition of every entry: `client/design-system/foundation/LEGACY_TOKEN_MIGRATION.md`; migration is not complete. *(updated Phase 2 closure)* |
| "MARCOM-DESIGN-BIBLE.md" | cited in the past; has never existed in the repository | n/a |

**Still binding, not superseded:**

- the `CLAUDE.md` file-size budgets — they are project instructions, not a
  historical design document;
- the enforcement mechanisms `design-system/lint/no-generic-tailwind.js` and
  `client/scripts/checkTokenResolution.js`. They still check the legacy class names
  and are re-pointed when the first surface consumes the new tokens; Phase 3
  decides how primitives consume the token system (DESIGN_TOKEN_ARCHITECTURE.md §13).
  The Phase 2 token resolver, build and tests are implemented alongside them;
- the locked state adapters `client/src/design-system/states/{absence,confidence}.js`.

✅ **FC-9 closed in Phase 1.5.** `CLAUDE.md` now points at `design-governance/`
and states the authority order. Historical documents that claimed to be active
authority carry a one-line HISTORICAL notice; their content is unchanged.

---

## 5. ID namespaces

| Prefix | Namespace |
|---|---|
| `Constitution R-n` | B6-02 Product Constitution (locked) |
| `PR-n` | Phase 0.5 Product Rulings (§3) |
| `B7 Ruling n`, `R-A…R-F`, `R-N1…R-N4` | IA rulings |
| `B8-0n` | state / UI rulings |
| `C-nn` | contract programme |
| `P0-nn`, `Q-n`, audit "risk R-n" | `DESIGN_SYSTEM_AUDIT.md` |
| `FC-n` | Phase 1 foundation conflicts (Constitution Appendix A) |
| `VB-A/F`, `CMP-`, `MO-`, `AC-`, `RP-`, `RG-`, `Q-` (gate) | rules in this folder |

---

## 6. Changing anything in this folder

1. A change needs **evidence** and a **ruling**, never preference alone.
2. It records the rule replaced, the evidence, the approver and the date.
3. Product truth (levels 1–2) is not reopened during design phases unless new
   evidence shows a ruling cannot be implemented without breaking backend or
   product truth. Inconvenience is not that evidence.
4. Every change passes the relevant gate in REVIEW_GATE.md.

## 7. Where each phase stopped

- **Phase 1 and Phase 1.5:** no token file, CSS, component, screen, route, API,
  schema or backend file was created or modified.
- No legacy file was deleted.
- **Phase 1.5** registered the Master Build Spec (§2.1) and the brand-asset
  location (`brand/`), updated `CLAUDE.md`, and marked conflicting legacy
  documents HISTORICAL. See `../GOVERNANCE_SYNC.md`.
- **Phase 2 — Design Tokens is implemented** (2026-09-14): the token authority
  `client/design-system/foundation/`, `DESIGN_TOKEN_ARCHITECTURE.md` and
  `../PHASE_2_TOKEN_AUDIT.md`. Legacy token migration is **not** complete.
- **Next:** Phase 3 — Primitives, when Omar opens it (gate G-2).
