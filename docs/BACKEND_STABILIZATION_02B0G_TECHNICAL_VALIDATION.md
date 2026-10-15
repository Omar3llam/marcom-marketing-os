# Backend Stabilization 02B-0G — isolated technical validation

2026-10-15. Supplement to [02B-0](BACKEND_STABILIZATION_02B0_TECHNICAL_PREFLIGHT.md).
**Documentation only; implementation recommendation awaiting independent review
and explicit 02B-1 authorization.** Four tables are approved in principle, not
implemented in the application. The five [02A principles](BACKEND_STABILIZATION_02A_CANONICAL_PROVENANCE.md#1-approved-canonical-completeness-ruling)
and Constitution R-8 are unchanged. Capture-v1 membership remains **UNKNOWN**.
Backend Gates B/C remain **BLOCKED**.

## 1. Baseline, authority and evidence boundary

Fresh fetch: master `b3da053becb4ac1e89bf040eb251eaaf73e4065c`; existing Draft
PR #577 head before this amendment `cd8aed8c288929c0892da4c2981a8803284d1271`.
Only open PR: #577, based on master. The existing worktree was clean; unrelated
primary-checkout work was preserved. Read [independent review](https://github.com/Omar3llam/marcom-marketing-os/pull/577#issuecomment-6188143120),
02A/02B-0, CLAUDE.md, Product Truth Rulings, REVIEW_GATE, schema/migrations,
non-daily writer, workspace liveness, credential lifecycle and deletion paths.
No material trunk drift. The previously disclosed Phase 9 roadmap discrepancy
remains unresolved; this task grants no phase or deployment approval.

At reviewed head, Tests38707016196 / Architecture38707016057 have four failed
hosted jobs, zero steps; payment/spending restrictions prevented execution.
CodeRabbit's success context says draft review skipped, not independent approval.
New-head CI is reported separately in the PR; no exception is authorized/requested.

All SQL, scratch Prisma models/migrations and logs live **outside the application
tree**, under the task artifact directory `canonical-provenance-02b0g-lab`.
Evidence bundle: `LUMI_02B0G_EVIDENCE.zip`, supplied with this amendment. It contains
`prototype.sql`, `run.cjs`, `compat.cjs`, `reproduce.ps1`, raw outputs and catalog
snapshots. The SQL is an experimental fixture, **not migration SQL for adoption**.
The actual implementation must satisfy the complete specification below.
Bundle SHA-256: `a5e197fe4bb1fc38df5eb91d0bfb2dacab0c7377fba44ca18ab8a880416ee36f`.
It is delivered as a local task artifact, not a GitHub-hosted download; independent
reviewers need that bundle to reproduce the executable evidence.

Environment: PostgreSQL **18.4**, x86_64 Windows / msvc-19.44.35226; Node
**24.20.0**, Prisma CLI **5.22.0**, postgres driver **3.4.9**; READ COMMITTED,
server timezone Africa/Cairo. Dedicated local cluster bound to `127.0.0.1:55431`;
fresh ephemeral databases `lumi_02b0g_main`, `lumi_02b0g_replay` and
`lumi_02b0g_shadow`. All 75 application migrations from the pinned master were
applied before the prototype. No production connection, credential contents,
provider request or existing application data was used.

`g_binding` and `g_entity` are labelled synthetic ownership fixtures. A temporary
`g_future_pin` tests a future restrictive reference; it is not a fifth proposed
capture table or a Decision change. SQL uses the actual migrated workspaces and
metric_snapshots tables, including the unchanged partial non-daily identity.
The existing application writer, credential routes and provider SDK were not run.

## 2. Reproduction and actual results

From the external lab directory, with pinned Node and cached dependencies:

```powershell
$env:DATABASE_URL='postgresql://slice01@127.0.0.1:55431/lumi_02b0g_replay'
$env:DIRECT_URL=$env:DATABASE_URL
node <prisma-cli>/build/index.js migrate deploy --schema ./prisma/schema.prisma
# External copy: 75 baseline migrations + one temporary prototype fixture.
# A second migrate deploy: No pending migrations to apply.
# Clone the clean replay database to lumi_02b0g_main before injecting drift.
node ./run.cjs
node ./compat.cjs
```

Exact paths, command arguments, stdout/stderr, database checks and exit statuses
are in the bundle. `reproduce.ps1` extracts `prisma/` with `git archive` at b3da,
creates a **new** local cluster/output directory, installs the scratch migration,
runs both runners, and stops its own cluster. It accepts repository, dependencies,
Node, PostgreSQL binaries, external output directory and unused loopback port;
never point it at a deployment or existing database. No network installation is
part of the runner. Times/UUIDs/catalog hashes vary between fresh clusters.

Final primary SQL runner: **31 PASS, 0 FAIL, 0 skipped** scenario groups. This is
not 31 application tests or a full backend-suite pass. Prisma experiment: six
CLI invocations, five exit0 and one expected exit1/P1012; two additional assertions
(native catalog drift detection and transactional DDL rollback) passed. Clean
scratch `migrate deploy` and repeat deploy both exit0. Earlier harness failures
are retained separately. The corrected reproduction script also ran against a
newly initialized cluster on loopback55433: **31 PASS, 0 FAIL**, same Prisma
compatibility outcomes, cluster stopped. Its separate raw logs are in the bundle.
An earlier Windows startup/redirection hang was corrected before this reproduction;
that earlier cluster was stopped without using it as passing evidence. Other
earlier harness failures
include PL/pgSQL heterogeneous-record field access, driver JSON
double encoding, lazy queries not dispatched before barriers, fixture aging with
pending deferred triggers, and initial role/bootstrap setup. They were corrected
in external lab files; they are not application defects or hidden passing runs.

Documentation checks:3 documents,56 local links/line bounds/anchors,1 balanced
Mermaid block, whitespace and protected-path comparison against reviewed head:
PASS. Application backend/frontend suites, API/worker smoke and provider mocks
were not run: this amendment changes documents only and exercises SQL directly.

### T1 — retention: PASS for isolated mechanisms; recommendation requires approval

| Actual test | Observed result |
|---|---|
| NULL/30-day deadline, including caller-backdated created_at | 23502/23514; T0 timestamp is stamped by DB, not trusted from caller. |
| Ordinary deadline extension, maintenance function call, early/ordinary DELETE | 42501. Maintenance extension succeeds; shortening rejects. |
| Expired retry ancestor with retained descendant | 23503 at COMMIT; no ancestor disappearance. Whole set including an unexpired member rejects42501. |
| All expired dependency roots, source/write retry edges and selection cycles | Whole graph deletion succeeds; observations disappear through CASCADE. |
| Future restrictive pin | Retention DELETE rejects23503; workspace CASCADE removes the pinned graph despite its retention rule. |
| Sealed observation direct deletion while root exists | 42501 from deletion guard. App has no ledger DELETE privilege. |
| Late source/write seal on an artificially aged root | Restricted app seal succeeds; privileged trigger extends root floor by at least90 days from DB seal. |
| Extension followed by deliberate transaction failure | 22012 and ROLLBACK; extension does not survive. |

Aging fixtures uses owner-only guard disable/update/re-enable with deferred events
flushed before ALTER TABLE. This simulates elapsed deadlines, not a 90-day soak or
an authorized production operation. Trusted owners can bypass guards by design.

**Recommended deterministic rule:** universal **90 days**, regardless of outcome.
At T0 stamp created_at from DB time and require retain_until >= T0+90days.
Every subsequent root selection seal, level/write admission, source seal, plan
seal and write outcome must atomically extend the root to
`max(old retain_until, DB event time + 90 days)`. Use a narrow trigger-owned
extension, not a caller-selected deadline or a grant allowing app retention edits.
This makes the clock explicit and protects late successful evidence. Observations
share their atomic write-seal clock; individual observation insertion does not
need a separate retention update. A late nonselected failure also extends retention.
Never shorten a deadline after learning that a graph failed.

Compared alternative: T0+30 days, then authorized extension to >=success+90 in
the SAME successful commit, with purge/admission exclusion. SQL extension rollback
is feasible (tested), but the complete 30-day admission/success authorization
protocol was **NOT_TESTED** and is not recommended. It introduces an additional
outcome-dependent deletion boundary and privilege surface. Universal90 already
satisfies the proposed failed/unknown30-day *minimum* without interpreting an
open receipt as permanently failed. Neither choice authorizes pruning.

Storage consequence: isolated failed/unknown graphs with no later event/dependency
have a 90-day instead of30-day floor: **3x their time-based retained population**
at steady rate, not 3x the whole ledger. Added storage is approximately
`60 × failed graphs/day × bytes/failed graph`. Late events, retries/pins and
retained ancestors can extend beyond90 days; the original illustrative90-day
model is not an upper bound or a capacity approval.

Deletion invariants for a later approved maintenance operation:

1. Acquire workspace **FOR UPDATE first**, then deterministic root locks. This
   excludes admission/event/commit protocols while calculating a dependency set.
2. Only a separate maintenance principal may delete eligible whole roots. Every
   member must be due; no retained inbound retry or consumer pin may remain.
   Deferred NO ACTION FKs are the final protection if the calculation is wrong.
3. Root delete guard permits workspace cascade when the parent is already absent,
   otherwise requires maintenance authority and a due deadline. Child guards
   require absent root; no pg_trigger_depth or caller-set authorization flag.
4. Pending work is UNKNOWN; do not introduce a pruning scheduler or abandoned-work
   classification now. Later pruning needs explicit pending-attempt handling,
   bounded reviewed batches, audit evidence and concurrency tests.
5. Future Decision/learning references require same-workspace restrictive FKs or
   durable pins **before use**. Existing JSON references do not qualify. Workspace
   deletion overrides retention, using the existing authorized credential purge
   and parent deletion transaction; this lab did not call those routes.

### T2 — PostgreSQL/Prisma: PASS with representation/ownership corrections

| Actual test | Result / meaning |
|---|---|
| Four table composite PKs/FKs, six deferred selection/retry FKs | PASS: native PostgreSQL accepts and enforces them. Wrong-workspace root retry/selection/write and wrong entity ownership reject. |
| Nonterminal/wrong-parent selection; retry ordinal/level | PASS: rejected at trigger/FK boundary; receipt cannot be resealed and admission stops after selection. |
| Manifest exact observation ID set, open/failed write without observations, mandatory UNKNOWN | PASS: COMMIT mismatch rejects; metrics and observations roll back together. COMPLETE rejects. |
| Observation immutable; no insert after write seal | PASS. Insert requires open W under its row lock; deferred O check requires terminal COMMITTED W. |
| Workspace cascade, retention graph cascade, restrictive future pin | PASS as specified in T1; no SET NULL rewrite. Actual PG18 trigger visibility supports absent-parent guards. |
| Restricted app positive admission/seal/commit | PASS; trigger invocation still works after PUBLIC function EXECUTE is revoked. |
| Real non-superuser login inheriting app role | PASS: cannot SET ROLE maintenance, ALTER guards or TRUNCATE ledger. A temp shadow binding does not bypass fully qualified lookup. |
| Clean scratch migrate deploy / repeat / DDL transaction rollback | PASS:76 migrations, then no pending migrations; intentional22012 leaves no probe table. |
| Raw introspection representation | **FAIL as generated**: P1012, three invalid one-to-one relations. |
| Corrected inverse-list representation | PASS: prisma validate exit0; DB→model migrate diff reports empty migration. |
| Native drift detection by Prisma alone | **FAIL**: empty migration after four native safeguards were damaged. Catalog comparator detects changes. |

**Prisma correction:** keep the root's three optional composite selection
relations, and represent each inverse on CanonicalLevelAttempt as a **list**
with the matching named relation. This is a representational accommodation;
native PK/FKs still determine actual cardinality. Do not add redundant root
`@@unique([workspace_id,id,selected_*_id])` indexes to satisfy introspection.
Raw db pull is an inspection artifact; never overwrite the reviewed model blindly.

**Ownership contract:** Prisma models own the representable columns, PKs, unique
keys, ordinary indexes and relation declarations. Reviewed native DDL owns
DEFERRABLE/INITIALLY DEFERRED, CHECKs, immutable/deferred/retention triggers,
functions, role grants and their verification. One reviewed SQL migration is
the installation authority for both; schema-only diff is not that authority.
Retain the existing native partial MetricSnapshot index unchanged.

The drift experiment independently altered selection_campaign to NOT DEFERRABLE,
dropped the root version CHECK and observation immutable trigger, and revoked
app observation SELECT. `migrate diff --from-migrations ... --to-url ...
--shadow-database-url ... --script` still returned `-- This is an empty migration.`
before AND after. Require catalog assertions for exact FK definitions/actions/
deferral, indexes/predicates, CHECKs, trigger definitions/enabled state, function
definitions/owners/SECURITY DEFINER/search_path and grants. Test that each assertion
fails after deliberate damage. Plain migrate status also is not a catalog audit.

Role contract: migration principal can create/reference tables and install/own
reviewed functions/triggers, with DBA provisioning roles separately where needed.
Runtime must not own tables/functions, be superuser, inherit maintenance roles,
or have ALTER/TRUNCATE/ledger DELETE/retention UPDATE powers. Invoker validators
need bounded read/lock permissions. Trigger-only retention extension uses a
NOLOGIN least-privilege owner with only necessary SELECT and retain_until UPDATE;
fixed `search_path=pg_catalog`, all relations qualified, PUBLIC EXECUTE revoked,
no dynamic identifiers/caller flags. Broader maintenance parent locks are separate
from this trigger owner in the real migration. The lab maintenance role combines
those privileges for testing; do not copy its grants wholesale.

Composite FKs reject cross-tenant *references*. A shared application DB role is
not per-request tenant authorization and this proposal adds no RLS. Real vault
binding attestation, account/entity graph traversal and existing route authorization
must still be wired/tested later. Production engine/version/role privileges remain
UNKNOWN; superuser scratch migration success does not establish deploy privileges.

### T3 — concurrency: PASS for listed SQL interleavings; runtime/capacity gates remain

All blocking interleavings dispatch the competing query and use
`pg_blocking_pids(waiter)` as an explicit barrier before releasing the holder.
No sleep establishes ordering. Deadlock and lock timeouts are database mechanisms,
not scheduling assumptions. Independent connections use READ COMMITTED.

| Actual interleaving | Result |
|---|---|
| NO KEY UPDATE vs NO KEY UPDATE on same workspace | Second captured equivalent writer waits; both same-key commits eventually preserve distinct observations401/402 under one mutable snapshot UUID. |
| NO KEY UPDATE vs KEY SHARE; KEY SHARE vs KEY SHARE | Both compatible; KEY SHARE alone does not serialize current writers. |
| Admission KEY SHARE vs workspace DELETE | Delete waits; after admission commits, cascade removes graph. New admission rejects23503; no resurrection. |
| Workspace DELETE first vs captured commit parent lock | Commit lock waits, then returns no live parent; must refuse commit. Actual application liveness refusal not wired. |
| Captured write vs legacy key-share writer | Legacy upsert waits on metric row, preserves UUID and changes current101→202; next capture303 preserves observations101/303. Legacy202 has no ledger observation. |
| Root-serialized failed source + retry source sealing | Second waits; immutable selection cannot be resealed. Late unselected receipt can seal without rewriting frozen root selection. |
| Actual response loss after server COMMIT | Loopback protocol proxy discards COMMIT CommandComplete response and closes socket; client CONNECTION_CLOSED, independent read finds COMMITTED by durable write ID. |
| Contending lock with candidate200ms lock_timeout | 55P03; observed206.229ms in primary run; transaction aborts, no success receipt. Not the proposed production2s setting. |
| Deliberately reversed two-workspace order | One40P01 deadlock victim; other proceeds after abort; rollback required. This does not certify absence of other deadlocks. |

One manifest-set aggregate per write seal plus indexed per-observation terminal-
write checks is the recommended validator structure. Re-reading/aggregating the
entire manifest for every observation would create quadratic work; the prototype
avoids it. Full source/observation hash-set validation must use bounded set joins,
not repeated whole-graph JSON scans. No changed business retry/recovery policy.

#### Labelled synthetic measurements — not approved benchmarks

One transaction per N, one local connection, no deliberate contention during bulk
measurement. Timing spans BEGIN through COMMIT, including parent lock and trigger
checks; excludes subsequent size queries. It inserts synthetic observations and
seals a simplified manifest, **not N actual metric upserts or production hashes**.
Each row has a small projection and the same2048-character random base64 source
fixture field; compressibility/shape are not representative of production.

| N | Transaction ms | JSON p50 / p95 bytes | Mean tuple bytes | Manifest JSON bytes |
|---|---:|---:|---:|---:|
| 100 | 13.513 | 2141 / 2141 | 2385 | 4021 |
| 1000 | 78.448 | 2141 / 2141 | 2385 | 39121 |
| 6200 | 522.860 | 2141 / 2141 | 2385 | 241921 |
| 35000 | 3734.462 | 2141 / 2141 | 2385 | 1365121 |

Manifest contains observation IDs plus UNKNOWN envelope; full source ID/hash/
exclusion lists will be larger. No claim that16KiB/observation or8MiB/manifest is
validated, enforceable or approved from these fixtures. One sample per N cannot
produce transaction p95, sustainable throughput or a safe timeout.

After the complete primary run, observation heap14,450,688 bytes, indexes11,501,568,
total143,450,112 including TOAST/FSM/VM; all four ledger totals145,530,880 bytes.
These include small functional fixtures/aborted-tuple overhead, not just bulk rows,
and exclude WAL, replicas/backups and long-running bloat. `pg_total_relation_size`
includes indexes/TOAST; do not add them again. The original2/4/8KiB sensitivity
model remains illustrative. Runtime budgets need real allowed payloads and rates.

## 3. Revised minimal 02B-1 specification and later gates

Recommend one **additive schema-only** slice, only after explicit authorization:

1. Keep the four tables, column/PK/unique/composite FK inventory in02B-0; preserve
   all failure boundaries and mandatory UNKNOWN/null membership fields. No enums,
   backfill, snapshot key change, reader, Decision, provider or feature flag wiring.
2. Apply the inverse-list Prisma representation and native-DDL ownership above.
   Explicitly transactional migration, exact named objects, clean/current baseline
   replay, repeat-deploy and failed-DDL recovery tests. No db push or unreviewed
   generated migration that drops/recreates native safeguards.
3. DB-stamp admission/seal events; universal event+90-day floor with narrow atomic
   extension triggers. Maintenance extension separately authorized, shortening
   forbidden. No automated pruning, capture activation or new Decision pins.
4. Implement ALL scope/descriptor/receipt/plan/outcome/manifest JSON shape and
   immutability requirements from02B-0. Deferred validators read final rows, never
   stale queued NEW images; skip already-cascaded roots. Exact selected source/
   level/hash/identity/window/observation/exclusion reconciliation remains required.
   Keep once-only seals and late nonselected receipts without changing dispositions.
5. O inserts require locked open W, post-seal inserts reject, O immutable thereafter;
   deferred O terminal check plus once-per-W full set validator closes both open-
   write and mismatch holes without quadratic aggregation. Never silently omit a
   source/observation to fit a ceiling.
6. Verify full graph/credential ownership using actual migrated fixtures, each
   column's immutability/replay, all native drift assertions and least-privilege
   login behavior. The lab's abbreviated JSON/disposition/projection and synthetic
   graph checks are NOT substitutes for those implementation tests.

Explicit **NOT_TESTED / later gates**, not technical proof from a toy runtime:

| Gate | Required evidence / owner decision |
|---|---|
| 02B-1 exact migration | Complete JSON/hash-set/allowlist validators, actual account graph/vault schema and restricted migrator grants; engine compatibility. Native primitives are feasible, final DDL still requires review/tests. |
| 02B-2 capture wiring | Real manual/worker paths and T0–T7 ordering, source/normalization failure receipts, orphan/zero-shadow/duplicate guards, both rollback directions, payload hash canonicalization, no-network mocks. |
| 02B-2 failure recovery | Arbitrary disconnect/crash before/after WAL commit, runtime acknowledgment reconciliation/idempotent replay, total Prisma transaction/statement budgets; proxy proves only one post-commit loss point. |
| Mixed binaries | Legacy writers do not take the new serialization lock. Exact projections survive tested restatement; business guard/entity graph races and unrelated non-key workspace update latency remain NOT_TESTED. |
| Capacity/activation | Full projection/manifest bytes, hashing/upserts, p95 under contention, WAL/bloat, realistic rates, approved payload/timeout/storage/stop limits and future retention operator. |
| Canonical eligibility | Positive membership authority/reconciliation,200-reader cap, individual lineage qualification, coherent historical cohort reuse, relative eligibility and Decision references/dedup: separate approvals. Capture-v1 remains UNKNOWN. |

## 4. Production prerequisites, rollback and independent review matrix

Production DB version, migration-owner/grants, disk/WAL/backup headroom and actual
Render configuration remain uninspected. Before any merge, approve a separate
deployment plan: both Web and Worker currently auto-deploy master, including docs.
For schema deployment, use one controlled migration owner, measured DDL lock budget,
verified history/catalog backup/recovery, default-off compatible binaries and an
explicit two-service rollout/activation plan. DDL workspace-FK locks may contend;
the lab does not prove zero downtime. No CI exception is requested here.

Rollback preserves additive tables and immutable evidence; disable capture in both
services and account for in-flight commits before binary rollback. No DROP/down
migration or provenance relabelling. This amendment itself changes no runtime;
schema installation/capture are still absent from the application.

| Independent reviewer check | Evidence / requested decision |
|---|---|
| Baseline and authority | b3da/cd8, review comment, docs-only diff; five principles/R-8 unchanged. |
| T1 | Review universal event+90-day clock, storage premium, dependency/pin guards and tenant override. Approve recommendation or specify another bounded rule. |
| T2 | Reproduce Prisma raw FAIL/corrected PASS and blind native drift; inspect trigger/role/cascade proof and required full-validator work. |
| T3 | Inspect dispatched-query barriers, real proxy fault and exact measurement limits; no recovery or capacity certification inferred. |
| 02B-1 readiness | Accept corrected specification subject to explicit implementation brief and isolated exact-migration verification. No implementation authorization from this document. |
| Delivery | Same Draft #577, new immutable head recorded in PR, hosted status separate, no merge/deploy/CI exception/Gate B/C closure. |

**Stop at amended Draft PR #577. Independent re-review requested. Explicit 02B-1
implementation authorization remains required.**
