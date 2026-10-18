# LUMI Backend 03B-1A — readiness report

2026-10-17. **IMPLEMENTED; independent review PENDING.** This is an author evidence
report, not CODE_REVIEW_READY approval, merge permission or production readiness.
Scope: [Issue582](https://github.com/Omar3llam/marcom-marketing-os/issues/582).
Base/master: `94232a32433de5f77b7d02874e9839f52a084b91`.
Branch: `codex/backend-03b1a-legacy-validator`; immutable head is in the Draft PR.

## Baseline and authority

Fresh fetch matched the approved master; no open PRs. Read Issue582, the independent
[03B-0 review](https://github.com/Omar3llam/marcom-marketing-os/issues/581#issuecomment-6234272436),
product truth, governance/Review Gate, approved02A principles,02B/03A contracts,
all five native DDL owners and their raw consumers, API startup and execution
schemaReadiness. No material authority drift. #578 and #580 code remains on master.
Source merge is distinct from review, deployed binaries and database installation.

Reported infrastructure baseline comes from Issue582/accepted03B-0: old9b48f328
Web/Worker, automatic deployment/previews off, unresolved live build/predeploy
drift, failed76 incident and no qualified production recovery point. **None of
these production facts was re-inspected or changed in this slice.** No Neon,
production DB/credentials or Render tools were accessed. Gates B/C remain BLOCKED.

## Changed files and purpose

All changes are additive; existing package/lock, migrations/schema, runtime,
server/health/worker, auth/OAuth/vault/account/deletion/frontend files are unchanged.

| Files | Purpose |
|---|---|
| `scripts/legacy-schema/catalog.js` | Exact metadata collection for four raw tables, native dependencies and prerequisite keys. |
| `scripts/legacy-schema/authority.js` | Catalog ACLs, column/default grants, owner/role ancestry/settings and effective privileges; no customer reads. |
| `scripts/legacy-schema/contract.js`, `manifest.v1.json` | Frozen synthetic candidate, source/checksum pinning, explicit role binding and canonical comparison. No auto-accept/regeneration CLI. |
| `scripts/legacy-schema/verify.js` | Explicit target validation, read-only bounded snapshot, catalog/history comparison and redacted structured failure. |
| `scripts/verify-legacy-schema.js` | Standalone explicit operator diagnostic. No dotenv/fallback or automatic invocation. |
| `scripts/legacy-schema/tests/{fixture.js,validator.test.js,vitest.config.js}` | Dedicated, strictly local synthetic PG17 matrix with unchanged shared network guard. No application globalSetup/migrations. |
| `src/tests/legacySchemaValidator.test.js` | Fail-before-I/O, source/manifest/target refusal, redaction/cleanup and actual missing-config CLI tests. |
| `docs/LEGACY_SCHEMA_PROVISIONING_CONTRACT.md`, this report | Before/after ownership map, proposed operator procedure, exact limits and evidence. |

## Contract and safety boundary

Candidate native inventory:4 tables,43 columns,7 constraints,14 indexes, one touch
function/trigger, pgcrypto, no owned sequence/policy;21 metadata categories.
Preserve observed nullable credential fields, defaults, redundant indexes, function
SECURITY INVOKER/NULL search_path/PUBLIC EXECUTE and absence of raw FKs/CASCADE.
Synthetic authority/locale are **not production facts**. External owner/runtime/
auditor names must bind distinct roles; unqualified source/manifest/target blocks.

Runtime imports do not reach the new validator. It is not in build/install/start,
worker/predeploy/CI commands. READ ONLY is the connection default and explicit
REPEATABLE READ transaction mode; timeouts connect5s/statement5s/lock1s.
Server/session identity is checked before catalog queries. Remote transport requires
certificate verification; only loopback permits disabled TLS. Output contains
scope, manifest version/hash, DDL source SHA, category counts/diffs and SQLSTATE.
It does not print URLs, error messages, bodies, ACL values or customer rows.

All shipped history names/checksums require one successful/non-rolled-back/one-step
receipt, and native checks must also match. Failed/rolled-back76/H-1 cannot greenlight
this diagnostic. A scoped COMPATIBLE match **does not audit canonical76 native
objects** or authorize startup/capture/deploy. Synthetic successful receipts are
test inputs, never a statement that migration76 executed.

## Actual RED / GREEN evidence

Node24.20.0, Prisma5.22.0 generation only, postgres3.4.9, PostgreSQL17.11 Windows
x86_64, isolated loopback55438. Real local SQL transactions; no Redis, provider,
Firebase or customer inputs. New tests import no provider graph; shared network
guard remains active. Fixture creates26 exact source DDL statements, minimal
prerequisite tables and synthetic history; no application migration command runs.

| Run | Actual outcome |
|---|---|
| Initial unit RED before implementation |3 failed: missing native validator module. Deeper branches not exercised yet. |
| PG RED before candidate manifest |48 failed/1 passed; unqualified/missing manifest prevents native comparisons. No deeper-coverage claim. |
| First candidate PG |47 passed/3 failed; inet-to-text returned /32, causing identity refusal. Positive case exposed it; negatives did not yet prove their intended branches. Retained. |
| Corrected PG intermediate |50 passed/0 failed/0 skipped. Every negative first verifies its own positive baseline. |
| Candidate PG before final prerequisite reconciliation |51 passed/0 failed/0 skipped;2,858 validator statements. Retained as intermediate: its minimum users fixture still incorrectly required non-NULL clerkId and omitted the existing FK. |
| Final source-reconciled PG matrix |**54 passed/0 failed/0 skipped**, including actual CLI;54 scenario records and3,032 validator statements. Zero unexpected validator DDL/DML/business-row reads or external network violations. |
| Focused backend regression initial |63 passed/3 failed/11 skipped: unchanged scanner tests exceeded their5s/15s limits during concurrent work; failures retained. |
| Focused regression repeat |**67 passed/0 failed/11 skipped**,7 files pass/1 skipped. No existing timeout/assertion/guard changed. |
| Final client-absent validator unit run |**8 passed/0 failed/0 skipped**, including actual CLI. |
| Client-absent `build:backend` |PASS: Prisma5.22 generation, `npm run check`865 files, `npm run boot-check`865 parses + real server graph link. No migrations or runtime boot. |
| Client-absent architecture/security |PASS:0 failures,5 existing architecture warnings; security0 warnings. |
| Guarded build/static/unit process audit |1,752 Node records;0 forbidden DB/network/DDL events. No new dependency install was measured; existing pinned dependencies reused. |
| Syntax/lint/whitespace |8 standalone script/test JS parses; new src test included in865-file check; src lint0 errors/31 existing warnings; diff whitespace PASS. |
| Legacy frontend contract initial / repeat |32 passed/2 failed on unchanged5s scanners; same command repeat **34 passed/0 failed/0 skipped**,6 suites. Both logs retained. |
| Full `npm run test:full` |**NOT_TESTED**: its globalSetup invokes migrate deploy, including prohibited76. ProductionMigrationSafety's11 tests also require such a template, so remain explicitly skipped. No override/waiver. |
| Production, managed roles/TLS/poolers, live auth/OAuth/deletion concurrency, recovery/rolling cutover |**NOT_TESTED**, outside authority. |

Final reconciliation preserves nullable users.clerkId and its existing baseline
workspace FK (DELETE CASCADE, native UPDATE NO ACTION). This is a prerequisite
contract, not a new raw FK or schema change. The synthetic candidate was corrected
before commit; production/Prisma-wide equivalence remains unqualified.

Negative coverage: each raw table and representative missing column; malformed type,
default/nullability/extra column; PK, unique arbiter/credential unique and CHECK;
missing/wrong named index; absent/changed/definer/wrong-owner/search_path function;
missing/disabled/wrong-event trigger; extension; table owner; PUBLIC/table/column/
function/schema/default grants; inherited write-all/owner membership; runtime role
administration/settings; prerequisite column/type/identity unique/FK/action and
invented clerkId NOT NULL;76 missing/failed/
rolled-back/checksum; unreadable catalog/history; wrong client/server target.
This is a bounded matrix, not exhaustive combinations or vendor-extension attestation.

### Reproduction commands

Use Node24.20.x and a fresh disposable PG17 cluster bound to127.0.0.1:55438 with
the strict `lab03b1a_*` roles/database described by the supplied fixture transcript.
Never use a real provider, production URL or ordinary migration provisioner.

```powershell
# Prepare synthetic native fixture with tests/fixture.js, not migrate deploy.
$env:LEGACY_SCHEMA_LAB_URL='postgresql://lab03b1a_admin@127.0.0.1:55438/lumi03b1a_template'
$env:LEGACY_SCHEMA_EVIDENCE_FILE='<external query-ledger path>'
node node_modules/vitest/vitest.mjs run --config scripts/legacy-schema/tests/vitest.config.js
node scripts/run-tests.js fast src/tests/legacySchemaValidator.test.js
# In a disposable source copy with client/ entirely absent, not the real checkout:
npm run build:backend
npm run arch-check:backend
npm run security-check:backend
```

The ZIP includes exact fixture preparation, whitelist/no-network build guard,
subject copy procedure, command/output/exit records, before/after26-statement SQL
manifest and final native query/negative matrix. Lab resources are stopped/retained
as documented by teardown; they are not production backups.

Command logs, JSON test reports, final build/static results, source parity and
negative query ledger are in the delivered evidence ZIP. Checksums and the exact
PR diff accompany it. Hosted CI is reported separately in the PR, never inferred
from local tests. Zero-step hosted jobs are NOT_TESTED; no CI waiver is requested.

## Remaining blockers and rollback

Startup ensures/backfill, false health readiness, worker consumer/schedule admission
and receipt-only execution gate are intentionally unchanged. Credential reconciliation,
winning account policy, runtime admission and live release changes require separate
Omar approval. Do not remove real legacy tables or rewrite operational credentials.
Constitution R-8, five approved principles and capture-v1 UNKNOWN remain unchanged.

Production native/owner/ACL baseline, failed76 recovery, qualified backup/restore,
live build/predeploy drift, managed privileges, full backend DB verification, hosted
execution and rolling compatibility remain OPEN. No Gate B/C closure.

Rollback is a source revert of standalone additions; there is no deployed runtime
or production data change to undo. Do not restore an old migration-bearing build,
drop objects, rewrite history or execute production recovery as rollback.

**Stop:** Draft PR and evidence for a genuinely separate reviewer. Independent
acceptance and Omar's later explicit scope/release approvals are still required.

## 2026-10-18 P1 correction — contract authority

Addresses only the independent [P1 review](https://github.com/Omar3llam/marcom-marketing-os/pull/583#issuecomment-6235474551)
of `b95782be81010654f7683c01111d988fa32f073b`. Fresh master remained
`94232a32433de5f77b7d02874e9839f52a084b91`; the existing branch was clean.
The historical results above describe the original head, not this correction.

Before: operator target JSON was spread into verification options. A complete
manifest retaining all21 categories and source hashes but removing one column
(43 to42) was accepted. Both manifestPath and source-root substitutions reached
the connection boundary. A self-reported alternate hash did not enforce authority.

After: the loader rejects either override key, resolves both paths from its own
module and checks the approved manifest's LF-normalized hash before parsing or
connecting. The CLI rejects overrides and passes only target/bindings, plus the
explicit audit URL. Normal verification cannot substitute a contract. The explicit
connection-factory test seam remains for isolated query instrumentation. Manifest,
source inventory, catalog assertions, role/target qualification and read-only SQL
are unchanged. The approved manifest bytes/hash match the reviewed head exactly.

Correction file list: `contract.js` (fixed authority/hash seal), operator CLI
(reject and stop spreading overrides), validator unit tests (forgery/API/CLI/hash
negatives), provisioning contract and this evidence annex. No other tracked files.

| Correction evidence | Executed result |
|---|---|
| RED, old implementation plus five new tests |8 passed,5 failed,0 skipped. Complete forged manifest accepted; both API overrides opened the injected pool; both actual CLI overrides attempted a socket. A child preload blocked before the real connection method; no DB/network connection occurred. |
| GREEN validator unit |14 passed,0 failed,0 skipped. Includes changed bundled bytes in an isolated module copy; approved repository manifest never altered. CLI override cases exit1/UNKNOWN with zero socket attempts. |
| Unchanged isolated PG17.11 matrix |54 passed,0 failed,0 skipped; all54 positive baselines COMPATIBLE,3,032 instrumented statements,0 unexpected write statements/business-row reads. Retained local template reused; each case created and dropped its own disposable clone. No application migration execution. |
| Focused regression initial |71 passed,2 failed,11 skipped. Existing runtime/census scanner tests exceeded unchanged5s limits; raw failures retained. |
| Focused regression serial repeat (`--maxWorkers=1`) |73 passed,0 failed,11 skipped;7 suites passed,1 skipped. Same assertions and timeouts. |
| Legacy contracts |34 passed,0 failed,0 skipped;6 suites. |
| Source lint |0 errors,31 existing warnings. |
| Client-absent backend build |PASS: Prisma5.22 generation;865 source parses; boot-check865 parses and server import graph link. Not a live API/worker boot. |
| Client-absent validator unit |14 passed,0 failed,0 skipped. |
| Architecture / security |Backend-only and full checks PASS; architecture5 backend /9 full existing warnings; security0 warnings. |
| Build/static guard and script syntax |1,760 Node records,0 forbidden events; both changed standalone scripts parse; diff whitespace PASS. |
| Full DB verification /11 production-migration tests |NOT_TESTED / skipped: existing provisioner executes application migrations including76, outside this correction's authority. |

Detailed build/static logs and current-head hosted execution are recorded separately
in the correction evidence package/PR. Zero-step hosted jobs are NOT_TESTED;
no CI exception is requested or applied. The PG lab was stopped after verification.

Rollback of this correction reopens the reviewed P1, so it is not an acceptable
operator workaround. There is no runtime wiring or production data change to undo.
Production native/ACL/privilege qualification, failed76 recovery, backup/restore,
live build/predeploy drift, runtime/worker admission, full DB/hosted execution and
rolling release remain OPEN. Gates B/C remain BLOCKED. No merge, deployment,
production inspection, capture activation or phase advancement is authorized.
Independent re-review from SaherMohamed250 is required at the updated immutable head.
