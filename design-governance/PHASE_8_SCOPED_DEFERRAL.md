# Phase 8 Scoped Deferral Ruling and Follow-up Register

**Approval date:** 2026-10-09  
**Authority:** Omar, Product Owner  
**Status:** APPROVED scoped deferral ruling; separate Phase 8 final closure approval pending  
**Verified baseline:** `e160ce9acad4aa5934b4cdc90c18b5da5ac9da25`

## Approved Product Owner ruling

1. **P8-04B:** Formally **DEFERRED — DATA PROVENANCE BLOCKED**. It is not implemented, completed or cancelled.
2. **Re-entry requirements:** Verified authorized DB evidence, currency and UTC spend-window lineage, budget provenance, reproducible Allocation output, privacy-safe public-use package and explicit Product Owner approval.
3. **Outstanding Master Spec requirements:** Actual application previews, three substantial real-UI visuals, pricing and meaningful marketing event tracking remain outstanding. They are not delivered, waived or silently removed. Their implementation timing requires separate approved planning and scope decisions.
4. **Brand assets:** Unsupplied variants remain **SOURCE PENDING**. They do not invalidate the already approved Header/Footer placement.
5. **Scoped Phase 8 closure:** Phase 8 may proceed to its formal closure decision against its approved scoped acceptance criteria. This ruling does not certify full Master Spec completion, production performance, live OAuth or public launch readiness.
6. **Phase 9:** Remains **NOT STARTED** until Phase 8 is formally closed by the Product Owner.

**Phase 8 remains ACTIVE.** This approval records the scope disposition only; it is not the separate final phase-gate approval, permission to implement outstanding work, or approval of an unspecified public dataset.

## Independent closure audit evidence

The independent audit on 2026-10-09 verified the committed implementation at the baseline above, with no open PRs. It returned **BLOCKED — AUTHORITY OR EVIDENCE REQUIRED** because P8-04B lacked a formal disposition and scoped acceptance versus broader Master Spec expectations was unrecorded. That historical audit verdict is preserved; this ruling supplies the requested authority, not a rewritten audit or a new phase-closure verdict.

Recorded audit evidence:

- Full frontend: 298 files / 4,811 tests passed, zero failures/skips. The same run included 13 relevant files / 348 passing tests.
- Production build, client lint, architecture, token and diff-integrity checks passed.
- Chromium 148.0.7778.96: 320, 360, 390, 687, 688, 768, 1095, 1096, 1100 and 1440px at normal and 200% text size; reflow, keyboard, FAQ and simulated-action checks passed.
- Minimum measured landing text contrast 5.445:1; auth mode-switch default 13.118:1 and settled hover 10.538:1.
- Logged-out signup/login navigation and safe protected-route redirects passed; no private API requests observed on public boot.
- Original approved SVGs, registered/public/build copies and HTTP serving hashes matched. Header symbol and Footer stacked lockup retained the approved artwork and proportions.
- P8-06B raw measurements were independently recomputed: 12 initial requests, 327,327 B browser-reported transfer; desktop/mobile synthetic FCP medians 156/2,084ms. This remains local synthetic evidence, not field Core Web Vitals or production certification.

Full audit and raw evidence remain executor-local at `C:/Users/user/.codex/audits/p8-final-closure/`, including `report.md`, `current-frontend.json`, `browser.json`, `extra-browser.json`, `brand-integrity.json` and `performance-evidence-recomputed.json`. These artifacts are not committed; access to that path is environment-dependent. Counts above are the recorded independent audit results, not new test runs for this documentation change. No live OAuth, real authenticated-session transaction, production performance or launch-readiness certification is implied.

## Tracked follow-up register

This register retains the requirements without assigning an implementation milestone. Omar retains Product Owner approval authority; implementation owners and timing below are **UNASSIGNED / NOT SET** until separately approved planning establishes them. Overlapping preview/visual requirements remain distinct acceptance obligations.

| ID | Outstanding work | Current status | Required re-entry / planning decision | Implementation owner | Timing |
|---|---|---|---|---|---|
| P8-F01 | P8-04B compact public Allocation Preview | **DEFERRED — DATA PROVENANCE BLOCKED**; not implemented, completed or cancelled | Complete the evidence and approval package below; approve a bounded implementation scope | UNASSIGNED | NOT SET — separate approved planning required |
| P8-F02 | Actual application previews | **OUTSTANDING**; not delivered or waived | Define authorized sources, public-use permissions, composition and approved scope; do not substitute unapproved fixtures for real evidence | UNASSIGNED | NOT SET — separate approved planning required |
| P8-F03 | Three substantial real-UI visuals | **OUTSTANDING**; not delivered or waived | Define and approve the qualifying real-UI visuals and their evidence; existing illustrative demonstrations are not declared to satisfy this requirement | UNASSIGNED | NOT SET — separate approved planning required |
| P8-F04 | Pricing | **OUTSTANDING**; not delivered or waived | Establish authoritative public pricing/currency decisions and approve content and implementation scope | UNASSIGNED | NOT SET — separate approved planning required |
| P8-F05 | Meaningful marketing event tracking | **OUTSTANDING**; not delivered or waived | Approve meaningful events, measurement requirements and implementation scope; existing CTA hooks are not delivered event tracking | UNASSIGNED | NOT SET — separate approved planning required |
| P8-F06 | Unsupplied brand variants and guidance | **SOURCE PENDING** | Supply exact approved sources/guidelines and approve the intended placements; no derived artwork or invented size/clear-space rules | UNASSIGNED | NOT SET — separate approved planning required |

Master Spec references: [§12 Landing Architecture and Pricing, §13 Visual Storytelling, §26 SEO / Marketing Engineering, §34 Content Review](LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md). This register does not alter those requirements or the frozen document. The [current roadmap](README.md#current-execution-roadmap-checkpoint--2026-10-09) indexes this ruling and register. The [brand registry](brand/README.md) defines the supplied placements and source-pending assets.

## P8-04B re-entry boundary

Before requesting implementation approval, establish:

- Identified, verified authorized existing DB evidence and complete source-row/field lineage; no unapproved seeding or promotion of mocked rows into real evidence.
- Supported homogeneous currency provenance and exact UTC spend-window lineage for the governed budget period, with complete/comparable coverage and applicable revenue-window evidence.
- Explicit budget input and documented provenance.
- Reproducible output from the current Allocation service/engine, admitted by the current schema; complete contributing channel set and deterministic derivation for every displayed value.
- A privacy-safe public-use package: source revision/hashes, safe identifiers and names, exact source classification, public label, qualifiers and proposed compact composition.
- Explicit Product Owner approval of that package, its displayed figures/qualifiers and the bounded implementation scope.

The current source gate remains in force. Deferral does not permit fabricated monetary evidence, inferred currency/windows, unapproved customer data, relaxed product contracts or public mutation handlers. Any future implementation must verify its reaching path, access gates, responsive/accessibility behavior, private-read isolation and bundle impact under the separately approved scope.

## Source-pending brand boundary

The already approved Header symbol and Footer stacked lockup remain valid. Reversed/dark, monochrome, horizontal, standalone wordmark, favicon, app icon, social avatar, OG/social artwork and global minimum-size/clear-space guidance remain **SOURCE PENDING**, as recorded in the brand registry. This ruling supplies none of them and approves no new placement or variant.

## Separate Phase 8 formal closure gate

Omar must separately approve the Phase 8 final closure against the approved scoped acceptance criteria, using the independent audit evidence and this outstanding-work disposition. Review follows [REVIEW_GATE.md](REVIEW_GATE.md) and the Design Constitution's Article 36: author self-assessment is not approval.

Until that decision is explicitly recorded:

- **Phase 8: ACTIVE.**
- **Final Phase 8 closure approval: PENDING PRODUCT OWNER DECISION.**
- **Phase 9: NOT STARTED.**

The ruling does not certify full Master Spec completion, production performance, live OAuth or public launch readiness. It changes documentation only; production code, tests, schema, APIs, auth, branding bytes, locked product contracts and the frozen Master Build Spec remain unchanged.

