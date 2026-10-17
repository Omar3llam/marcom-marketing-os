# Backend 03A — build / operator migration boundary

2026-10-17. Issue [#579](https://github.com/Omar3llam/marcom-marketing-os/issues/579).
**Code review only; operational cutover requires separate approval.** Backend
Gates B/C remain BLOCKED. No product principle, R-8, eligibility, schema,
migration, provider, runtime behavior or frontend source is changed. PR #578
remains separate, draft and unmodified; no migration 76 is present in this PR.

## 1. Verified baseline and authority

Fresh `origin/master`: `9b48f32826e03f7e11b7a15054df05d67001f834` (#577 merged).
Only preexisting open PR: #578 at `a4b9634d720ade43fcce04fd4a625c9d4ace2df3`.
Work started on `codex/backend-03a-build-isolation` from master in an isolated,
clean checkout. Unrelated primary-checkout files were preserved. Read CLAUDE.md,
Product Truth Rulings / approved PR-1–PR-13, design-governance README/Review Gate,
02A and 02B-0G. Phase/design and provenance implementation approvals do not follow
from this slice. Historical local CI exceptions do not transfer.

### Configuration metadata only — observed 2026-10-17

No env-var endpoint, credentials, production database, service shell, provider or
production HTTP endpoint was accessed. Read-only Render service metadata:

| Setting | Live Web `LUMI` | Live `lumi-worker` | Proposed tracked source |
|---|---|---|---|
| Branch | master | master | retain master |
| Build | `npm install && npm run build && npm run migrate` | `npm install && npx prisma generate` | Web: `npm ci --include=dev && npm run build`; Worker: `npm ci --include=dev && npm run build:worker` |
| Start | `node src/server.js` | `node src/workers/index.js` | existing `npm start` / `npm run worker` |
| Auto-deploy | off | commit/on | off on BOTH |
| Parent service previews | off | off | Blueprint preview generation off; independent service previews omitted |
| Predeploy | NOT_RETURNED | NOT_RETURNED | absent; no automatic DDL |
| Health path | empty | not applicable | Web existing `/api/health` retained |

An omitted API field does not prove the live predeploy command is empty. That
must be attested separately in Dashboard. Source Worker had a migration gate;
live Worker does not. Source Web and live Web differ, including health and
install/migration ownership. These are **OPEN release blockers**, not changed by
pushing a branch. No live configuration was changed. Never sync this Blueprint
as a shortcut: its historical resource/database wiring is not attested to the
current Neon deployment. Service names also differ (`lumi-backend` vs `LUMI`).

## 2. Path classification and minimal correction

| Class | Path | Before / after |
|---|---|---|
| BUILD | root `build` | implicit install, generate, Prisma deploy/diff, Vite → generate + existing client build only |
| BUILD | `build:backend` | unchanged: generate, syntax/alias check, parse/link boot-check; client optional |
| BUILD | new `build:worker` | delegates to the unchanged backend build; does not start workers |
| BUILD | Render Web / Worker candidates | explicit lockfile install + corresponding pure build; no predeploy DDL |
| BUILD lifecycle | root `prepare`, `prestart` | unchanged Husky / syntax check; no SQL; workspaces have no install hooks |
| BUILD dependency lifecycle | Prisma client/engines postinstall | generation/engine installation, not migration; real install verified separately |
| EXPLICIT OPERATOR DDL | `db:migrate:deploy` | existing `prisma-migrate-safe.js`: forward deploy + classified schema diff; retains retry bounds, fail-closed mismatch and terminal P3005/P3009 behavior |
| EXPLICIT OPERATOR DDL | `db:migrate:legacy` | unchanged `migrate.js` SQL: pgcrypto, sessions, indexes, touch function/drop+create trigger |
| EXPLICIT local tools | `prisma:migrate`, `prisma:push`, `seed` | existing development/manual commands, not a release path or production authorization |
| STARTUP | `src/server.js:477` and four `ensure*Schema` methods | unchanged: raw sessions ALTER/unique/index, user-context CREATE, project CREATE/ALTER/index, credentials CREATE/ALTER/index + workspace backfill/duplicate deactivation |
| STARTUP | `src/workers/index.js` | unchanged execution/sync/agentic/narrative/maintenance workers and scheduling; connects Redis and can run DB/provider jobs |

`prestart` itself is only a static check. Actual API/worker startup is **not
database independent**. Server schema ensures run after listen and log/catch
failures; existing `/api/health` does not certify schema or migration readiness.
This slice does not clean up startup SQL or establish a least-privilege runtime
role. Worker data access/scheduling and restart behavior need an approved rollout
plan; pure compilation cannot certify those. Boot-check exits at the existing
blank-env configuration gate, before execution, proving parse/link only.

The execution worker retains `assertExecutionSchemaReady`: its read-only check
compares shipped migration names with history rows having `finished_at IS NOT
NULL`, caching success. It is not a native-catalog/ownership check or authorization
to deploy an unshipped pending migration. Its historical “backend migrates”
comments describe the old rollout; the proposed owner contract supersedes that
assumption without changing worker behavior.

The old `migrate` and misleading `build:migrate` aliases are removed. Existing
live Web's trailing `npm run migrate` will fail until separately changed; there
is no silent compatibility alias that still runs DDL. Root build now expects
dependencies installed first. Prisma generation, legacy UI compilation and
serving defaults are preserved. Compilation of unchanged UI source in a local
fixture verifies the issue's explicit build requirement; no frontend redesign,
source rebuild project or hosted rebuild/deployment is performed.

## 3. One migration owner and H-1

**One named migration owner**, appointed in a separate approved operational plan,
runs `npm run db:migrate:deploy` from an immutable approved checkout using the
qualified direct migration connection and operator role. Never run this as either
service's build, predeploy, prestart, lifecycle or worker bootstrap command.
Legacy SQL, if required, is a separately authorized `npm run db:migrate:legacy`
operation by that same owner; it is not automatically chained to Prisma.
These command names are an operational boundary, not an authorization system.
Direct script/Prisma CLI access still requires the same human approval.

The explicit legacy command fails with exit 1 and an error when `DATABASE_URL`
is absent or empty, before constructing a database client or attempting SQL.
A successful command exit does not prove the correct production target identity,
privileges, backup or recovery readiness; those require separate qualification.
This P1 correction follows [independent review](https://github.com/Omar3llam/marcom-marketing-os/pull/580#issuecomment-6233404710)
of `d86aeb4dd67cf0f399c913f761f90596b4c374df`. Section 5 preserves that head's
original 03A measurements; the corrective head and its new verification evidence
are recorded separately in PR #580 for independent re-review.

The existing gate retains connectivity/advisory-lock retries for a newly approved
migration operation. It performs no automatic resolve. This PR does not authorize
calling it against the unresolved incident, a retry, resolve or repair. Prisma
schema diff does not verify native roles, ownership, grants or all native DDL.

**H-1 / NO-DEPLOY FREEZE:** after `resolve --rolled-back`, Prisma 5.22.0 status
may exit 0 with “Database schema is up to date!” while that migration is pending
for deploy selection. Resolve never undoes SQL. Inspect `_prisma_migrations`
including checksum, original failed receipt, finished/rolled-back timestamps and
steps, AND native catalogs for all affected tables/types/constraints/indexes/
functions/triggers/ownership/ACLs. Reconcile against immutable migration bytes.
Keep both services, previews, manual builds/predeploys and operator deploy commands
frozen until separate incident recovery and cutover approval. Status alone is
not schema presence, recovery or a readiness signal.

Evidence source: PR #578 isolated recovery specification
[#6195613762](https://github.com/Omar3llam/marcom-marketing-os/pull/578#issuecomment-6195613762)
and independent evidence review
[#6196437358](https://github.com/Omar3llam/marcom-marketing-os/pull/578#issuecomment-6196437358).
03A's synthetic H-1 diagnostic control tests
the warning/failure behavior; it does not rerun that production incident or claim
that the synthetic CLI output is a real database measurement.

## 4. Proposed coordinated cutover — NOT AUTHORIZED / NOT EXECUTED

1. Independently review this immutable head. Hosted CI must execute; zero-step
   billing failures are NOT_TESTED. No CI exception is requested by this slice.
2. Obtain separate Product Owner approval for one operator, incident recovery,
   backup/recovery, role/privilege inspection and the complete two-service plan.
   Before any merge, attest Worker auto-deploy OFF, Web OFF, parent previews OFF,
   no production-connected preview/environment and empty predeploy on BOTH. No
   secret values should enter evidence. Build credentials/DB target separation
   must be attested operationally; a pure script does not remove inherited secrets.
3. With writer/scheduler quiescence separately planned, capture a recoverable
   backup plus history/native catalogs/roles/ACLs and verify isolated restore,
   recovery point, retention, ownership and exact restoration procedure. The #578
   rehearsal is evidence to review, not automatic approval of a live restore.
4. The one migration owner qualifies any required migration on the direct
   connection, with schema-specific privileges and native verification. A pooler
   is not the migration target. Do not infer the role's privileges from a host
   name, or use runtime roles for DDL. No #578 schema deployment is authorized
   here; the unresolved failed history prevents any casual migrate deploy.
5. Separately approved Dashboard edits: Web build exactly
   `npm ci --include=dev && npm run build`, Worker build exactly
   `npm ci --include=dev && npm run build:worker`; remove Web trailing legacy
   migrate and any predeploy SQL on BOTH. Preserve starts until explicitly reviewed
   (live direct node vs source npm wrapper is drift, not a silent change).
   Attest Web health configuration; `/api/health` alone is insufficient for DB
   readiness. Read back effective commands and settings before a build/restart.
6. Only after history + native catalog compatibility passes and approved startup
   SQL/role handling is qualified, roll out Web at one immutable approved SHA,
   verify API/auth/legacy SPA and startup logs, then Worker at the SAME SHA,
   verify scheduling, job completion and absence of unauthorized provider actions.
   Worker stays stopped/held if Web or schema verification fails. This sequence
   is a proposal pending assessment of queue quiescence and old/new coexistence.
7. Keep auto-deploy/previews off through independent operational signoff. Do not
   enable capture, declare incident recovery or close Gates B/C from this PR.

**Non-destructive rollback proposal:** stop/hold Worker and automatic scheduling
under the approved plan; restore previously qualified service artifacts at the
same coordinated version while retaining pure build/empty predeploy settings.
Never restore the old migration-bearing root build as a rollback. Old versions'
schema and startup SQL compatibility must be proven before reuse. Do not drop
objects, undo migrations, rewrite history or restore DB automatically. If state
has changed, retain evidence and invoke a separately approved recovery plan with
writer quiescence and isolated restore proof.

## 5. Verification and review evidence

The fixture uses the real npm runner, actual checked-in manifests, checks and
migration entrypoints, deliberately unreachable loopback database URLs, protected
Prisma/Postgres CLI shims, a rejecting postgres constructor and an inherited
network guard. Only install fetching and the Vite compiler are inert in that
fixture; its claim is command reachability. Reintroduced lifecycle deploy,
resolve, legacy SQL and psql calls must fail and leave a recorded violation,
including swallowed errors. Real install/build regressions provide separate
compilation evidence. The repository network guard remains unchanged.

The old AllocationPlan deployment test required automatic migration in both
builds, directly conflicting with #579. Its replacement asserts source release
fences and the declared operator/rollout contract; it does **not** supply automated
deployment-order enforcement. That operational gap remains OPEN. The campaign
parity test still requires client compilation in the Web build at the same commit,
now following `build:client`; its enum, open-vocabulary and required-array assertions
are preserved. All database migration safety assertions remain available unchanged.

Environment: Windows x64, Node **24.20.0**, npm **11.19.0**, Prisma CLI/client
**5.22.0** (engine `605197351a3c8bdd595af2d2a9bc3025bca48ea2`), PostgreSQL
**17.11** on a fresh loopback-only cluster at `127.0.0.1:55435`. Full verification
uses its own migrated template and 12 physical worker databases, with the existing
43-file DB-required census and network guard. No application schema/migration or
test-runner/timeout/skip policy was changed.

| Actual verification | Result |
|---|---|
| Definitive final ratchet on archived master, with only new tests injected | **RED:** 7 fail / 10 pass; root deploy reachability, missing Worker entrypoint/source fences, H-1 diagnostic reproduced |
| Initial corrected fixture GREEN | 1 suite / 15 pass; later two controls add exact old Worker command and swallowed socket recording |
| Focused build/lifecycle/corpus regression | 4 suites / 27 pass |
| Focused build, same-commit client parity, release contract and two timeout repeats | 5 suites / 53 pass |
| Fresh real full install | 944 packages, exit 0; root prepare ran; vendor-script policy limitations below |
| Real `npm run build` with unreachable DB URLs and inherited guard | PASS; Prisma generation + unchanged Vite client build, no migration/socket violation |
| Fresh client-absent `npm run install:backend` | 547 packages, exit 0; no React or client Vite plugin, no client directory |
| Guarded client-absent `npm run build:backend` and `npm run build:worker` | Both PASS; each runs Prisma generation, `npm run check` (860 files), `npm run boot-check` (860 parses + real server graph link) |
| Final real-build audit | Zero forbidden network/DDL events; tool provisioning is separately scoped below |
| Full present-client architecture/security | PASS; 9 existing architecture warnings, zero security warnings |
| Backend architecture/security, with and without client | PASS; 5 architecture warnings, zero security warnings |
| Full-scope checks without client | Both correctly exit 1, explicit missing-source error |
| `npm run test:legacy-contracts` | 6 suites / 34 pass |
| First full DB run, client present | 450 suites pass / 3 fail; 6,982 tests pass / 3 fail, zero skips; preserved, not represented as green |
| Final `npm run test:full`, entire client absent | **453 suites / 6,985 tests PASS; zero skipped**, isolated migrated PostgreSQL17 |
| Blueprint against current public draft2020-12 schema (Ajv8.17.1) | PASS; two deprecated `env: node` aliases minimally changed to same `runtime: node`; no sync/apply |
| Documentation/source whitespace check | `git diff --check` PASS |

Exact commands and raw logs are supplied in `LUMI_BACKEND_03A_EVIDENCE.zip`, with
`COMMANDS.md`, `reproduce-builds.ps1`, guards, metadata, JSON results, source diff
and checksums. Evidence is a local deliverable, not a claim of a hosted artifact.
The immutable PR head and final hosted check status are recorded in the PR.

Earlier failures are preserved: the first fixture had a Windows preload-path
escaping error (harness failure); the first real root build had only backend
dependencies installed and lacked Vite. Fresh full install corrected that.
npm11.19 warned of unapproved dependency install scripts, so **not every vendor
postinstall is claimed executed**. Missing compiler engines attempted downloads,
rejected by the strict build guard. The harness explicitly provisions pinned
Prisma compiler binaries with DB URLs blank/no .env outside the measured build
step, then runs the real commands with unreachable DB URLs and the guard active.
That setup may download public compiler binaries, never database data. It does
not relax the measured command guard or silently alter package-manager policy.

The first full DB run exposed the old direct build-spelling parity assertion;
it now follows the alias while retaining same-commit client compilation. Two
other tests (`executionLifecycleIntegrity.wiring`, `legacyActionRetirement`) hit
their unchanged 5-second timeouts during concurrent installation/build activity.
Both pass in the focused repeat and final unmodified-width full run. No timeout,
worker count, retry, network isolation or assertion was relaxed to fix those.

The full React/jsdom suite, browser E2E, real API/worker runtime, live provider,
production restore and deployment are **NOT_TESTED** here. Controlled API/worker
lifecycle fixtures, frontend-serving unit cases, DB migration terminal-state,
schema-diff and no-auto-resolve assertions execute in the final full backend run.
Hosted CI is separate: preexisting master/#578 had zero-step failures. A new-head
zero-step failure is NOT_TESTED and carries no CI exception.

### Changed paths and reasons

- `package.json`: pure root build, explicit operator command names, Worker build alias.
- `render.yaml`: pure lockfile build candidates, source release/preview fences, current Node runtime field syntax.
- `scripts/prisma-migrate-safe.js`: ownership comments and H-1/freeze diagnostics; deploy, retry, diff and terminal behavior retained.
- `scripts/migrate.js`: correct operator-only comment; SQL unchanged.
- `src/tests/buildMigrationBoundary.test.js`: first-party command/hook allowlist, real npm dispatch, mutation/recorder controls and H-1.
- `src/tests/fixtures/buildBoundary.fixture.js`: disposable subjects, protected tools, real checks/migration entrypoints and I/O recording.
- `src/tests/allocationPlanStorageDeployment.test.js`: replace conflicting automatic-build migration assertion with declared source fences/owner contract; operational enforcement gap explicit.
- `src/tests/connectorCampaignsParity.test.js`: preserve same-commit client build assertion through the new alias; vocabulary/assertions retained.
- `src/tests/productionMigrationSafety.test.js`: correct obsolete build invocation comment; assertions unchanged.
- `DEPLOYMENT-MIGRATION-GUIDE.md`: explicit ownership, H-1/history/native checks, freeze and non-destructive rollback correction.
- `docs/BACKEND_INDEPENDENCE_SLICE_01.md`: mark its historical migration-bearing root build contract superseded by 03A.
- This document: discovery, classification, evidence, limitations, cutover/rollback proposal and review gate.

## 6. Independent review / remaining blockers

Review command reachability and lifecycle coverage, positive mutation controls,
client-absent builds, unchanged migration safeguards, explicit operator ownership,
H-1 freeze, Render source/live drift, startup SQL and rollback hazards. Requested
state is CODE_REVIEW_READY only, never production ready. Live predeploy field
omission, Worker auto-deploy, schema/history recovery, runtime ownership/privileges,
backup recovery and coordinated rollout remain OPEN pending separate approval.
Backend Gates B/C remain BLOCKED; capture/eligibility and roadmap work are outside
this PR. PR #578 has not been altered.
