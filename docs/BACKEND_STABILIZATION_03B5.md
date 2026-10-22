# 03B-5 — explicit Redis preparation; Worker activation refused

Issue [#605](https://github.com/Omar3llam/marcom-marketing-os/issues/605).
Base `1be71c336de09bb8231ab88309b4d1d03b398022`. Source-only candidate;
**NOT_RELEASE_QUALIFIED. Backend Gates B/C remain BLOCKED.**

## Actual protection and deliberate stop

Previously, importing `queues/connection.js` started an asynchronous connect and
CONFIG GET; an unknown/unsafe policy only logged. Importing `queues/index.js`
constructed six BullMQ Queues, whose constructors initialize Redis clients.
Importing the Worker entrypoint started five consumers and schedules.

Now the shared IORedis client is lazy, with no import-time connect/CONFIG. All six
queue exports start null. `initializeQueues()` explicitly awaits
`verifyRedisReadiness()`, constructs the original queues, awaits their readiness,
then publishes the live ESM bindings atomically. Existing request-time clients,
queue names, prefix, retry/backoff, retention and execution jobId remain intact.
No job is added by this initializer. BullMQ's own metadata initialization occurs
only after explicit Redis validation, not during module import.

The read-only Redis observation accepts exactly CONFIG GET maxmemory-policy /
noeviction on the actual ready client; missing, malformed, denied, unsafe or
timed-out observations refuse. Its returned client reference is the identity
binding, not a serialized authorization token. Probe and queue preparation each
have a five-second readiness deadline, with a separate one-second best-effort
queue cleanup budget. No global Redis command timeout is imposed on
BullMQ's blocking commands. Late probe completion cannot issue CONFIG after
timeout. Errors log fixed codes, never Redis URLs or provider error messages.

Reconnect attempts remain capped at five **during explicit validation only**.
An established connection does not automatically reconnect and reuse an old
policy observation. Reinitialization/restart must validate again. No retry or
policy-bypass environment flag is added. This is a stricter failure boundary,
not a Redis recovery/liveness certification; a policy change after observation
is not continuously monitored or qualified by this slice.

**Default `npm run worker` now refuses activation.** It may attempt the explicit
Redis observation, but then `requireQualifiedWorkerStartup()` unconditionally
refuses with WORKER_ADMISSION_UNQUALIFIED, before queue construction, every
consumer, heartbeat or schedule. There is no caller boolean or env escape hatch.
The existing consumer factories, concurrency, processors, execution checks,
idempotency and schedule definitions remain unchanged. The protected bootstrap
retains their ordering and graceful shutdown, with queue/client cleanup added.
They are deliberately unreachable through the default command until a later,
separately approved real admission implementation replaces this refusal.

This is the safe preparatory boundary requested by #605: Redis integrity cannot
authorize tenant, credential, provider, migration-history or maintenance work.
No synthetic admission/classifier is wired or duplicated. This PR must not be
deployed as an ordinary availability-preserving Worker update.

## API compatibility boundary

The real CLI calls `startServer()`, which explicitly prepares configured Redis
before opening the listener. Missing/disabled Redis still leaves queue exports
null and existing queue-dependent route guards available to return 503. A failed
initializer publishes no handles and does not downgrade the eviction policy.
Existing rate-limit and webhook replay consumers retain the same lazy client;
their request-time policies are not changed. In particular, a configured shared
rate-limit store is not silently replaced with a permissive fallback after an
initialization error; its existing error behavior can still refuse requests.

Importing the API entrypoint no longer opens its listener or activates queues.
Middleware/authentication, route order, OAuth, execution and credential lifecycle
modules are unchanged. The four legacy SQL ensures still run after API listening;
their fail-open behavior remains an explicit separate blocker, not repaired or
certified here. Other API import effects, including the existing events-route
memory-cleanup interval, are outside this Redis boundary.

## Exact scope

| File | Reason |
|---|---|
| `src/queues/connection.js` | Remove automatic I/O; explicit bounded noeviction observation, sanitized failure and cleanup. |
| `src/queues/index.js` | Deferred producer registry; atomic publication and shutdown/cancellation cleanup. Schedule/job bodies unchanged. |
| `src/workers/index.js` | Inert import; awaited Redis step and non-bypassable refusal before unqualified activation; retain protected consumer/shutdown body. |
| `src/server.js` | Explicit CLI producer initialization and cleanup; inert entrypoint import. |
| `src/queues/startupBoundary.test.js` | Actual module/entrypoint transitions under complete Redis/BullMQ/consumer mocks; negative ordering, deadlines, redaction and compatibility assertions. |
| `src/workers/maintenanceWorker.test.js` | Explicitly initialize mocked queues; preserve every original schedule/job assertion and timeout. |
| `src/tests/startupAdmission.contract.test.js` | Update only the two intentionally changed source pins and strengthen ordering assertions; retain other pins, forbidden work and security requirements. |
| This document | Evidence, behavioral changes, rollback and remaining release blockers. |

No package/lockfile, schema, migration, OAuth, processor, frontend, CI or Render
configuration changes. Frozen legacy native source/manifest authority is unchanged.

## Verification evidence

Raw RED, intermediate failures, JSON case reports, invocation receipts, source
hashes, network journals and local PG17 identity/stop receipts are retained in the
external `lumi-issue605-redis-boundary` evidence package. No old result is presented
as execution on this candidate. Final immutable head and hosted readback are in
the Draft PR; hosted results are not inferred from this table.

| Actual command / subject | Result |
|---|---|
| RED `npm run test:fast -- src/queues/startupBoundary.test.js` | 0 pass / **17 fail** / 0 skip. Four cases directly reproduce import effects; remaining cases also expose missing explicit APIs, not proven negative branch coverage. |
| First candidate focused run | 17 pass / 0 fail / 0 skip. |
| Initial worker/HTTP/auth/admission regressions | 422 pass / **6 fail** / 99 skip: five maintenance cases still assumed implicit queue construction; one source-pin assertion expected old boot bytes. Original assertions retained; explicit mocked initialization and reviewed pins updated. |
| Expanded focused regressions | **449 pass / 0 fail / 99 skip**, including OAuth/execution/Worker/rate-limit/replay/Prisma/admission checks. Fast-mode DB skips are not DB evidence. |
| Final new boundary + maintenance tests | **32 pass / 0 fail / 0 skip** (22 boundary, 10 existing maintenance cases). |
| First `npm run test:full` | **7,493 pass / 10 fail / 7 skip**. External harness rejected restricted synthetic role/database names, migration diff/status, and deliberately unusable DB fixture. Hook/command failures retained. |
| Corrected external harness; unchanged full-suite assertions/timeouts | **7,511 pass / 0 fail / 0 skip**, 464 files, exit0; PostgreSQL17.11, Prisma5.22.0, 12 isolated worker databases, real 76-migration provisioning. Final source also removes the intermediate global command timeout and tests bounded queue preparation, preserving blocking-command semantics. |
| `npm run test:fast` | **6,872 pass / 0 fail / 639 skip**, 464 files, exit0. Those 639 DB skips are covered by the separate full run, not waived. |
| `npm run test:legacy-contracts` | Initial **32 pass / 2 fail / 0 skip**: two unchanged source-scan cases reported STACK_TRACE_ERROR at ~5.25s; cause NOT_PROVEN. Unchanged repeat **34 pass / 0 fail / 0 skip**. No frontend/test/timeout edit. |
| Fresh-process installed-library import probes | Four probes (connection/registry/Worker/API): **0 sockets, connects, CONFIG calls, Queue or Worker constructions**. Four deliberate counter controls plus the actual missing-Redis Worker CLI control PASS; CLI exits1 without consumers/schedules. |
| `npm run check` | PASS: 876 syntax checks, no backend aliases. |
| `npm run boot-check` | PASS: 875 parses and full server static graph link; not live boot certification. |
| `npm run arch-check:backend` | PASS: 0 failures / 5 existing warnings. |
| `npm run security-check:backend` | PASS: 0 failures / 0 warnings. |
| `npm run lint` | PASS: 0 errors / 32 warnings outside the changed files. |
| `npm run build:backend` | PASS: Prisma generation + syntax/static linking; no migration or UI build. Client-absent fresh installation/build is separately exercised by hosted CI. |

The first external import harness waited for whole-process exit and timed out
on the API's existing events-route interval; the corrected probe explicitly ends
its observation window and makes no process-liveness claim. Initial constructor
counter controls also had a fixture expression error; corrected controls detect
the real constructors. Original harnesses/logs/results are retained. These are
external evidence corrections, not repository test weakening or product changes.

Safety: pinned Node24.20.0, offline copied dependencies with normalized parity
checks against package/lockfile/Prisma/workspace sources (not a fresh-install
claim), empty private profile, no application .env or inherited provider/DB
credentials. Repository networkGuard and all existing timeouts remain unchanged.
The user separately approved unchanged full-suite migration provisioning **only
inside a newly created verified local PG17 cluster**. This does not authorize a
production migration, history repair or use of any existing database.

Local PG17 target: loopback55565, new dedicated data directory, verified physical
system ID `7699390223621408168`, with process/path and SQL identity receipts.
Final full-run external journal has zero forbidden events. After tests, only
postgres/template0/template1 remained; pg_ctl stop exited0 and postmaster.pid is
absent. **Physical lab files remain:** automatic approval review rejected recursive
deletion (`blocked by policy`). No deletion workaround was attempted. The original
start helper's process-tree wait also delayed its redundant metadata check until
after shutdown; the separate successful preflight receipt, not that helper, bound
all DB testing to the owned running cluster. No production target was involved.

## Release and rollback blockers

Production Redis policy/identity, real Redis fault recovery, real auth/tenant
permissions, H-1 backup/restore, failed #76 production history/native roles,
credential reconciliation decisions and old/new Web+Worker compatibility remain
unqualified. No production/Neon/Render connection, credential access, provider
action, activation, deployment or merge occurs in this task. Hosted CI must be
reported by actual job-step execution, separately from local PG17 results.

Before any later release: independently qualify real whole-process admission and
its source/target/session/freshness boundaries; prove all five consumers and all
schedules remain stopped until permission; qualify restore/recovery and mixed
binary behavior; obtain Omar's separate merge and deployment approvals. A source
merge does not grant these permissions. Redis health alone cannot close B/C.

Before deployment, reverting this source patch has no persistent data to reverse.
After any future cutover, restarting an old binary can restore import-time Redis
operations and unqualified Worker activation: that is not a qualified rollback.
Use a separately reviewed fallback binary/runbook; no automatic rollback,
inverse DDL or receipt rewriting is implied. Stop at Draft PR / independent review.

## PR #606 independent-review corrections

Reviewed head `039c479a1715df117f9947207ff0ec450b1c3380`; master remains
`1be71c336de09bb8231ab88309b4d1d03b398022`. Corrections address F-1/F-2 in
[review 5611239014](https://github.com/Omar3llam/marcom-marketing-os/pull/606#pullrequestreview-5611239014).

Corrective delta: `src/routes/admin/status.js` reads live registry bindings inside
each status request. New `src/routes/admin/status.lifecycle.test.js` imports the
real router before initialization and exercises the real auth/admin guards:
disabled → six actual counts → disabled, per-queue failure isolation, anonymous 401
and non-admin 403. Response keys and mount authorization remain unchanged.

`src/queues/index.js` bounds best-effort close attempts to one second. Every close
is attempted, synchronous throws and late rejections are consumed, and deadline
expiry disconnects the shared client. Bindings clear before public cleanup;
failed readiness never publishes them. The registry epoch is also checked before
constructing Queues after an awaited Redis probe, preventing cancelled late work.
Four added `src/queues/startupBoundary.test.js` cases cover hanging close after
readiness timeout, hanging explicit cleanup, late cancelled probe and synchronous
close throws. All original assertions and timeout limits remain.

| Verification on corrective source | Actual result |
|---|---|
| RED: `npm run test:fast -- src/routes/admin/status.lifecycle.test.js src/queues/startupBoundary.test.js --reporter=json --outputFile=<evidence>/focused-red.json` | **27 pass / 6 fail / 0 skip**: two stale-status failures; readiness+cleanup still pending, explicit cleanup still pending, six constructions after cancellation, synchronous close error escaping. |
| Same command, GREEN output file | **33 pass / 0 fail / 0 skip**, same tests/assertions/timeouts. |
| Expanded fast regression: boundary, workers, rate-limit/replay stores, execution/auth/admin routes, admission contract and Prisma import guard | **665 pass / 0 fail / 99 skip**, 45 files; DB skips covered separately below. Exact path arguments in invocation receipt. |
| `npm run test:full -- --reporter=json --outputFile=<evidence>/full-green.json` | **7,522 pass / 0 fail / 0 skip**, 465 files, exit0, REQUIRE_DB=1; unchanged discovery and 12-worker isolated provisioning with all 76 migrations. |
| `npm run check`; `npm run boot-check` | PASS: 877 syntax checks; 876 parses and full server static graph link. |
| `npm run lint`; `npm run arch-check:backend`; `npm run security-check:backend` | PASS: 0 errors / 32 existing lint warnings; 0 failures / 5 existing architecture warnings; 0 security failures / warnings. |
| `npm run build:backend` | PASS: Prisma generation, syntax check and static graph linking; no build-time migration. |

New physical PostgreSQL17.11 lab: loopback55566, system ID
`7699408304509212840`, dedicated synthetic role/databases, Prisma5.22.0 and
Node24.20.0. Preflight binds physical/process/SQL identities before testing.
No inherited credentials or application .env; unchanged repository network guard
plus external command/socket journals. The suite removed its template/worker and
fixture databases; only postgres/template0/template1 remained. pg_ctl stop exited0,
postmaster.pid is absent and the listener closed. Physical lab files are retained;
no recursive-deletion workaround of the earlier policy rejection was attempted.

External `lumi-pr606-review-fixes` evidence preserves original RED JSON and test
sources, GREEN JSON, command/exit receipts, journals, lab identity and teardown.
The Draft PR records final source/diff hashes, package checksum, local static gates
and actual hosted job steps on its new immutable head. Earlier-head CI is historical.

The cleanup bound limits waiting; it cannot prove a broken BullMQ close actually
released every resource. Real Redis fault/recovery is NOT_TESTED. No new polling,
global command timeout, retry change, Worker activation or admission bypass.
Job/schedule bodies, OAuth, auth/tenant/execution implementation, schema and frontend
are unchanged by this correction. No persistent data rollback is needed; reverting
these fixes restores the two reviewed defects. All release/B/C blockers above remain.
