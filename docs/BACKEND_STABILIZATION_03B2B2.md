# Backend 03B-2B2 — canonical native catalog and migration history lab observer

2026-10-20. [Issue594](https://github.com/Omar3llam/marcom-marketing-os/issues/594),
[Omar's bounded approval](https://github.com/Omar3llam/marcom-marketing-os/issues/594#issuecomment-6291051099).
**Local evidence only. Runtime NOT_WIRED. Backend Gates B/C BLOCKED.**
Author evidence for independent review; no production qualification, admission
token, phase closure, deployment authorization or merge approval.
**Teardown limitation:** all fixture databases/roles removed and server stopped;
automatic approval review blocked recursive removal of the physical cluster files.
Physical cleanup remains incomplete, not PASS.

## Authority, baseline and allowlist

Fresh live GitHub and fetched master matched
`32e44f24f407e4da22e21a9f991c8221f7b80e51`; zero open PRs at entry. Separate
`codex/issue594-canonical-evidence` worktree. The primary checkout's unrelated
HEAD and four preexisting untracked files were preserved.

Read CLAUDE.md, Product Truth Rulings, governance README/Review Gate, approved
02A principles, 02B-0G/02B-1 native ownership/rollout requirements, migration76,
frozen catalog, existing native diagnostic/integration replay, legacy verifier,
03B-2A synthetic admission contract and 03B-2B1 observer. No material authority
drift. Infrastructure facts inherited from the issue were not independently
inspected in production. Only these three additions are proposed:

| File | Purpose |
|---|---|
| `src/services/startup/canonicalMigrationEvidence.js` | Standalone observer; pinned source authority, exact native/privilege checks, strict receipt semantics. |
| `src/tests/canonicalMigrationEvidence.test.js` | Input/source isolation, refusal, replay/lifecycle and receipt predicates; mocked transport only. |
| This document | Lab contract, actual verification and limitations. |

Existing diagnostic, tests, guards, Prisma schema/migrations, startup, health,
workers, credentials, auth, API, CI, package/lock and frontend are unchanged.
No existing caller imports the observer; explicit invocation is required.

## Invocation and trust boundary

`createCanonicalMigrationObserver().observe({url,target,challenge})` is the sole
observation entrypoint. It does not accept environment configuration, a supplied
driver/result, manifest, source root, readiness boolean or cached evidence.
`historyMatches` is a pure predicate for tests, not an observation issuer.

The independent lab controller must first verify a **new owned physical cluster**:
directory absent before initdb, unused port, trusted PG17 binary, pg_controldata
system ID, matching postmaster.pid/data directory/listen address/port/process
path and owning loopback listener. Native identity is checked again before lab
fixture writes. The observer cannot prove ownership from arbitrary operator JSON;
the controller/preflight is a trusted prerequisite, not an authenticated issuer.

Target fields are exactly host, port, database, login, systemIdentifier and
versionMajor. Only literal127.0.0.1, nondefault high port, PG17,
`lumi594_[a-z0-9_]{1,40}` databases and `lab594_observer` login qualify. The URL
must match every target field and contain no password/options/fragment.
Plain own-data JSON is required; proxies, getters, hidden keys, partial objects,
overrides and invalid primitive types are refused before DB I/O. Validated input
is copied before asynchronous work.

`canonicalTargetBinding(target)` hashes the fixed lab profile and ordered target
fields. A caller supplies a fresh64-hex nonce and integer issuedAt/expiresAt,
maximum10000ms interval, matching binding. Replay is refused across invokers in
this loaded module, with a4096-challenge fail-closed cap and no eviction.
Successful reads are rechecked for expiry/backward clock movement. This is not
durable replay protection, cryptographic attestation, a production freshness
policy or protection against a malicious controller/module loader/system clock.
Cross-process authorization/authenticity and TOCTOU revalidation remain undefined.

Connections explicitly set every target field, empty password callback, SSL off,
one connection, no notices, bounded connect2s/statement1s/lock250ms/close1s,
read-only startup and safe `pg_catalog,pg_temp` search path. A single transaction
uses `REPEATABLE READ READ ONLY`. Actual database/current/session identity,
address/port/version/system ID/read-only/isolation/path must all match. `SET LOCAL`
changes only session settings. Reads cover catalogs and migration metadata only;
no customer rows or canonical measurement rows are selected by the observer.
Pool closure failure prevents a positive. These lab bounds are not production
capacity or operational benchmarks.

Outputs contain only the fixed status/reason and these constant disclaimers:

```text
status = UNKNOWN | NOT_CONNECTED | FAILED | INCOMPATIBLE | OBSERVED_MATCH
scope = LAB_CANONICAL_NATIVE_HISTORY_ONLY
runtimeAdmission = NOT_WIRED
tenantPermissionBoundaries = NOT_MEASURED
```

No names, URL, credentials, raw error, receipt logs, measurements or trusted
admission token are emitted. Missing/unqualified source/target/challenge is
UNKNOWN; connection absence is NOT_CONNECTED; query/timeout/cleanup failures are
FAILED; native/identity/privilege/history mismatches are INCOMPATIBLE. A positive
means this chosen lab profile was observed in this transaction only.

## Frozen native authority and lab privilege profile

The approved manifest is pinned at normalized-LF SHA256
`123870e3b285ff737cd28fd23f5d43ab79819d842c0a4d7371df1d5487b482b8`.
The sorted76 `{name,checksum}` normalized-LF source inventory is pinned at
`e511fc39d0b8fc00f70c7cdfdc04fff332106bf07fc30114fcbb8d9c77a04165`.
Migration76 must also match the manifest's reviewed checksum. Each migration is
read once into bytes for both authority and deployed-byte receipt checksums.
All migration directories are inventoried; unexpected numeric or nonnumeric
sources fail closed. The existing manual SQL and migration_lock.toml are separately
pinned ancillary files, **not** fabricated Prisma receipts or executed manual SQL.

Compare every frozen category: schema/table owners and RLS, columns/defaults,
constraints (including tenant FKs/validation/deferral), indexes and partial
non-daily identity, enabled triggers, all private functions/definitions/checksums,
roles and memberships. Raw `pg_catalog` ACL expansion replaces filtered
information_schema grants. No regeneration or source acceptance option exists.
The frozen diagnostic rendered public references implicitly; expected FK target
definitions and the known MeasurementWindow cast are qualified with `public.`
for the safe search path. No actual-definition stripping or arbitrary normalization.

PG17's owner MAINTAIN grant is separately required and unexpected MAINTAIN fails;
it was absent from the older information_schema projection. Compare grantors,
grant options, exact table/column grants, schema/PUBLIC/function ACLs, effective
table/column/function/schema/database rights, role membership edges/settings,
default ACLs, parameter administration, unexpected private relations/types,
canonical extra tables/indexes/functions, inbound external FKs, rules/inheritance
unused RLS policies and the history table's physical/column structure.

The lab profile has one explicitly provisioned migrator owner-membership with
ADMIN/INHERIT/SET, no observer membership or elevated attributes. Observer gets
CONNECT, public USAGE, history SELECT and pg_control_system EXECUTE, no business
or write grants. Public database grants are revoked. Five scoped roles' function
and type defaults are owner-only, including scoped defaults. This additional
**lab fixture policy** is not a claim that migration76 alone installs those lab
roles/defaults, nor a prescription for production roles. Canonical app/retention
capabilities remain exactly the migration's dormant governed grants. Tenant
permission boundaries and arbitrary legacy-object compatibility are NOT_MEASURED.

## Full history policy

Read **all** `_prisma_migrations` rows without filtering failures or rollbacks.
Require exactly76 rows and exactly one per shipped source, exact deployed-byte
SHA256, finished, no rollback, no nonempty error log, nonnull start, completion
not before start or in the future, and exactly one applied step. Missing/extra/
duplicate/unfinished/failed/rolled-back/changed receipts, including76, refuse.
Receipt order across different migrations is not inferred from names/timestamps.

Prisma5.22 hashes actual file bytes. Windows CRLF receipts differ from repository
LF hashes despite identical SQL text. Source authority uses approved normalized
LF; receipts must match **this deployed checkout's exact bytes**. A receipt from
a different line-ending representation is not silently accepted. This chosen
local contract is not a cross-platform production recovery policy.

Failed-then-rolled-back plus later-success history is deliberately refused.
Legitimate recovery acceptance remains **PO-UNDECIDED**; no filtering, receipt
deletion/correction, migrate resolve, automatic repair or acceptance shortcut.

## Verification evidence

Raw evidence and reproduction scripts are outside the application tree under
`C:/Users/user/.codex/visualizations/2026/10/20/lumi-issue594-canonical-evidence/`.
The final archive includes per-file SHA256SUMS, actual invocations/exits/stdout/
stderr, JSON cases, source inventory/hashes, physical preflight, fixture journal,
observer SQL/network journals, before/after catalog/history/data digests and
teardown receipts. Node24.20.0/npm11.19.0, Prisma5.22.0, Vitest4.1.7, Windows,
new loopback PostgreSQL17.11. Offline dependencies reused only after lock/schema/
workspace source parity; **not a fresh installation claim**. No `.env` or ambient
provider/database credentials are passed. The repository network guard, normal
12 workers and existing test/hook timeout settings remain unchanged.

| Command / subject | Actual result |
|---|---|
| Initial focused RED, module absent | Collection failure, exit1; zero executed cases. |
| Early focused candidate | 40 PASS,0 FAIL,0 SKIP. |
| Final focused `npm run test:fast -- src/tests/canonicalMigrationEvidence.test.js` | 51 PASS,0 FAIL,0 SKIP. |
| Final-source real PG17 native/history matrix | 124 PASS,0 FAIL,0 SKIP; positive before each catalog/privilege/history negative. |
| Final-source explicit-barrier lifecycle | 3 PASS,0 FAIL: lock timeout, exact blocked PID disconnect, expiry after native reads. |
| Final-source source/ambient controls | 5 PASS,0 FAIL: approved copy positive, forged complete manifest, changed76 source, unexpected nonnumeric migration directory, synthetic ambient poison ignored. Three source refusals open zero new sockets. |
| Genuine failed76 receipt with otherwise matching native catalog | 1 PASS: INCOMPATIBLE/MIGRATION_HISTORY_UNQUALIFIED; row remains unfinished/unresolved, no resolve or receipt repair. |
| Controlled unsafe policy mutant, outside application tree | RED/exit1: omitted policy predicate incorrectly yields OBSERVED_MATCH; submitted source refuses identical native state; unchanged digests. |
| First unchanged fast suite | 6781 PASS,1 FAIL,639 SKIP; existing queue-import case at `legacyActionRetirement.test.js:175` exceeded5000ms. |
| Same unchanged failed file | 37 PASS,0 FAIL,0 SKIP. |
| Unchanged fast repeat before the added policy predicate | 6782 PASS,0 FAIL,639 SKIP;432 passed/28 skipped files. |
| Final-source unchanged `npm run test:fast` | **6782 PASS,0 FAIL,639 SKIP**;432 passed/28 skipped files;43.94s. |
| `npm run check` | PASS/exit0;871 syntax checks;62.219s. |
| `npm run boot-check` | PASS/exit0;869 parses and server graph link;44.507s. Not runtime boot. |
| `npm run arch-check:backend` | PASS/exit0;0 failures,5 existing warnings;0.455s. |
| `npm run security-check:backend` | PASS/exit0;0 failures,0 warnings;0.408s. |
| `npm run lint` | PASS/exit0;0 errors,32 warnings outside the new files;6.924s. |
| `npm run build:backend` | PASS/exit0;Prisma5.22 generation,871 syntax checks,869 boot parses/graph;106.190s. No migration or UI build. |
| Documentation/scope checks | `git diff --cached --check` PASS; three additions only; no existing tracked edits. |

Final candidate SHA256:
`1064679f7b4545b373f334d9df8d312a8af06344115a75f43887e328edbd0288`.
Final test SHA256:
`1de35a48889ca9a551b625042a1b0b626fb054c67ff6e24904929ef6261290ed`.
The same hashes bind final focused/fast/native/static/build subjects. The final
all-run observer journal contains16339 statements:SELECT13028,BEGIN493,SET1479,
WITH849,COMMIT485,ROLLBACK5; zero unexpected DDL/DML verbs.750 guarded Node
socket events, zero forbidden. Counts include retained diagnostic/mutant runs;
they are not a production network certification. All final logical digests match.

Exact source hashes/results are in the external immutable summary. Full `npm run test:full`
and its639 database cases are NOT_TESTED here; the bounded real PG lab matrix
does not replace them. Frontend suites and hosted execution are separate.

### Retained diagnostic failures and qualifications

The first native positive refused because the old diagnostic's public search
path produced unqualified FK/type definitions; then source/receipt checks exposed
Prisma's actual CRLF byte checksums. Both fail-closed outcomes preceded the
corrected positive. One early positive log path was reused; original native
SQL/server records and the representation diff remain, but that first console
transcript is not separately archived. It is not represented as complete raw
console preservation.

An intermediate lifecycle attempt passed the lock case, then its next positive
overlapped another harness's temporary global-role negative and refused. Later
lifecycles run sequentially. The actual-failure harness first incorrectly required
a nonnull Prisma error log: this transactional DDL failure leaves logs NULL,
finished NULL, rolled_back NULL,steps0. The receipt was preserved. Its first
follow-up also refused missing per-database lab default ACLs; after fixture-only
profile setup, refusal reached the genuine unresolved history. No receipt was
rewritten or normalized. The first policy mutant had malformed SQL and is an
invalid RED control; corrected mutant/actual-source comparisons are separately
recorded. All those later failed attempts and corrected runs remain archived.

The controller re-created fixtures once in the same task-owned, identity-checked
physical cluster to repeat verification after detecting unused policy objects.
Initial teardown removed167 disposable databases and6 roles; final teardown
removed60 more databases and the6 recreated role identities. Final state has no
fixture databases/roles, no observer sessions, pg_ctl status3 and no55453 listener
or postmaster. Recursive physical-file removal was rejected twice by automatic
approval review (`blocked by policy`); a preceding controller comparison also
refused an overescaped path. No alternative deletion mechanism was used. The
stopped files remain at `C:/Users/user/.codex/tmp/lumi-issue594-pg17/` and require
local operator cleanup. **Complete physical teardown is BLOCKED, not certified.**

## Independent review, remaining blockers and rollback

Review source pinning and input refusal; catalog/ACL category completeness;
history semantics and no recovery normalization; positive-before-negative native
fixtures; sanitized states; raw SQL/network and unchanged digest evidence;
test counts/omissions and physical teardown. No author evidence is independent
acceptance. Hosted CI is separate; zero executed steps means NOT_TESTED. Issue593's
standing deferral ends2026-10-31 23:59:59 Africa/Cairo; it is not CI PASS or merge
permission, and no new exception is requested here.

Full backend database-suite execution, production roles/native receipts/76 incident
recovery, verified backup/restore, migration ownership, managed-host compatibility,
auth/OAuth/vault/tenant proofs, workers/provider/Redis activity, old/new rolling
compatibility, trusted issuers and runtime admission/revalidation remain separate
gates. Capture-v1 membershipCoverage remains UNKNOWN. The five approved02A
principles and Constitution R-8 are unchanged: per-entity qualifying provenance,
proven applicable cohort for relative judgments, original historical provenance/
freshness preserved, old snapshots UNKNOWN, connector health explanatory.

Production was not contacted. No Render settings, SQL, migration, runtime wiring,
activation, frontend or deployment changed. Revert these three additions to undo
this code slice; there is no persistent application state to roll back. Never
infer destructive down-migration, receipt rewriting or a production rollback
plan from disposable-lab teardown. **Stop at one Draft PR and ChatGPT independent
review. Omar must separately approve any merge. Backend Gates B/C stay BLOCKED.**
