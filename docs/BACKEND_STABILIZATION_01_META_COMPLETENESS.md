# Backend Stabilization 01 — Meta campaign completeness

Date: 14 October 2026 (Africa/Cairo). Base: `7478d11a8ea596f32da02f2849a2a1c8c805048f`.
Bounded implementation; independent review pending. Backend Gates B/C remain **BLOCKED**.
No roadmap phase or production readiness approval is implied.

## Discovery and authority

Fresh fetch verified origin/master at the supplied base. GitHub reported no open
PRs before implementation. Master Tests run 38561362369 and Architecture Check run
38561362482 had four failed jobs with **zero steps**. The annotation explicitly
identified account payment/spending restrictions: hosted verification did not run.

Read CLAUDE.md authority and verification requirements, Product Truth Rulings,
design-governance/README.md and REVIEW_GATE.md, and the prior backend discovery
report dated 14 October at 0660e912. Discovery finding F04 is confirmed in the
fresh base: campaign completeness is lost in both leaf fetch functions. F05's
historical worker observations and F06's request-accounting hypothesis are not
investigated or certified by synthetic fixtures here.

The governing connectorReadiness.js R-8 contract says readiness explains absence
and does not gate verdicts. Preserve separate availability, completeness and
capability axes. This task authorizes backend work, without changing R-8 policy.
The primary checkout's unrelated branch and four untracked Phase 6 files were
preserved. Work uses an isolated worktree based directly on master.

## Confirmed cause and propagation

`collectCursorPages` already returns `{ rows, pages, truncated }` and throws when
the provider or next-page call fails. Its cap is 50 pages. At base,
`fetchCampaignInsights` and `fetchAllCampaigns` return only `rows`, discarding
`truncated`. MetaConnector.fetchRaw merges these arrays, retains truncation only
for ad sets and ads, and converts every secondary failure to an empty fallback
without preserving failure identity. ConnectorSyncService warns only for its
aggregate `truncated` boolean and incorrectly names ad sets for every case.

The patch carries frozen, non-enumerable `fetchMeta: { pages, truncated }` on each
campaign array. MetaConnector reads those properties before the merge and carries
`truncatedEdges`, `failedEdges`, and `incomplete` on its existing non-enumerable
fetchMeta. Counts retain their prior meaning: collected/merged rows, never an
estimate of the unobserved account. All five existing secondary catches record
their edge identity; their fallback rows and primary failure behavior are unchanged.

ConnectorSyncService names actual capped and failed edges in the existing warning.
The same workspace-locked commit calls nextHealth and persists lastWarning in
marcom_credentials.health. Clean success clears it; primary failure records
lastError and preserves previous successful health. No persisted enum is added.

| Evidence or outcome | Before | After |
|---|---|---|
| Cursor truncation | Returned by helper | Unchanged |
| Campaign insights cap | Dropped at leaf | Array fetchMeta -> campaignInsights in truncatedEdges -> health warning |
| Campaign roster cap | Dropped at leaf | Array fetchMeta -> campaignRoster in truncatedEdges -> health warning |
| Campaign roster failure | Empty fallback, no completeness evidence | Same fallback; campaignRoster in failedEdges -> health warning |
| Ad-set/ad caps | Aggregate boolean retained, warning misnames edge | Boolean retained; exact insight/roster edges identified |
| Other secondary failures | Empty fallback, no completeness evidence | Same fallback; named failed edge -> warning |
| Primary campaign failure | Throws; sync error receipt | Unchanged |
| Complete empty | Genuine zero collected rows, no warning | Same rows; explicit false truncation/incompleteness metadata |
| Later clean success | Clears prior warning | Unchanged, regression verified |
| Canonical and daily populations | Separate reads and contracts | Unchanged; canonical risk below remains open |

## Consumers and compatibility

Runtime direct callers found by repository search:

- MetaConnector.fetchRaw calls both campaign leaves; it now consumes metadata.
- src/routes/campaigns/feed.js:69 calls fetchCampaignInsights for
  POST /api/campaigns/fetch-meta. Analyze mode (lines 71–96) normalizes rows,
  enforces the existing 20-campaign cap and calls analyzeCampaignData. Chat mode
  (lines 99–107) formats rows and calls runCampaignAnalysis/runMode5. Neither reads
  array fetchMeta or exposes completeness in its response. **D-1, open policy
  risk:** these analysis paths still can consume incomplete insights. An analysis
  cap is not proof of pagination completeness. Inventory is verified; actual
  affected production requests are unknown. Do not silently change AI-analysis
  eligibility or response policy in this slice.

Sync evidence consumers: GET /api/lumi/connections publishes original health,
availability and completeness through connectorReadiness; INCOMPLETE is derived
from the stored warning after a recorded success. Admin workspace detail also
publishes lastWarning. Manual sync returns the same warning alongside existing
success/error results. Availability can legitimately remain OK with INCOMPLETE.

NO_DATA, FAILED, PARTIAL and UNKNOWN are distinct concepts, not a proposed new
sync enum. The existing daily capability still owns NO_DATA/FAILED; it is not
repurposed for operational campaign fetches. Operational partial success uses
the governed success + warning / INCOMPLETE axis. Failed first attempts remain
FAILING + NOT_RECORDED completeness; absent evidence stays NOT_RECORDED, never
fabricated COMPLETE. A later failure can coexist with prior COMPLETE/INCOMPLETE
because availability and completeness describe different receipts.

Both public campaign return values and fetchRaw stay arrays. Iteration, spread,
JSON and deep row equality are preserved. _rosterOnly rows retain entity-only
semantics; the existing normalizer/sink regression verifies no zero MetricSnapshot.
No change to measurement values, windows, currencies, SDK fields, requests,
polling, retries, auth, role guards, tenant selectors, schemas or migrations.

## V-1 — blocking canonical eligibility finding, requiring Product Owner decision

**Verified source path; production impact unverified. Not repaired by this PR.**

1. metaAdsService.fetchCanonicalAllLevels (lines 1159–1210 after this patch)
   independently collects canonical campaign/ad-set/ad reads, returning truncated
   and failed-level metadata; all-level failure throws, partial failure returns.
2. MetaConnector.fetchCanonicalRaw returns that envelope unchanged.
3. ConnectorSyncService.js:117–122 consumes raw30.rows and window bounds only,
   then lands snapshots. It drops raw30.truncated and raw30.failed.
4. EntityGraphService.getCanonicalVerdictCampaigns:227–276 selects canonical
   rows and applies structural resolution and freshness. metricWindow.js:681–711
   corroborates declared 30-day bounds; it has no fetch-completeness provenance.
5. connectorVerdictService.evaluateConnectorVerdicts:310–311 calls that reader
   and buildConnectorVerdictTree. The tree's eligibility at lines 133–141 depends
   on measured revenue or engagement, not completeness. Rows returned by a capped
   canonical read can therefore participate when their other predicates pass.

Canonical consumers include GET /api/lumi/entities/verdicts and /entities/health
(entities.js), copilot, AgenticLoopService evaluation, content-intel/campaignIntel,
AccountHealthService, AccountAggregateService, CampaignReasoningService and
PortfolioAnalysisService; evaluated verdicts also feed VerdictService persistence.
Portfolio ranking/aggregation
can operate on the available subset; this is not proof of any incorrect live
verdict. Operational incompleteness alone does not prove canonical incompleteness:
they are separate fetches and windows.

Required decision: define whether completeness belongs to per-entity canonical
evidence, per-level/cohort evidence, or both, and how partial/failed refreshes and
retained prior evidence affect eligibility. Approve its provenance and refusal
contract before implementing it. Gating on operational lastWarning would silently
change the locked R-8 policy and conflate different measurement populations.

## RED / GREEN and commands

Runtime Node 24.20.0, npm 11.19.0. Install used `npm run install:backend`; explicit
`npm run prisma:generate` succeeded with database variables blank. No .env or real
advertising credentials were copied. Vitest's configured networkGuard remained
first in setupFiles. Provider functions are fully stubbed in MetaConnector tests;
leaf tests spy on the actual CJS SDK method and init, using only synthetic cursors.

Definitive RED command on unchanged base production files, with the corrected
provider harness:

```text
npm run test:fast -- src/services/metaAdsService.campaignCompleteness.test.js src/services/connectors/MetaConnector.test.js src/services/connectors/syncWarning.test.js
```

RED: **3 suites failed; 22 tests failed, 39 passed, 0 skipped; exit 1**.
Earlier harness attempts omitted api.setDebug from the init stub; those harness
failures are excluded from finding evidence. GREEN, same command and harness:
**3 suites passed; 61 tests passed, 0 failed, 0 skipped; exit 0**.

The new cases cover capped insights/roster, exhausted pagination including exactly
50 pages, complete empty, initial/next-page throws, roster failure after insights,
primary throw, unchanged rows/_rosterOnly/JSON, all existing ad-set/ad cap and
failure edges, affected-edge warnings, scoped receipt and prior-warning clearing.

Broader focused command:

```text
npm run test:fast -- src/services/connectors src/services/metaAdsService src/services/verdict-engine src/services/entity-graph src/routes/lumi/connections src/routes/auth/meta src/tests/networkGuard src/tests/runtimeContract
```

**92 suites passed, 13 skipped; 1,844 tests passed, 152 skipped, 0 failed; exit 0**.
Fast skips are DB-gated; that run does not prove DB behavior.

`npm run test:full`: **452 suites passed; 6,968 tests passed, 0 failed, 0 skipped;
exit 0**. PostgreSQL 18 on 127.0.0.1:55431, synthetic slice01 account. Naming root
lumi_meta_completeness_verify differs from the ambient isolated runtime DB. The
provisioner migrated a template and created 12 separate worker databases; all were
torn down. This executes sink, health, canonical/daily, tenant/auth and contract
regressions against isolated data. It does not execute a production sync.

`npm run lint`: exit 0, 0 errors, 31 existing warnings.
`npm run arch-check:backend` and `npm run security-check:backend`: both exit 0.
`npm run build:backend` with database variables blank: exit 0; Prisma generation,
858-file syntax/alias check and server module graph linking passed. No migration
or UI build was run by that command.
No checks, assertions, network guard or test discovery rules were weakened.
Frontend/browser E2E, live provider authorization, real pagination, production
worker recovery and advertising action execution were not run or claimed.
Hosted CI must be reported separately for the immutable PR head; prior PR #574
exceptions do not authorize this PR or future heads.

## Changed files

1. src/services/metaAdsService.js — retain leaf pagination metadata on arrays.
2. src/services/connectors/MetaConnector.js — aggregate completeness across six edges.
3. src/services/connectors/ConnectorSyncService.js — persist accurate existing warnings.
4. src/services/metaAdsService.campaignCompleteness.test.js — synthetic SDK/cursor cases.
5. src/services/connectors/MetaConnector.test.js — row and metadata propagation regressions.
6. src/services/connectors/syncWarning.test.js — persisted health and clearing regressions.
7. This document — discovery, propagation, evidence, limits and independent review scope.

## Production impact, rollback and review

No production mutation, provider request, merge or deployment was performed.
If separately deployed, previously hidden partial reads will become visible through
health/connection completeness and warning text, while rows and sync status retain
their governed behavior. Rollback is a code revert of these three production files;
no schema/data migration is required. Existing warning strings are display-safe
under old consumers and persist until a later clean receipt. Reverting reintroduces
the lost-completeness defect; it does not reconstruct previously missing data.

Render Web and Worker auto-deploy master, per the supplied deployment constraint.
**Merge is blocked pending a separately approved deployment plan** coordinating
both services, exact head/rollback artifact, observation and rollback criteria.
No Render configuration change is included. Gates B/C remain BLOCKED: V-1, D-1,
request accounting, provider/worker recovery, raw-table lifecycle, deployment
reconciliation and the remaining backend discovery obligations are not closed.

Request independent review of the immutable draft PR head against the base above:
trace both campaign leaves through the exact diff, verify capped/failed/empty
distinctions and untouched row/tenant/window contracts, inspect RED/GREEN logs,
and keep canonical eligibility, AI-analysis and deployment decisions separate.
Stop at draft PR and evidence review. Do not merge or deploy.
