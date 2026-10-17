# Backend Stabilization 02B-1 — additive canonical provenance schema

2026-10-15. Reference master `9b48f32826e03f7e11b7a15054df05d67001f834`.
**Authorized schema implementation; Draft PR / independent source review only.**
No production migration, merge, deployment, capture writer/activation, provider
request, eligibility/ranking/API/Decision/frontend change or CI exception.
The five [02A principles](BACKEND_STABILIZATION_02A_CANONICAL_PROVENANCE.md#1-approved-canonical-completeness-ruling)
and Constitution R-8 are unchanged. Capture-v1 membership is always **UNKNOWN**.
Backend Gates B/C remain **BLOCKED**.

## 1. Baseline and authority

Fresh origin/master matched the reference; no open PRs. Merged #576/#577 content
was checked on trunk, not inferred from ancestry. The #577 raw-evidence
[review follow-up](https://github.com/Omar3llam/marcom-marketing-os/pull/577#issuecomment-6189018760)
accepted prototype feasibility with explicit limits. The supplied 02B-1 instruction
now approves the four tables, universal event+90-day retention, native DDL/Prisma
representation, future workspace serialization and this schema-only implementation.
It does not approve capture wiring or deployment.

Read current 02A, [02B-0](BACKEND_STABILIZATION_02B0_TECHNICAL_PREFLIGHT.md),
[02B-0G](BACKEND_STABILIZATION_02B0G_TECHNICAL_VALIDATION.md), CLAUDE.md, Product
Truth Rulings/REVIEW_GATE, schema/migrations, credential/workspace/entity lifecycles
and the non-daily writer. No material authority conflict. The previously recorded
frontend roadmap discrepancy remains outside this slice. Unrelated primary
checkout files were preserved; implementation uses a clean branch from master.

Master CI Tests38714170689 / Architecture38714170774 failed before any job step.
New-head hosted status is reported separately in the PR. No historic CI exception
is transferred; local results do not constitute hosted verification.

## 2. Changed-file inventory

| File | Reason |
|---|---|
| [schema.prisma](../prisma/schema.prisma) | Four mapped models and Workspace inverse relation only; selected-attempt inverse lists preserve Prisma compatibility without redundant unique indexes. |
| [migration.sql](../prisma/migrations/20261015000000_canonical_provenance_v1/migration.sql) | One transactional additive installation authority: tables, composite/deferred FKs, checks, private functions/triggers and exact capability grants. |
| [native catalog manifest](../prisma/canonical-provenance-v1.catalog.json) | Reviewed expected columns/defaults/nullability, constraints, indexes, triggers, function hashes/owners/config/ACLs, schema/role/grant inventory and migration checksum. |
| [catalog verifier](../scripts/verify-canonical-provenance-catalog.js) | Explicit read-only audit; no ambient connection fallback or automatic expected-state regeneration. |
| [constraint integration suite](../src/tests/canonicalProvenance.integration.test.js) | 54 real PostgreSQL cases, including restricted logins, exact graph/projection/manifest rules, retention and explicit-barrier interleavings. |
| [migration integration suite](../src/tests/canonicalProvenanceMigration.integration.test.js) | Actual populated75→76 replay, injected real-migration rollback, repeat deployment, ORM reads and native audit under a non-superuser migrator. |
| [synthetic fixtures](../src/tests/canonicalProvenanceFixtures.js) | Complete v1 source/manifest/projection fixtures; no runtime/provider import. |
| [rollout declaration](../scripts/migrationCompatibility.baseline.json) | Explicit UNKNOWN declaration and rationale for native schema/dynamic ACL DDL; classifier remains unchanged. Not a CI exception or rollout approval. |
| [migration census](../src/tests/migrationCompatibility.test.js) | 75→76 migrations; UNKNOWN4→5, with explanatory delta. All classifier/assertion rules retained. |
| [DB verification census](../src/tests/verificationContract.test.js) | 43→45 DB-gated files; both new suites use the shared probe and physical full-verification databases. No probe/guard weakening. |
| This checkpoint | Implementation, evidence, limitations and required deployment/rollback review. |

## 3. Installed contract — dormant until separately approved wiring

Exactly four public tables: canonical_refreshes, canonical_level_attempts,
canonical_write_attempts, canonical_observations. No backfill, new persisted enum,
old column/default/index rewrite, Decision reference or historical relabelling.
The partial non-daily MetricSnapshot identity and UTC writer are untouched.
Nothing writes the ledger from the running application.

Admission identities are immutable; source receipts, root selection, normalized
plan and write outcome have separate once-only seals. Identical artifact replay
is a no-op; changed content under the same identity/hash rejects. Retention
metadata is not measurement freshness. Retry links cannot change, point forward
or cross the governed workspace/refresh/level boundaries. Root admission stops
after selection; late unselected source receipts preserve frozen dispositions.
Open attempts remain unknown; FAILED receipts cannot produce new observations.

### V1 JSON and committed observations

The migration defines required/optional keys and types for every envelope:
scope/account set/three level specifications/binding and origins; request fields/
params/configured pagination cap; source outcome/time/counters/IDs/presence/error;
root dispositions; raw date/metric presence, direct/derived origin and binding;
full snapshot projection with allowlisted attributes; manifest sources/observations/
actual counts/exclusions and mandatory UNKNOWN/null membership fields.
Unknown keys, partial groups and unsafe free-text error codes reject.
SDK-version provenance permits only OBSERVED or UNKNOWN (UNKNOWN requires null).
Non-finite SQL ratios and raw string action values cannot enter the v1 numeric
projection; rejecting them does not modify any existing metric row or calculation.

The existing configured cap50 and canonical parameter shape are recorded, not
new provider behavior. Missing/invalid raw dates stay explicitly missing/invalid
with null values. Null counters differ from measured zero. EXHAUSTED requires
positive traversal-end facts; CAPPED requires positive cap facts. Neither proves
applicable membership. A genuine empty response differs from failure and can
commit an empty manifest without creating a zero MetricSnapshot.

Each observation resolves the real Account→Campaign→AdSet→Ad workspace/channel/
account path under locks. The ACCOUNT exception is explicitly derived from the
campaign source and names committed campaign contributors. Foreign accounts or
unselected sources reject. Exact current SQL snapshot values are copied, including
all nullable fields; no lookup of today's graph can rewrite a stored observation.
Projection snapshot keys are frozen to the current evidence-column allowlist,
not automatically expanded when an unrelated column is added later.

Projection timestamps use PostgreSQL's timestamp-without-zone JSON representation
from `to_jsonb(metric_snapshots)`, preserving stored values; typed sync dates keep
the existing UTC contract. This does not turn source-local DATE labels into proven
UTC instants. A future capture writer must copy the DB projection, not silently
substitute differently formatted JavaScript Date strings.

One deferred set validator per write reconciles selected source IDs/hashes,
returned campaign identities, actual observation IDs/content hashes and per-level
counts, and unique source-row observation/exclusion accounting. It rechecks final
materialization, rejecting a same-transaction restatement after observation
insertion. Separate indexed per-observation checks reject open/failed parent
writes. No whole-manifest scan per observation or count-driven generate_series.
Unknown source identity/counts remain unknown rather than invented coverage.

Hash enforcement is the approved split: DB checks32-byte hashes, lowercase JSON
hash syntax, exact cross-reference bindings, immutable content and full replay
equality. It does **not** recompute Node's versioned SHA-256 canonicalization or
prove provider facts cryptographically. Trusted capture instrumentation/hash
construction remains required in02B-2; no digest is membership authority.

### Ownership, locks and retention

Root admission checks the **newest active** credential binding with the existing
reader's `ORDER BY updated_at DESC LIMIT 1`, then requires the captured account
to match. Its FOR SHARE lock coordinates account switching; workspace liveness
is separate from caller authorization. No token column is selected. Missing vault
table/grants refuse admission. Existing raw credential DDL is unchanged; if the
vault is created later, DBA must grant the specified safe columns/row-lock
capability before any capture activation. No FK deletes historical evidence on
credential rotation. This attests configuration, not external business ownership.

Future transaction order remains workspace→refresh→selected sources→write→entity
path→sorted metrics→observations. Metadata uses KEY SHARE, captured commit uses
NO KEY UPDATE. Triggers enforce liveness/serialization, but cannot reorder
PostgreSQL's implicit UPDATE target-row lock. Future callers must prelock in this
order; misuse may abort/deadlock, never bypass invariants. No provider work belongs
inside a transaction; no production timeout candidates are installed.

DB-stamped T0/event times drive a monotonic **2,160-hour** floor (90 elapsed days,
independent of Cairo DST), including failed/unknown graphs. Every later level/
write admission and source/plan/write seal extends atomically; root selection
extends its own floor. App roles cannot update retain_until directly. Exact replay
does not masquerade as a new admission/seal or extend evidence freshness.

Only explicit maintenance candidates can be passed to private
`canonical_provenance.canonical_delete_retained(ws, roots)`. It locks the workspace
first, then ordered roots, checks ownership, and relies on deadline guards plus
deferred NO ACTION dependencies. No scanner/scheduler or pruning policy is added.
Retry descendants and future restrictive pins prevent ancestor deletion; whole
eligible graphs can disappear together. Workspace CASCADE overrides retention.
Future consumers need same-workspace restrictive references with a tested
deferrable NO ACTION / workspace-CASCADE pattern; current Decision JSON is no pin.
Pending-work selection, legal retention and production pruning remain later gates.

All functions are in a private schema owned by a NOLOGIN capability owner,
with fixed pg_catalog search_path, qualified relations and revoked PUBLIC execute.
Default ACL leakage is removed only from the new objects before exact grants;
legacy public-schema permissions are not revoked. A test grants a legacy role
public CREATE and attempts helper-overload shadowing: private helpers stay protected.
The owner needs narrow legacy read/row-lock grants, including UPDATE(id) or
UPDATE(account_id) for PostgreSQL lock permissions; no guard mutates legacy IDs.
App/maintenance groups cannot inherit owner powers. No runtime login is enrolled.
Maintenance has no direct ledger DELETE/ALTER/TRUNCATE capability; only the guarded
function and monotonic retention extension. DB owners/superusers remain trusted.

Composite FKs enforce tenant references; this adds no RLS or per-request DB role
authorization. Existing route/credential authority remains necessary for future
server-resolved scope. Actual production roles and provider facts are not certified.

## 4. Actual verification

Local PostgreSQL **18.4** x86_64 Windows, Node **24.20.0**, Prisma **5.22.0**,
postgres driver **3.4.9**, READ COMMITTED, Africa/Cairo. Loopback55431 on a dedicated
test cluster; no production DB, real provider, OAuth or advertising action.
The repository network guard remains installed. These SQL tests import no provider.

| Run | Actual result |
|---|---|
| Initial RED, before schema implementation | 35 failed,0 passed,0 skipped; exit1. Missing ledger/verifier/migration surfaced before individual constraint branches could execute. |
| Selected-credential regression RED | 1 failed because old active account was accepted;51 other cases filtered out by explicit test-name selection. Exit1; not a full-suite result. |
| Strict-shape regression RED | 2 failed: SDK fallback provenance and non-finite/string numeric projections were accepted;52 cases filtered by explicit selection. Exit1. Both are rejected in GREEN. |
| First full run | 7014 passed,5 failed,0 skipped: migration declaration/count and DB-test census/import convention. Corrected without changing classifiers/probes or removing assertions. |
| Final full isolated backend suite | **7023 passed,0 failed,0 skipped**, exit0. Includes54 new constraint/concurrency tests and1 actual migration test. |
| Final focused rerun after catalog category inventory tightening | **55 passed,0 failed,0 skipped**, exit0; native audit also passes. Missing or unexpected manifest categories cannot silently omit a check. |
| Legacy frontend contract suite | **34 passed,0 failed,0 skipped**, exit0. |
| Full architecture/security | Both exit0; architecture0 failures/9 existing warnings, security0 failures. Backend-only checks also passed. |
| Prisma validate/generate/ORM reads | PASS; all four generated model reads execute against the explicitly isolated migration DB. |
| Native audit | PASS:4 tables,57 constraints,9 triggers,20 functions; expected metadata and migration checksum match. |
| Syntax/lint/documentation | 861 JS files parse; lint0 errors/31 warnings; local documentation links, JSON parsing and diff whitespace checks pass. |

Reproduction commands (select Node24.20.x first; use only an isolated server):

```powershell
npm run install:backend
$env:CHECKPOINT_DISABLE='1'
$env:DATABASE_URL='postgresql://<test-user>:<password>@127.0.0.1:55431/lumi_02b1_ambient'
$env:DIRECT_URL=$env:DATABASE_URL
$env:TEST_DATABASE_URL='postgresql://<test-user>:<password>@127.0.0.1:55431/lumi_02b1_full'
npm run prisma:generate
npm run test:full
# Focus only, still with physical DB isolation:
npm run test:full -- src/tests/canonicalProvenance.integration.test.js src/tests/canonicalProvenanceMigration.integration.test.js
npm run test:legacy-contracts
node scripts/arch-check.js
node scripts/security-check.js
```

Full verification provisions12 worker DBs from the actually migrated template and
tears them down. New suites run only in that full isolation context; no ambient
development/production fallback. The migration test reconstructs the old75-model
baseline from the exact additive delta and checks a pinned9b48 model digest, so
shallow/sparse CI does not require historical Git objects or client files.

Actual tests exercise populated75→76 replay under a real non-superuser migrator
with an explicit lab DBA owner-membership grant; repeat migrate deploy; an injected
22012 before the actual migration's COMMIT with no remaining tables/functions;
preserved old snapshot values/UUIDs; generated client reads; and unchanged legacy
Prisma diff. Adversarial default table/function/schema privileges are sanitized.
The legacy model diff is already nonempty on the baseline (old defaults/FKs/index
declarations); this slice introduces no additional model diff and does not fix it.
An empty Prisma diff alone is not the native audit.

Barrier tests dispatch competing queries and observe pg_blocking_pids before
release: admissions, source seals, credential switching, workspace deletion and
captured same-key commits. No sleeps establish order. Lock-timeout abort is tested;
same-key projections retain101/202 under one mutable snapshot UUID. Retry/pin/
selection CASCADE and explicit whole-graph retention deletion are exercised.
Catalog negatives damage FK deferral, triggers/enabled state, CHECK, NOT NULL,
function search_path and grants; each audit fails before rollback restores state.
NOT NULL is audited through attnotnull to avoid PG18-only named-constraint encoding.

For a separately migrated isolated database, the read-only audit requires explicit
CANONICAL_CATALOG_DATABASE_URL and optional CANONICAL_CATALOG_RUNTIME_ROLE naming
the actual runtime login. It has no --accept-drift or automatic baseline update.
PG15 hosted execution, production version/roles/latency/capacity and full runtime
capture/recovery remain **NOT_TESTED**. Full React/Vite build and live API/worker
smoke were not run for this schema-only change; no production migration command
or legacy root build was invoked.

## 5. Delivery and production prerequisites

The rollout scanner intentionally remains **UNKNOWN** for dynamic native DDL and
CREATE SCHEMA. A specific declaration records the new migration and its isolated
evidence; it does not reclassify SQL as safe, waive a check or approve deployment.
No architecture/security assertion is removed. Hosted CI status stays separate.

Before merge or any production migration: approve a two-service Render plan,
auto-deploy handling (both services track master), exact migration artifacts,
engine/extension/privilege compatibility, a single dedicated migration owner,
runtime logins without owner/maintenance/DDL powers, native catalog audit, lock/
statement budgets, backup/recovery and rollback. The migration refuses a
non-superuser without explicitly provisioned owner membership and never grants
that membership automatically. Do not reuse a runtime login as migrator.
DDL/FK metadata locks can contend; this is not a zero-downtime claim.

Rollback binaries while retaining additive tables, private guards and immutable
evidence. A failed transactional migration must be investigated/recovered through
reviewed migration history, not IF NOT EXISTS masking incompatible objects.
No destructive down migration. Capture remains absent, so this slice needs no
capture flag or production activation/retention job.

Remaining work: independent source review; hosted CI resolution through a separate
decision; production engine/role/DDL-lock/capacity validation; a bounded02B-2
capture brief covering provider instrumentation, hash canonicalization, actual
T0–T7 wiring, ambiguous commit recovery, allowed payloads and budgets. Positive
membership authority,200-reader coverage, verdict eligibility and Decision
lineage/dedup remain separately approved work. **Gates B/C remain BLOCKED.**

Stop at the Draft PR and request independent source review. No merge or deployment.
