# Backend Stabilization 02A — canonical evidence provenance

Date: 2026-10-15, Africa/Cairo. **Documentation only.**
Verified master: `dd2f424a5f845ff3e6d7f473392abc3920ab9ca8`.

**Authority split:** the five Product Owner principles in §1 are APPROVED on
2026-10-15 by the supplied 02A instruction. Technical recommendations in §§3–9
are PROPOSED, requiring separate approval before implementation; cited existing
behavior is source evidence. No runtime, schema,
migration, API field, persisted state, eligibility, ranking or Decision is changed.
Backend Gates B/C remain **BLOCKED**. No roadmap phase advances.

## 1. Approved Canonical Completeness Ruling

1. Individual absolute assessments may use qualifying per-entity canonical
   evidence; unrelated missing campaigns do not automatically invalidate that evidence.
2. Relative rankings and cohort-based KILL/SCALE adjustments require proven
   completeness of the applicable canonical cohort. Incomplete or unknown cohorts
   cannot produce relative judgments.
3. Partial/failed refreshes must not rewrite historical evidence as new or complete.
   Prior evidence remains usable only when independently qualified by its original
   provenance and existing freshness rules.
4. Historical snapshots without fetch-completeness provenance remain UNKNOWN,
   never retrospectively COMPLETE.
5. Connector readiness remains explanatory under Constitution R-8 and must not
   directly gate verdicts.

This is a new scoped product ruling, not a renumbering of Constitution R-8 or the
historical PR-1…PR-13 rulings. Technical approval is not implied by policy approval.

## 2. Baseline, authority and verified lifecycle

Fresh origin/master matches the reference. There were no open PRs. PR #575 merged
as this master on 2026-10-15; its operational completeness changes were verified
on trunk by content, not ancestry or badge. Its head and master have identical
trees. PR #574 and #573 are also recorded as merged. The source citations below
refer to the verified master, not the unrelated primary checkout.

Master Tests run 38696112404 and Architecture Check run 38696112402 contain four
failed job records with zero executed steps. The inspected backend annotation
identifies GitHub payment/spending restrictions. Hosted CI is NOT_TESTED, not a
test pass. No historical local CI exception transfers to this PR.

Authority read: CLAUDE.md authority/verification rules, Product Truth Rulings,
design-governance/README.md and REVIEW_GATE.md; Constitution R-8 is reflected
explicitly by [connectorReadiness](../src/services/connectors/connectorReadiness.js#L1).
Canonical structural/freshness contracts remain in metricWindow and
canonicalVerdictEvidence. PR #575's [discovery record](BACKEND_STABILIZATION_01_META_COMPLETENESS.md)
is historical evidence; its V-1 now has an approved policy direction, but no
implemented lineage or eligibility remedy.

No new material baseline conflict prevents this documentation scope. The existing
2026-10-09 frontend roadmap checkpoint still labels Phase 9 implementation
NOT AUTHORIZED/NOT STARTED; the prior backend discovery reported its discrepancy
with later merged onboarding work. This task does not reconcile that historical
authority trail or promote it into a new phase/gate approval.

### 2.1 Source-backed path and loss points

| Step | Verified source | Facts preserved / facts lost |
|---|---|---|
| Cursor collection | [metaAdsService.js:213](../src/services/metaAdsService.js#L213) | Rows, page count, cap/exhaustion-derived truncated. HTTP success alone is insufficient. |
| Per-level canonical fetch | [metaAdsService.js:363](../src/services/metaAdsService.js#L363) | Explicit requested canonical bounds; returns rows, bounds, truncated. Page count is logged but not returned in the canonical envelope; raw row dates can differ or be absent. |
| All canonical levels | [metaAdsService.js:1159](../src/services/metaAdsService.js#L1159) | Returns merged rows, requested bounds, aggregate truncated, failed level/error list, byLevel successful row counts. Loses which successful level truncated; counts do not prove membership. All-level failure throws; partial level failure returns. |
| Connector | [MetaConnector.js:183](../src/services/connectors/MetaConnector.js#L183) | fetchCanonicalRaw returns the envelope. Canonical normalization declares CUMULATIVE_30D, separate from operational and daily. |
| Sync | [ConnectorSyncService.js:117](../src/services/connectors/ConnectorSyncService.js#L117) | Passes rows and requested bounds to normalizer, lands counts; discards canonical truncated, failed, byLevel. Canonical failure is best-effort and does not fail operational sync. |
| Row normalization | [metaNormalize.js:128](../src/services/connectors/normalize/metaNormalize.js#L128) | Records source and window; provider dates win, but absent dates fall back to requested bounds. Stored bounds alone cannot distinguish SOURCE_REPORTED from REQUEST_FALLBACK. |
| Landing | [snapshotSink.js:56](../src/services/connectors/snapshotSink.js#L56), [landSnapshots:341](../src/services/connectors/snapshotSink.js#L341) | Roster-only creates entities, no fabricated zero snapshot. Parent/orphan and zero-shadow filtering can exclude rows. Entity and metric batches are separate workspace-protected transactions; no canonical lineage receipt. |
| Write identity | [nonDailySnapshotWrite.js:55](../src/services/connectors/nonDailySnapshotWrite.js#L55), [MetricSnapshot](../prisma/schema.prisma#L1261) | Six-column non-daily partial unique identity; payload can be replaced under the same ID. No fetch-run, account-at-observation or cohort manifest on snapshots. |
| Canonical reader | [EntityGraphService.js:176](../src/services/entity-graph/EntityGraphService.js#L176), [canonical selector:227](../src/services/verdict-engine/canonicalVerdictEvidence.js#L227) | Workspace-scoped platform/campaign/window population. Identity query has take:200; selector projects neither snapshot ID nor receipt. A complete provider read can still yield an incomplete evaluated population. |
| Resolve and freshness | [metricWindow.js:681](../src/services/verdict-engine/metricWindow.js#L681), [resolver:728](../src/services/verdict-engine/metricWindow.js#L728), [partition:343](../src/services/verdict-engine/canonicalVerdictEvidence.js#L343) | Structural window validation; order by windowEnd then snapshot date; freshness from measured windowEnd. No fetch-completeness or coherent-cohort check. |
| Absolute and relative passes | [connectorVerdictService.js:306](../src/services/verdict-engine/connectorVerdictService.js#L306), [relativeRanking.js:135](../src/services/verdict-engine/relativeRanking.js#L135) | Builds eligible individual tree, runs rollup, then relative post-pass unconditionally. Existing relative grouping is awareness/conversion, candidate minimum 3; no completeness precondition. |
| Decision write | [VerdictService.js:103](../src/services/verdict-engine/VerdictService.js#L103), [persist:357](../src/services/verdict-engine/VerdictService.js#L357) | Same evaluation feeds read and write. Same verdict suppresses a new row; changed verdict creates a proposal and resolves previous. Dropped eligible IDs cause proposal supersession. Evidence reference is best-effort, not an immutable observation/cohort reference. |

### 2.2 Existing durable identifiers and retention

No safe canonical fetch/observation receipt was found in the schema or runtime
search. MetricSnapshot.id identifies a mutable materialization, not an immutable
observation. Its date is a sync timestamp, not a fetch-run ID or source period.
[credential health](../src/services/connectors/ConnectorSyncService.js#L48) is a
latest mutable per-workspace/platform receipt; it describes operational success
and warning and cannot prove historical canonical lineage.

[LoopRun](../prisma/schema.prisma#L2374) describes an agentic sweep, not canonical
fetch edges or their snapshot commits. A sweep can follow a failed sync or run
without a sync. [BullMQ jobs](../src/queues/index.js#L43) have Redis age/count
retention; [syncWorker](../src/workers/syncWorker.js#L18) also accepts a global sync
covering multiple workspaces, with retries/attempts distinct from a provider read.
These are useful correlation IDs, not authoritative durable fetch identity.
PatternObservation, AI usage and execution checkpoints concern other populations.

No general time-based MetricSnapshot pruning was found in the runtime search;
that is not a promise of indefinite retention. Restatement overwrites values.
The GA4 actuals writer explicitly deletes a superseded declaration on its own
identity; it is a different population. Workspace-owned MetricSnapshots cascade
on workspace deletion. [Admin deletion](../src/routes/admin/workspaces.js#L326)
and [self deletion](../src/routes/user.js#L283) coordinate raw credentials with the
workspace; new lineage must follow the same lifecycle, not outlive its tenant.

### 2.3 Consumer map

| Consumer | Individual versus cohort dependency |
|---|---|
| evaluateConnectorVerdicts / buildConnectorVerdictTree | Individual evidence and absolute engine first; current output also applies relativeRanking. |
| applyRelativeRanking | Cohort CTR ranking/averages and relative KILL/SCALE upgrades; must require proven applicable membership after a separately approved implementation. Preserve all current grouping/threshold rules unless separately authorized. |
| getConnectorVerdicts; GET /api/lumi/entities/verdicts; copilot | Publish evaluated results, relativeRank/context, decision identity and agreement; must distinguish absolute result from unavailable relative comparison. |
| GET /api/lumi/entities/health; AccountHealthService/AccountAggregateService | Use canonical entity evidence and verdicts in account aggregates. Existing numbers can describe an available subset; full-account claims also need explicit coverage, not a hidden ranking-only gate. |
| CampaignReasoningService; PortfolioAnalysisService; campaignIntel | Narrate evaluated evidence. Portfolio comparisons, rankings and full-population claims need the same proof; individual facts must retain their own provenance. |
| AgenticLoopService → persistConnectorVerdicts → VerdictService | Shares one evaluation, creates/supersedes proposals; policy rollout can affect persisted decisions and later execution/learning even when ingestion alone changes no metrics. |
| GET /api/lumi/connections; admin workspace health | Operational availability/completeness explanation only; never the lineage authority for absolute or relative canonical claims (R-8 unchanged). |
| /api/campaigns/fetch-meta chat/analyze | Direct operational insights and AI-analysis path, not this canonical read path. Unchanged and excluded; PR #575 D-1 remains separately open. |

## 3. Recommended technical contract — PROPOSED

Recommend a dedicated relational lineage ledger with immutable observations and
sealed population manifests. MetricSnapshot stays the existing compatibility
materialization under its existing identity. Health and job records are correlation
only. New storage, constraints and record names below are proposals, not additions
to the current Prisma schema or product vocabulary.

### 3.1 Scope and identity

Canonical fetch scope is the explicit tuple:

```text
workspaceId + platform + providerAccountId + entityLevel + measurementWindow
+ requestedWindowStart/End + requestContractVersion + scopeSpecificationHash
```

scopeSpecification includes endpoint/API version, filters, attribution settings,
fields, breakdowns, cumulative versus daily mode, account timezone/provenance and
the captured configured account-set revision. Normalize identifiers; never include
tokens, credential secrets, raw next-page URLs or access-token-bearing cursors.
Hash a versioned canonical serialization, not incidental object/array ordering.
Scope proves only the declared API-visible population, not every campaign or
account that might exist in the business outside that scope.

Use two distinct, server-owned identities, independent of BullMQ job ID or
caller-supplied now:

- **refreshId** identifies one logical canonical refresh for one workspace,
  platform/account, requested window, captured account-set revision and declared
  required levels (currently campaign, ad-set and ad). It groups work, not one
  provider read. A global sync has a separate refreshId for each such scope.
- **levelAttemptId** identifies one actual invocation of the per-level canonical
  fetch, with exactly one refreshId, level and immutable level-scope descriptor.
  Its unit is the traversal starting with that level's initial getInsights call,
  followed by its cursor pages. A next-page request belongs to this traversal;
  it is not another level attempt. A new invocation/restarted traversal, including
  a retry of the same level/window, always gets a new levelAttemptId.

An admitted logical refresh can have multiple level attempts per level. A retry
records retryOfLevelAttemptId and an ordinal unique within (refreshId, level);
it never appends pages or changes the result of the failed/capped predecessor.
Only an open refresh with the identical captured scope may admit that retry.
After refresh sealing, or on a changed account/window/scope, create a new refreshId;
retryOfRefreshId may correlate it, but confers no evidence from its predecessor.
Queue/job retries must resolve this durable parent explicitly, not infer it from
job ID or timestamps. No retry, polling or additional provider request is authorized
by this identity definition. Hidden SDK transport retries are not invented as
observed attempts/counts; any claim depending on unavailable request evidence
remains unknown.

Record refresh admission and each level's startedAt, fetchFinishedAt and committedAt
separately. Retain snapshotDate with its existing sync-time meaning; do not
redefine observedAt or advance it when historical measurements are reused.

### 3.2 Proposed records and invariants

| Record | Required content and purpose |
|---|---|
| CanonicalRefresh | refreshId and immutable workspace/platform/account/window/account-set/required-level descriptor; admitted levelAttemptIds and terminal selection of exactly one terminal levelAttemptId with its outcome per attempted required level, including failures. A never-started level has an explicit unknown/not-started disposition, not a fabricated attempt ID. This groups the logical refresh; it is not a provider attempt. |
| CanonicalLevelFetchAttempt / CanonicalLevelReceipt | One levelAttemptId under exactly one refreshId and level; retry predecessor/ordinal, traversal scope, observed cursor exhaustion/cap/error facts and counts when actually known, and period-proof summary. Its terminal source receipt is sealed once; absence is unknown, not false/zero. A separately identified, once-sealed write-outcome receipt references this source receipt; later commit/failure cannot mutate source facts. |
| CanonicalObservation | Immutable observationId; workspace/account/platform/level/external entity identity, exact refreshId + levelAttemptId + level-receipt reference, snapshot logical key, source-reported dates or their absence, requested bounds separately, source/currency/timezone provenance and field-presence/quality facts. Store the exact committed normalized evidence projection and its versioned content hash. Snapshot ID, if captured, is a materialization locator only. |
| CanonicalPopulationManifest | Sealed record for one exact scope/window identifying its refreshId and selected campaign levelAttemptId, returned Insights identities, independently evidenced applicable membership and its proof references, committed observation IDs, all reconciliation dispositions and hash. Traversal, membership and write evidence are separate; a sealed record can remain UNKNOWN/INCOMPLETE and is not automatically evaluation-ready COMPLETE. Empty Insights alone is not an empty applicable cohort. |
| CanonicalCohortEvaluationReference | Immutable evaluation identity, policy version, declared account/source scope, manifest(s), input observation IDs/partition attributes, derived candidate membership and comparison window. Same reference must travel through the read result and any separately approved persisted Decision lineage. |

All ownership and joins include workspaceId. Require same-workspace composite
references/constraints, real parent FK/CASCADE lifecycle and ownership validation;
MetricSnapshot.entityId currently has no polymorphic entity FK, so matching an
entity UUID alone is insufficient. Provider account identity is captured at fetch
time, not recovered later from today's credential. Version objective/classification
facts used to partition cohorts; current mutable campaign attributes alone cannot
reproduce an earlier cohort.

Observations, terminal level receipts and manifests are append-only after sealing.
A known provider exception seals a FAILED source receipt for that levelAttemptId,
including only observed partial counts/identities (otherwise null), never an empty
success. Campaign failure and other-level success remain separate receipts. If all
three fail, their failures and the logical terminal refresh receipt must survive
the aggregate throw; no level is promoted to complete. A commit failure has its
own write-failure receipt and cannot replace a successful source-traversal receipt.
If a crash/storage outage prevents recording a terminal fact, the unsealed attempt
is UNKNOWN; a later process may record observed abandonment, not fabricate success.
A DB-only retry may reference the same source attempt only when the identical
captured payload remains available; it gets a new write-receipt identity linked
to the failed write, without changing that failure or original observation time.
Replay of an already committed artifact is idempotent. A new provider invocation
always requires a new levelAttemptId; unavailable payload is never reconstructed
from counts or a newer mutable snapshot.

Sealing is compare-and-set, once only. Before sealing a refresh, stop admission of
new attempts and freeze the chosen levelAttemptIds and every other attempt's
disposition. Only terminal attempts whose exact scope matches their parent may be
selected; missing/unsealed levels are explicitly unknown. A late completion cannot
change the sealed selection. Sealing the logical refresh does not certify any
cohort or certify ingestion: it closes provider-attempt admission and source
selection; separate write receipts record subsequent commit outcomes. Campaign
completeness is decided from its selected campaign attempt and
§3.4 proof, independently of ad/ad-set outcomes.

No receipt, page fragment, observation or favorable boolean from another attempt
may fill a selected attempt's gaps, even inside the same refresh. A later success
supersedes a failed attempt only by explicit selection of the new whole attempt;
the original failure is retained. Across refreshes, earlier evidence is reusable
only as its original coherent manifest under the historical rules below. Composing
distinct account scopes for a workspace evaluation requires an explicit versioned
composition reference; it cannot splice attempts for the same account/level scope.
Identical artifact replay is idempotent; reuse of an identity with different
scope/content is a conflict. A separately referenced membership-proof artifact
under §3.4 remains distinct evidence, not a substitute for the selected attempt's
own traversal or missing metric observations. These rules do not add a provider
retry or request.

### 3.3 Facts and four completeness meanings

**Source facts:** requested scope, actual provider row fields/date presence,
collected identities, cursor exhaustion or page cap, thrown error, measured page
count, source/currency/timezone disclosures. A successful HTTP response or nonempty
array alone proves none of complete pagination, complete fields, or all campaigns.

**Derived facts:** normalization acceptance/exclusion, committed row identities and
hashes, query coverage, and cohort membership reconciled against the positive
membership evidence in §3.4, plus structural/freshness eligibility. Persist the
derivation version and inputs. An exhausted Meta Insights traversal is a source
fact about that edge; it is not proof of the applicable campaign roster/cohort.
Metrics from invalid/missing fields are not silently invented.

**Unprovable facts:** contents of unread pages, metrics for absent rows, all business
accounts outside the authorized scope, a provider-wide point-in-time snapshot across
mutable cursor pages without a provider guarantee, and historical fetch completeness
without a receipt. Declare these limits; cursor exhaustion proves the declared
traversal, not a transactional provider snapshot.

| Meaning | Contract interpretation | Relationship to existing vocabulary |
|---|---|---|
| COMPLETE | Positive membership evidence for the declared applicable cohort, exhausted relevant Insights traversal, compatible scope/period and full membership-to-observation-to-evaluation reconciliation under §3.4; all comparison inputs trace to a coherent sealed manifest set. Traversal exhaustion alone is insufficient. | Existing health COMPLETE is operational only and cannot supply this proof. This is a technical lineage conclusion, not a new persisted sync enum. |
| INCOMPLETE | Known cap, known omitted applicable members, or downstream query truncation/exclusion whose coverage cannot support the declared cohort. | Operational partial success still maps to success + warning / INCOMPLETE as today; canonical proof stays separate. |
| FAILED | The applicable read or required commit failed; record which boundary failed. An exhausted Insights traversal followed by failed storage retains traversal facts but proves no committed complete cohort. | Existing failure/COULD_NOT_LOOK meaning; never NO_DATA. Different level success is preserved, not collapsed into campaign success. |
| UNKNOWN | Missing receipt, unsealed attempt, absent/insufficient positive membership evidence, unproved downstream coverage, ambiguous scope, incomplete lineage or legacy evidence, even when Insights traversal exhausted successfully. | Existing NOT_RECORDED/COULD_NOT_LOOK distinctions remain. Do not publish a new canonical API token by reusing an unrelated health enum. |

These four words are design semantics, not new database enums or public product
states. The future wire contract must map each exact absence/refusal meaning to
the governed vocabulary through a separately approved contract change. Known
cohort uncertainty must not be falsely labelled NO_CANONICAL_WINDOW when valid
individual evidence exists. Complete empty requires positive proof that the
applicable membership is empty as well as the reconciled empty traversal; an empty
Insights response alone leaves cohort membership UNKNOWN. Neither case fabricates
a per-campaign zero measurement or verdict.

### 3.4 Entity versus cohort qualification

An individual observation may qualify independently of cohort completeness.
Record exactly what the provider supplied and the evidence fields the absolute
assessment requires. Require structural canonical validity, original acceptable
source provenance and existing measured-window freshness. A returned row is not
assumed to have every metric, genuine period proof or a whole campaign population.
Capture provider-reported bounds separately from requested-window fallback; the
current stored pair cannot recover that distinction retrospectively.

For relative judgment, define the applicable campaign population and existing
candidate/partition predicate before inspecting the returned subset. Meta campaign
Insights reports delivery measurements; exhausting it does not establish the full
campaign roster or prove that every applicable member was represented. Do not
redefine the cohort as "whatever Insights returned" to make completeness true.

**Positive membership evidence** must identify an authoritative, exhaustive set of
campaign identities for the declared account/source scope and relevant period,
with the versioned applicability predicate, account-set revision, scope/filter
descriptor, temporal validity and per-identity partition facts. An independently
captured roster/discovery artifact from already-authorized reads is a possible
input only if its coverage is positively established: including applicable
non-delivering, archived/deleted or otherwise filter-sensitive campaigns, or
explicit authoritative evidence why they cannot belong. A current roster is not
automatically historical-window proof. Neither operational health nor the current
bounded entity-graph query supplies that authority. A roster cursor/count also
requires evidence of the declared membership coverage; its name alone proves none.

Persist the proof artifact/reference and identity membership, not just a count or
hash. This finding authorizes **no additional Meta requests**, new discovery path
or reinterpretation of existing roster guarantees. If already-authorized evidence
cannot establish that authoritative set and its temporal/scope compatibility,
capture the traversal facts but leave membership and cohort completeness UNKNOWN.
Capture-only 02B must not seal an evaluation-ready COMPLETE cohort from exhausted
Insights pagination, successful HTTP, row counts or a sealed refresh alone.

**Required reconciliation:** let M be the positively evidenced applicable identity
set, I the selected campaign attempt's returned Insights identities, O its committed
observation identities, and E the evaluation's actual candidate identities. For
every member of M, record a qualifying observation or a justified exclusion under
the unchanged versioned candidate predicate with supporting evidence. Absence from
Insights alone is not proof of zero delivery or non-applicability. Resolve I outside
M, missing/duplicate/conflicting IDs, partition ambiguity, normalization/orphan/
zero-shadow drops and all differences between intended candidates and E explicitly.
Do not ignore unexpected members or infer reconciliation from matching counts.
Unresolved known omissions are INCOMPLETE; an unproved universe or disposition is
UNKNOWN. Both refuse relative judgment while preserving qualifying absolute facts.

The current take:200 identity query is an independent downstream coverage limit.
Fewer or exactly 200 returned IDs, or equal fetched/stored counts, do not by
themselves prove E exhaustive. Require identity-level reconciliation against M
and all justified exclusions, or an independently exhaustive bounded/paginated
enumeration with the same scope/predicate and end-of-enumeration proof. If that
evidence is unavailable, E's coverage is UNKNOWN even after exhausted Insights.
If known applicable members are omitted by the cap, coverage is INCOMPLETE. A
small positively proven M can qualify only when all its candidates and exclusions
are reconciled; the cap must not silently truncate the applicable evaluation.
This contract does not change the existing query or add requests.

An ad/ad-set failure does not invalidate an otherwise proven campaign cohort.
Per-level receipts must remain independent; an aggregate truncated boolean cannot
decide campaign completeness. If today's workspace cohort spans accounts/platforms,
prove every applicable declared campaign scope and freeze the same grouping rules.
Do not silently narrow the cohort to whichever provider happened to succeed.
Shared comparison-window compatibility and account-set membership must be explicit.

**Recommended historical reuse:** individual observations can be selected under
their original period/provenance and existing freshness rules. A previously
complete cohort can be reused only as that coherent earlier manifest/evaluation
input set, with its original timestamps and still-compatible scope; never mix
individually latest observations from different attempts and call the union
complete. Re-evaluate freshness and membership compatibility at evaluation time.
Do not introduce a new freshness threshold or claim the failed latest attempt
succeeded. Selection/reuse policy details in §9 require technical approval.

## 4. Snapshot identity, transactions and concurrency — PROPOSED

### 4.1 Verified identity and the required binding

The shipped non-daily identity is
`(entityId, entityLevel, date, granularity, source, measurementWindow)` under the
partial index `WHERE measurementWindow <> 'DAILY'`. It excludes workspaceId,
providerAccountId, refreshId, levelAttemptId, windowStart and windowEnd. Normal connector IDs are
workspace-derived, but new lineage must enforce workspace ownership explicitly.
DAILY uses a different sink/identity and stays outside this design's write scope.

The raw writer uses ON CONFLICT DO UPDATE for every defined payload column,
retaining the row UUID. Exact replay updates in place; changed values can also
replace the same row. The existing [integration test:145](../src/services/connectors/nonDailySnapshotWrite.integration.test.js#L145)
explicitly asserts changed metrics with the same ID. It was inspected, not executed
in this documentation task. Different sync dates normally create separate rows;
caller/retry reuse of a date can collide. The UTC timestamp casts are load-bearing.

Therefore retain the existing key and store immutable observation values beside
it. A snapshot ID/key is an optional lookup locator plus content hash, never the
sole evidence reference. The normalized committed projection must be sufficient to
reconstruct assessment inputs even after a materialization is restated. Same-key
new values create a new observation and retain old observation content. An old
receipt must never be rebound to the replacement row. If lineage/content cannot
be reconciled, treat it as unknown; do not borrow the old completeness flag.

### 4.2 Commit protocol

1. Admit the logical refreshId for a live authorized workspace and immutable
   captured account/window/required-level scope. Admit a distinct levelAttemptId
   before each actual per-level fetch invocation; release DB locks before provider
   calls. Queue/request IDs are correlation only. Retries follow §3.1, never a
   reset/reuse of a prior attempt identity.
2. Collect and seal each attempt's source receipt independently, including known
   per-level failures before propagating aggregate failure. Leave unsealed facts
   UNKNOWN when process/storage failure prevents terminal evidence. Select and
   freeze exact levelAttemptIds in the refresh receipt as §3.2 specifies; a failed
   predecessor cannot contribute pages/flags to a selected retry. Lost next-page
   rows are not recovered by invention; changing fetch behavior is separate.
3. Use the existing parent/admission checks and record all normalization, orphan
   and zero-shadow exclusions. Source success is distinct from ingest success.
4. In one bounded DB-only transaction, lock live workspace then the affected
   canonical scope(s) in deterministic order; write canonical materialization,
   immutable observations bound to the exact refreshId/levelAttemptId, and the
   population-manifest commit. Seal evaluation-ready COMPLETE only when §3.4's
   positive membership proof and full source/committed/evaluated reconciliation
   also hold; exhausted Insights plus successful writes is insufficient. A capture
   manifest can be sealed with membership UNKNOWN. Existing entity upserts may remain
   separate; their success alone is not a population commit. No provider/AI call
   belongs inside this transaction.
5. On failure, roll back that canonical metric/observation/manifest transaction.
   Record the failed commit separately if the workspace still exists. Keep prior
   committed observations/manifests; never advance their dates or mark new coverage.
   A source receipt may say traversal exhausted while commit says failed.
6. Read observations and their coherent manifest/evaluation inputs under one
   consistent database view. Freeze the chosen set for read and write consumers;
   do not re-query a newer manifest partway through a sweep.

Current [withLiveWorkspace](../src/lib/workspaceLiveness.js#L29) takes FOR KEY SHARE;
it blocks deletion but allows concurrent writers. Worker concurrency:1 is per
worker and does not serialize other instances/manual requests. Proposed scope
locks/unique keys/sealing must handle these paths explicitly. No global/provider
lock or long transaction around network fetch is recommended.

Concurrent logical refreshes and their per-level attempts retain separate
refreshIds and levelAttemptIds, even with identical windows or snapshotDate.
Retry selection cannot cross parent scope or alter a sealed refresh. Conflicting
materializations are detected/reconciled under scope locking; immutable observation
content remains distinguishable and no failed attempt is upgraded in place.
Latest committed does not automatically mean freshest measured evidence.
Use existing period/freshness ordering and an approved deterministic observation
tie-break; never complete a cohort by stitching races together. CAS-sealed receipts
and an evaluation manifest prevent a late failure from erasing another attempt's
committed completeness. Define a total lock order and test retries/deadlocks.

Workspace deletion must cascade all new ledger records and prevent resurrection
by in-flight requests; use the existing lifecycle lock order and parent FK rules.
Rollback deployment should disable new consumption first and preserve captured
lineage, with no destructive rollback migration or historical relabelling. Going
back to old readers reintroduces the current relative-completeness hazard; it is
not a safe production rollback merely because ingestion still boots.

## 5. Acceptance scenario matrix — proposed technical behavior

**A** below means the individual evidence independently meets structural, existing
freshness, measured-field and approved source-provenance requirements. **C** means
the exact applicable cohort is provably complete, coherently committed and still
qualifies; existing relative candidate thresholds must also pass. No new tests
were executed for these future scenarios.

| Scenario | Absolute evaluation | Relative evaluation | Retained evidence | Public absence/refusal meaning |
|---|---|---|---|---|
| Positively evidenced applicable cohort, exhausted Insights and fully reconciled commit/evaluation | A observations qualify individually | Allowed only when C, partition metadata and full consumer coverage are proven | Logical refresh and distinct per-level attempts; seal source/observation/membership references | Known measurements and proven declared membership, not campaigns outside scope |
| Insights exhausted, no independent applicable-membership proof | Returned committed A observations can qualify | Refuse UNKNOWN cohort, regardless of counts or HTTP success | Keep traversal receipt; capture manifest remains membership UNKNOWN | Insights traversal finished; applicable cohort coverage unproved |
| Campaign MAX_PAGES after valid rows | A collected and committed observations can qualify | Refuse this incomplete manifest | Keep genuine new observations and older evidence separately | Known partial population; not complete and not empty |
| Campaign canonical fetch fails, other levels succeed | Only independently qualifying historical campaign observations; other levels retain their own facts | Refuse failed campaign attempt; an earlier C manifest may qualify as an earlier cohort | No new campaign measurements fabricated from ad/ad-set success | Could not read campaign scope; not NO_DATA |
| Failed campaign attempt then successful retry under an open logical refresh | A from the new committed attempt may qualify | Only the whole selected retry with positive membership/reconciliation can establish C | Distinct levelAttemptIds and retry link; immutable failed predecessor; freeze retry selection | Earlier attempt failed, selected retry succeeded; never rewrite the failure |
| All three level attempts throw | No new A; historical A stays independently qualified | No C from failed refresh; earlier coherent C reuse only under original rules | Three sealed failure receipts and terminal refresh dispositions survive aggregate throw | Failed refresh, not three complete empty levels |
| Crash before terminal receipt or refresh selection sealing | Only previously committed, independently qualified A | No C inferred from unsealed facts | Retain open/unknown identities; never synthesize terminal success | Outcome unknown, distinct from an observed provider failure |
| Ad-set/ad fails, campaign complete | Campaign A observations qualify | Campaign comparison allowed if C; failed other level is not a campaign veto | Preserve each level's distinct receipts | Campaign evidence available; drill-down level failure explained separately |
| Earlier complete, then failed refresh | Reuse earlier A with original times | Earlier C may be reused only coherently while freshness/scope still qualify | Keep earlier receipt and separate later failure | Earlier qualified evidence, latest refresh failed; never newly refreshed |
| Earlier incomplete, then complete refresh | New A qualifies; legitimate old observations remain historical | New C can permit relative judgments | Append new manifest; never upgrade old incomplete receipt | Current proved cohort; prior partial history preserved |
| Legacy snapshot, no fetch lineage | Conditional A; missing fetch receipt alone is not unrelated-campaign invalidation. Unprovable required row provenance must be refused under an approved predicate | Refuse UNKNOWN cohort | Leave legacy rows/lineage unknown; no synthetic completion backfill | Completeness unrecorded; distinguish from read failure and measured zero |
| Two concurrent workspace refreshes | Use a consistent selected A observation, original identity/time | One coherent C manifest set; never a union of the races | Separate refreshIds and child levelAttemptIds; frozen per-refresh selection and observation versions | State the selected evidence basis; ambiguous lineage is unknown |
| Successful fragments from different attempts/refreshes appear to cover missing pages | A may use each genuine committed observation under its original lineage | Refuse a fabricated union; complete traversal/membership must belong to the selected whole attempt or an original earlier C manifest | Retain separate receipts; never transfer exhaustion flags or fill a failed attempt's gaps | Combined fragments are not a proved complete cohort |
| Provider success then snapshot transaction fails | No A from uncommitted rows; earlier A may qualify | New source-complete receipt does not permit relative evaluation; earlier C reuse only under the same rules | Roll back new metrics/observations/manifest; retain source/commit failure facts | Data read but not committed; not successful refresh or empty account |
| Relative ranking invoked with INCOMPLETE/UNKNOWN cohort | Preserve independently qualified absolute assessment | Refuse ranking/relative KILL-SCALE adjustment | Keep absolute input and refusal basis | Relative comparison unavailable; do not replace it with HOLD/KILL or NO_CANONICAL_WINDOW |
| Empty exhausted Insights response | No new per-campaign A observation; old A only under its own reuse rules | UNKNOWN membership unless positive evidence proves applicable set empty; then no candidates and no relative judgment | Seal traversal facts; empty cohort only with membership proof; no zero snapshots | No returned Insights is not by itself proof of an empty applicable cohort |
| Exhausted Insights but take:200 coverage is unproved | Returned A rows can qualify | Refuse UNKNOWN evaluation coverage; fewer/exactly 200 IDs and matching counts do not establish C | Keep traversal proof and bounded-query facts, not a completion inference | Evaluated membership coverage unproved despite provider success |
| take:200 or another filter demonstrably omits applicable members | Returned A rows can qualify | Refuse INCOMPLETE coverage until every member/disposition is reconciled | Preserve positive membership proof and named omissions | Known incomplete evaluation, distinct from unknown universe |
| Membership artifact exists but contains unmatched/ambiguous members or Insights extras | Independently qualified A remains usable | Refuse: UNKNOWN for unproved dispositions; INCOMPLETE for known omissions | Retain M/I/O/E identity-level differences, exclusion evidence and classification uncertainty | Roster existence or equal counts is not completed reconciliation |
| Missing/contradictory provider dates or wrong account binding | Only independently qualifying A; record/request fallback cannot cure unknown source period | Refuse comparison that relies on unverifiable members/window | Keep original source facts, no repaired dates | Evidence provenance missing/mismatched, not verified complete |
| Workspace deleted during fetch | Refuse new writes/evaluation in deleted scope | Refuse | Lifecycle cascade; in-flight write cannot recreate tenant/lineage | Existing NoWorkspace/WorkspaceUnavailable distinction, no cross-tenant fallback |

## 6. What the current schema cannot establish

It can record metric values, declared periods, platform source/currency provenance,
sync timestamps and current entities. It cannot prove a durable canonical fetch
identity, per-level cursor exhaustion, the applicable campaign set as fetched,
configured source account at observation, raw-date presence, atomic association
between a provider attempt and committed observations, or historical evaluated
cohort membership. It cannot reconstruct overwritten values from a stable
MetricSnapshot.id, nor recover full relative-decision provenance from an enum and
best-effort evidenceReference. No retrospective COMPLETE inference is safe.

Historical fetch UNKNOWN does not automatically mean every old absolute assessment
is false. Qualification depends on what its own retained provenance can actually
prove. Requiring new lineage to label a cohort complete and deciding acceptable
individual legacy provenance are different questions.

## 7. Migration, API, persisted-decision and security impact — PROPOSED

- **Migration:** new ledger tables, workspace/account ownership constraints,
  immutable/sealed identities and indexes need a separately approved additive
  migration and measured lock/storage plan. Do not change the non-daily partial
  index, DAILY identity or MetricSnapshot.date semantics. Legacy linkage stays
  absent/UNKNOWN; no completeness backfill. Retention must preserve references
  needed by Decisions/learning; only workspace deletion cascades unconditionally.
- **Storage:** scope manifests and immutable projections add volume proportional
  to observed rows, not merely sync count. Decide compression/partitioning,
  retention and lawful deletion before rollout. A hash alone cannot reconstruct
  overwritten measurements or prove missing membership; no raw secret-bearing
  provider payload retention is proposed.
- **Consumers/API:** preserve existing arrays, operational/daily contracts and
  frontend. Capture-only must not add API fields. Later consumption requires
  runtime/client contracts for absolute result, cohort proof/refusal and original
  measurement references, so relative absence is not misrepresented as failed
  individual evidence. No frontend design or Direct Meta AI Analysis change here.
- **Decisions:** current dedup checks verdict equality, not provenance or
  absolute/relative basis. A new assessment with the same enum need not create a
  new Decision. Relative/absolute changes with the same enum are unrecorded today;
  suppressing relative adjustments can create a different enum and supersede an
  existing proposal. The stale-prune path can also supersede dropped eligible
  entities. Decide these impacts explicitly, preserve THEN reasoning and executed
  histories, and version/freeze any future evidence reference. Current best-effort
  null evidenceReference cannot be treated as durable relative authorization.
- **Concurrency/read consistency:** new observation receipt and materialization
  writes must agree atomically. Read-only shadow evaluation and write-enabled
  evaluation need the same snapshot of lineage. A policy switch hidden in the
  writer or a second evaluation would break the existing R8 single-evaluation
  contract (distinct from Constitution R-8).
- **Security:** enforce workspace and provider account binding server-side;
  reuse parent-deletion protections without treating liveness as authorization.
  Validate all tenant joins, redact provider errors/cursors/tokens, bound receipt
  payloads, and keep read/export access under current workspace/role guards.
- **Production:** no deployment mutation occurs in 02A. Render Web and Worker
  auto-deploy master; even this documentation PR requires deliberate deployment-
  impact review before merge. Later staged capture/consumption needs a separately
  approved two-service deployment/rollback plan. Hosted CI remains separate from
  static documentation verification; no production readiness or Gate B/C claim.

## 8. Proposed bounded implementation sequence — no slice authorized here

1. **02B, recommended first: provenance capture only.** After explicit schema/
   contract approval, add the workspace-scoped attempt/level/immutable-observation/
   population ledger and atomic canonical binding. Capture all three existing
   Meta canonical levels, scope/period evidence and write reconciliation. No new
   provider request, ranking/eligibility/API/Decision change or backfill. RED/GREEN
   must cover same-key restatement, unknown legacy, write failure, deletion,
   duplicate/partial receipts and concurrent syncs. This is one bounded proposal;
   migration may need a separately reviewed additive-first PR before wiring.
2. **02C, lineage reader and shadow evaluation.** Reconcile full campaign membership
   and current take:200 boundary without changing published verdicts. Produce
   internal absolute/cohort qualification results and measure parity/unknowns.
   Approve source/legacy qualification and scope/window reuse decisions first.
3. **02D, read/API eligibility and ranking consumption.** Separately approve the
   versioned contract/refusal mapping and apply the approved cohort rule while
   preserving qualifying absolute assessments. Explicitly resolve shared agentic
   evaluation so publication changes cannot silently flow into persistence.
4. **02E, persisted Decision/learning effects and controlled rollout.** Approve
   basis identity, dedup/supersession, immutable decision references and rollout/
   rollback separately. Do not reinterpret or rewrite existing Decision history.

Each slice requires fresh discovery, bounded RED/GREEN with complete provider
mocks and networkGuard, isolated migrated PostgreSQL where relevant, immutable
review head and hosted CI or a newly approved scoped exception. No automatic merge.

## 9. Open technical decisions for Product Owner approval

These do not reopen the approved five principles. They define safe implementation:

1. Approve the ledger/immutable-projection design and additive migration scope;
   storage budget, retention, indexes and lock strategy remain unimplemented.
2. Define acceptable individual source provenance, including legacy rows and
   requested-window fallback. Recommend retaining conditional legacy absolute
   eligibility where its own facts qualify, never treating missing fetch lineage
   as cohort completeness and never assuming unrecorded provider date proof.
3. Define the applicable relative scope: current awareness/conversion groups,
   configured accounts/platforms and comparison-window compatibility. Recommend
   preserving grouping rules and requiring exhaustive applicable source coverage;
   no implicit comparison against only the successful account subset.
4. Approve coherent prior-complete-manifest reuse after failed/partial refresh
   under original freshness and unchanged scope; determine account-set change,
   ambiguous classification and deterministic same-period tie behavior.
5. Approve how proven exclusions, duplicate rows, missing field/partition proof
   and the 200-identity limit affect evaluated membership. Do not waive omissions
   by simply calling the provider read complete.
6. Approve public refusal/provenance mapping and any shared runtime/client
   contract extension before new API fields or product tokens appear.
7. Approve persisted assessment-basis identity, unchanged-enum handling and
   supersession behavior; no implicit rewrite of recorded/executed decisions.
8. Approve a bounded 02B implementation brief, independent review gates and the
   separate deployment-impact plan. Policy approval alone authorizes none of these.

## 10. Verification and review request

This task uses source inspection, fresh GitHub metadata, content comparison,
documentation diff/link/anchor checks and documentation-scope assertions. No
runtime/provider/database verification is claimed; acceptance scenarios are design
requirements, not executed tests. Commit-hook checks, if run, are reported
separately and are not schema/concurrency/behavior proof.

Request independent review of this documentation-only head against the pinned
master: verify source/identity citations and loss points, attempt/observation versus
mutable snapshot binding, full cohort membership and history semantics, vocabulary,
transaction/deletion ordering and persisted-decision risks. Request separate
Product Owner approval of technical decisions and the first implementation slice.
**Stop at Draft PR. No merge, deploy, implementation or Gate B/C advancement.**

**02B-0 preflight:** [The proposed minimal capture schema and approval package](BACKEND_STABILIZATION_02B0_TECHNICAL_PREFLIGHT.md)
further specifies storage, atomicity, retention and deployment safety. It is a
technical proposal only; no 02B implementation, migration or gate approval follows.
