# Backend 03B-2B1 — local PostgreSQL identity/privilege observations

2026-10-20. [Owner-approved Issue591](https://github.com/Omar3llam/marcom-marketing-os/issues/591).
**Standalone evidence only; runtime NOT_WIRED; Gates B/C BLOCKED.** Author report,
not independent acceptance, production qualification or merge/deployment approval.

## Baseline and three-file scope

Live GitHub and fetched master: `9d739ac8c1eb84942a8e368541e66a1f8de91ccd`,
zero open PRs at entry. Its tree matches reviewed #590 head794ba3fb by content.
Separate `codex/issue591-db-identity` branch; primary checkout and four unrelated
untracked files preserved. Only three new files:

| Path | Purpose |
|---|---|
| `src/services/startup/dbIdentityEvidence.js` | Explicit PostgreSQL17 observer, fixed lab profile, strict request binding, read-only transaction and sanitized results. |
| `src/tests/dbIdentityEvidence.test.js` | No-I/O refusal, driver/error/replay controls, SQL/source isolation and unchanged #590 source pin. |
| This document | Scope, real evidence, limitations, reproduction and deferred dependencies. |

Read03B-2A, legacy provisioning contract/03B-1A report, native validator authority,
contract and verifier, actual startup/worker/credential/execution code, Product
Truth Rulings, CLAUDE.md, governance README/Review Gate and approved02A principles.
No material authority drift. Historical reports describe their own subjects;
the frontend roadmap is not authority to expand this backend slice.
Issue591's old deployed9b48f328/disabled auto-deploy and unresolved76/backup/role
facts are inherited governing evidence, not a fresh production inspection here.

All existing files remain unchanged, including the synthetic admission evaluator
(blob `b4ea2d9da03d06e30284c56f5baf74c3ee5fa0e8`), operator validator, routes,
health, four ensures, credential backfill, worker starts/schedules, execution
readiness, schema/migrations/config/CI/frontend. No runtime module imports the
observer. Source tests enforce this; import alone performs no connection or work.

## Invocation and trust boundary

`createDbIdentityProbe().observe(request)` is an explicitly invoked observer.
There is no CLI, environment/config lookup, dotenv, default URL or supplied
connection/query/result seam. Only ordinary objects with exact own data-property
keys are accepted; accessors, proxies and hidden replacement fields reject.
Inputs are copied/frozen before awaiting. Required fields:

- `url`: canonical `postgresql://<lab-login>@127.0.0.1:<port>/<lab-database>`,
  no password/query/fragment/transport overrides or alternative host spelling.
- `profile`: exactly `LAB_READ_ONLY_V1`, defined in code, not an editable manifest.
- `target`: host127.0.0.1, integer non-5432 port, versionMajor17, database prefixed
  `lumi591_`, distinct login/owner/reader prefixed `lab591_`, exact uint64 physical
  system identifier. These are synthetic lab names, never proposed production roles.
- `challenge`: unique64-hex nonce, issued/expires timestamps (maximum10s lab
  interval), exact `expectedIdentityBinding(target)` digest. Missing/expired/future,
  mismatched or repeated requests fail before connecting.

The loaded module rejects repeated challenges across invokers, including failed
attempts and concurrent calls. Budgets256/invoker and4096/module fail closed without
eviction. These are bounded lab controls, not production capacity/freshness policy.
Cross-process durable replay, independent clock/issuer authentication and long-lived
observation authorization are **not established**. A new process must query the
database again; copied result JSON is never accepted as an observation input.

Driver settings explicitly bind host/port/database/login, empty-password callback,
SSL off only for the mandatory literal loopback lab, primary session selection,
single connection, no type-prefetch, no prepared statements and bounded lifetime.
The password callback avoids the driver's empty-string fallback to PGPASSWORD.
The real final matrix deliberately supplies synthetic remote PGHOST/PGPORT/user/
password/TLS/standby environment values: none redirects/authenticates the observer.
The outer socket guard independently allows only the dedicated PG port and an
inventoried unbound negative-control port. No real credentials were retrieved.

Every read runs inside `REPEATABLE READ READ ONLY`, with startup read-only mode,
`pg_catalog,pg_temp` search path, connect2s/statement1000ms/lock250ms bounds and
connection close in all paths. Cleanup error cannot yield a successful observation.
These limits are not production latency benchmarks. The probe contains zero
CREATE/ALTER/DROP/GRANT/REVOKE/INSERT/UPDATE/DELETE or arbitrary SQL execution.
SQL privilege names are data literals, not statements. No customer rows are read.

## Exact LAB_READ_ONLY_V1 coverage

This intentionally small native profile has two empty tables (`allowed`,
`forbidden`) with integer `id`/text `payload`, one non-executable marker function,
one private schema plus existing public schema, NOLOGIN owner/reader and restricted
LOGIN runtime. Runtime inherits reader with INHERIT TRUE, SET FALSE, ADMIN FALSE;
reader receives only private-schema USAGE and allowed-table SELECT. Runtime has
database CONNECT. PUBLIC grants on these objects are absent. Future function
PUBLIC EXECUTE defaults are explicitly revoked for the three lab roles.

| Category | Native observation / match requirement |
|---|---|
| Server/session | current_database, current_user, session_user, inet_server_addr/port, PG17, physical pg_control_system system ID, transaction read-only/isolation/search path agree with expected binding. |
| Roles/memberships | pg_roles SUPERUSER/CREATEROLE/CREATEDB/BYPASSRLS/REPLICATION/login/inherit; recursive pg_auth_members closure and ADMIN/INHERIT/SET options; pg_has_role MEMBER/USAGE/SET including owner chains. Extra/non-inherited/predefined-role memberships reject. |
| Role/database settings | Applicable global/database/role GUC rows must be absent; database owner/CONNECT/CREATE/TEMP and schema owners/USAGE/CREATE use effective has_* checks. |
| Object corpus | All non-system schemas and relations/functions in this database are considered; expected two schemas/two ordinary persistent tables/four columns/one function required. Extra tables/sequences/views/functions/schemas reject. Index structure and other object classes are not native-schema certification. |
| ACLs | pg_catalog aclexplode with acldefault, including PUBLIC, grantor/grantee/owner, grant options, database/schema/table/function and explicit column ACL. Redundant PUBLIC/direct/column rights cannot hide behind an unchanged effective privilege. |
| Defaults/administration | Effective global table/sequence/function/schema defaults plus explicit scoped defaults for the three creators; no external/PUBLIC/grant-option defaults. Relevant pg_parameter_acl grants also reject. |
| Effective privileges | has_table_privilege for all eight PG17 table privileges and grant options; has_column_privilege, has_function_privilege, has_schema_privilege and has_database_privilege. No information_schema visibility assumption. |

An elevated group role attribute is a **lab-profile mismatch**, not a claim that
attributes such as CREATEROLE are automatically inherited. Actual role switching,
membership and effective rights are checked separately. Owner rights, inherited
rights and PUBLIC rights are not equivalent to an absent explicit runtime ACL.
Unexpected/missing catalog coverage or unreadable catalogs never match by default.
See [PG17 role membership](https://www.postgresql.org/docs/17/role-membership.html),
[native membership options](https://www.postgresql.org/docs/17/catalog-pg-auth-members.html)
and [privilege helpers](https://www.postgresql.org/docs/17/functions-info.html).

Outputs are controlled status/reason/category counts, expected-binding SHA256 and
completion time: no role/database names, ACL values, URL, nonce, SQL errors,
credentials or account/customer identifiers. Scope is always
`LAB_IDENTITY_PRIVILEGES_ONLY`, source `PG17_CATALOG_LOCAL`, runtime `NOT_WIRED`,
tenantPermissionBoundaries `NOT_MEASURED`.

| Condition | Result |
|---|---|
| Invalid/missing request, binding, time, replay or exhausted budget | UNKNOWN, before I/O |
| Connection refusal/loss | NOT_CONNECTED |
| Unreadable catalogs, query/lock timeout, read-only violation, cleanup failure | FAILED with controlled reason |
| Actual identity, membership, role, native subset, ACL/default/effective privilege mismatch | INCOMPATIBLE |
| Full selected native lab profile freshly observed | OBSERVED_MATCH |

Never READY, a production COMPATIBLE result, an admission token or a fixture
issuer. Output JSON is **not cryptographic evidence authenticity**. The boundary
is fresh internal SQL with no caller-supplied checker/results; nobody consumes
these results for boot. The synthetic receipt map is neither imported nor amended.
No mapping to full IDENTITY, native readiness or migration history exists.

## Isolated execution and evidence

Fresh physical PG17.11 cluster created for this task, loopback127.0.0.1:55451,
system ID `7698690589386727940`, owned directory
`C:/Users/user/.codex/tmp/lumi-issue591-pg17/data`. Unbound-port/native control
files, process path/PID, pg_ctl command/data directory, PG control identity and
listener ownership were checked before first SQL. All fixture sessions then
rechecked actual system ID/data directory/listen/version/login before any DDL.
Original shell startup helper did not finish before the independent v2 preflight;
it ended after stop with missing postmaster.pid. Its exact stalled operation was
not instrumented; do not attribute this to CIM. The v2 physical proof is explicit.

Fixture-only bootstrap `lab591_bootstrap`, owner `lab591_owner`, reader
`lab591_reader`, runtime `lab591_runtime`, negative-control `lab591_extra`.
Trust authentication exists only on this dedicated loopback lab. Two disposable
databases `lumi591_identity`/`lumi591_other`, no real data or application migrations.
Fixture DDL/GRANT/role changes are separate, journaled and qualified; probe SQL has
its own application name. Production/Neon/Render/Redis/providers are not accessed.

Real cases require a passing native positive baseline before each negative and
compare role/catalog/empty-row snapshots before/after the observer. Matrices cover
direct/inherited/SET/ADMIN/hidden/predefined/owner memberships; every elevated
attribute; redundant PUBLIC and grant options; column/function/default/parameter
ACL; extra/missing corpus; RLS refusal; unreadable catalogs; current/session user
crossing; challenge replay/binding; explicit write rejection and real timeout/
disconnect barriers. Lock controls use acquired-lock and pg_stat_activity barriers,
not sleeps. The explicit write is a separate lab transaction control, denied25006;
the probe itself never sends it. Catalog RLS flags do **not** prove tenant semantics.

Raw evidence includes all failures, commands, JSON results, server/fixture/query/
socket journals, before/after catalogs, exact diff, source hashes, teardown and
SHA256SUMS. Node24.20.0/npm11.19.0, Vitest4.1.7, postgres.js3.4.9, Windows.
Qualified existing offline dependencies reused; package/lock/packages/Prisma schema
parity verified. No fresh installation claim, .env or inherited real credentials.

### Retained RED and harness corrections

- Initial unit RED: missing module; collection failure, zero executed tests.
- First unit candidate:47 passed/1 failed (new source-scan case exceeded5s).
  One eager source snapshot moves source I/O out of assertion cases; original5s
  timeout unchanged.
- First native positive: FAILED due array encoding with fetch_types disabled.
  Fixed parameterized fixed-length IN expressions; no broader driver behavior change.
- Initial diagnostic matrix:75 passed/2 failed on Node24.15 (not final qualified
  runtime): missing-table snapshot failed before probe; function readability control
  wrongly assumed direct revoke removed inherited/PUBLIC access.
- Pinned diagnostic retry:76 passed/1 failed; PUBLIC EXECUTE on pg_control_system
  was actually observed in17.11. Final negative revokes PUBLIC plus direct/inherited
  grants. A separate snapshot-identifier setup error is also preserved.
- Guarded matrices before the final cross-invoker replay correction:77/77 pass,
  no skips/network violations; historical subjects, not substituted for final source.
- First teardown batched two DROP DATABASE commands and received25001 before
  either executed. An initial receipt incorrectly claimed SQL cleanup and is named
  **initial-invalid**, preserved and superseded. Restarted only the same task-owned
  physical cluster, verified identity, then dropped databases separately and roles.
  Final replay verification recreated only this task's empty fixture after verified
  cleanup. No existing/shared cluster was substituted.

### Final-source verification

| Command / subject | Actual result | Elapsed |
|---|---|---|
| Focused observer unit file | **55 passed/0 failed/0 skipped**, exit0. | 0.426s Vitest |
| Final real PG17 matrix (guarded, pinned runtime) | **78 passed/0 failed/0 skipped**, exit0; every negative first passes its positive baseline; zero network violations. Includes cross-invoker replay. | 15.848s process |
| Targeted observer + unchanged admission + validator tests | **260 passed/0 failed/0 skipped**,3 files; exit0. | 0.779s |
| Unchanged `npm run test:fast` | **6731 passed/0 failed/639 skipped**,431 passed/28 skipped files; exit0. No new DB skips. | 44.88s |
| `npm run check` | PASS/exit0:869 source parses, no aliases. | 60.700s command |
| `npm run boot-check` | PASS/exit0:867 parses + server graph link; not runtime boot. | 43.896s |
| `npm run arch-check:backend` | PASS/exit0:0 failures,5 existing warnings. | 0.452s |
| `npm run security-check:backend` | PASS/exit0:0 failures,0 warnings. | 0.381s |
| `npm run lint` | PASS/exit0:0 errors,32 warnings outside the new files. | 9.451s |
| `npm run build:backend` | PASS/exit0:Prisma5.22.0 generation + syntax/boot graph. No UI build, SQL or migration. | 110.188s |

Tested-source bytes and invocation hashes are retained. A final whitespace check
found one extra EOF blank line in each new JS file; both were removed. Canonical
LF/EOF-normalized equality proves no interior text changed, and a fresh55-case
unit/syntax recheck passed. Native/regression/fast/static/build results describe
that identical code body, not a fabricated rerun after formatting. Earlier54-case
units,259-case focused and6730-pass fast runs precede the
cross-invoker replay correction and remain separate historical evidence.
No existing assertion, timeout, worker count, guard or skip policy changed.

Server journal across **all** diagnostic/final probe runs:11,029 statements,
713 BEGIN,2,139 SET,5,281 SELECT,2,188 WITH,684 COMMIT,24 ROLLBACK;
**0 unexpected statement verbs**. Compiled-query tests independently reject SQL
mutations inside these statements. All78 final observations have equal before/after
catalog/data digests; full whole-matrix catalogs are retained. No business-row read
comes from the probe. Fixture snapshots separately count empty synthetic tables.

Teardown: zero probe sessions, **two fixture databases and four roles removed**,
PG status3/no listener55451. Only stopped task-owned physical data (bootstrap/system
catalogs) and raw logs remain. Initial invalid cleanup receipt is superseded by
`sql-teardown.json` and `physical-teardown.json`; it is not successful evidence.

Reproduce using fresh dedicated PG17 and the supplied external safety/fixture/
matrix scripts, before/after native proofs and query journal. Do not reuse a shared
cluster or run application migrations. Then, with no DB credentials and unchanged
guards/settings:

```text
npm run test:fast -- src/tests/dbIdentityEvidence.test.js
npm run test:fast -- src/tests/dbIdentityEvidence.test.js src/tests/startupAdmission.contract.test.js src/tests/legacySchemaValidator.test.js
npm run test:fast
npm run check
npm run boot-check
npm run arch-check:backend
npm run security-check:backend
npm run lint
npm run build:backend
```

Exact reporter options, environment keys, start/exit times, raw logs and immutable
source diff are in the checksummed evidence package. The639 skipped DB cases and
`test:full` are **NOT_TESTED**; no migration76 was executed. Hosted execution is
separate from these local results.

## Remaining boundaries, future sources and rollback

OBSERVED_MATCH covers only this native lab profile. It does not prove actual
production role policy, direct/pooler/TLS transport, tenant enforcement, native
legacy compatibility, canonical76 objects, migration checksums/error/recovery,
auth/session/OAuth/vault/credential selection or old/new Web/Worker compatibility.
Real hung-handshake connect-timeout behavior is not tested; the configured bound
is inspected and real refusal, lock timeout and disconnect are measured.
Catalog snapshot/cache concurrency, clock trust/rollback, cross-process replay,
target authorization/revalidation and TOCTOU need later separately approved design
and tests. No production issuer/role names or policy are invented here.

Before any runtime integration: separately approve/qualify production operator
roles and least-privilege profile, restorable backup/recovery, failed76 history
and canonical objects, native legacy schema, actual tenant controls, auth/OAuth/
vault/account-reconciliation policy, migration receipts, every worker effect and
old/new binary rollout/rollback. Additional bounded source slices precede a boot
gate. Existing false health, startup schema/backfill writes and early workers
remain unchanged. The pure synthetic candidate still rejects real-source context.

Rollback removes these three standalone additions. No production SQL or data
rollback exists. Do not drop production objects, rewrite receipts, restore live
credentials or run a historical migration-bearing build. Fixture teardown is only
for the owned new lab; retained stopped data/logs are not a production backup.

The five approved canonical completeness principles, R-8 and capture-v1 UNKNOWN
membership remain unchanged. Full DB/backend migration verification is NOT_TESTED:
the ordinary full provisioner would execute prohibited76. Hosted audit is deferred
under #588, zero-step execution is NOT_TESTED; no retry/waiver or readiness claim.

**Stop at one Draft PR for ChatGPT independent review. No merge/deployment/runtime
activation. Gates B/C remain BLOCKED.**
