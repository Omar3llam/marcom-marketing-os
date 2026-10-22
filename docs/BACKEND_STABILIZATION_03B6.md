# 03B-6 — API startup refuses unqualified admission

Baseline: `549ada9781dfdf86469b72997d4e0f674098dfda` (merged #606).
**Source-only preparatory implementation. NOT_RELEASE_QUALIFIED. B/C BLOCKED.**

## Executable boundary and deliberate refusal

`startServer()` now throws `API_ADMISSION_UNQUALIFIED` before producer Queue
initialization, HTTP listening, DB access or shutdown registration. No real
whole-process proof issuer exists: the #589 evaluator remains SYNTHETIC_ONLY /
NOT_WIRED; the identity and canonical/history observers remain lab-only, including
NOT_MEASURED tenant boundaries. None can be promoted to startup authority.
There is no accepted proof argument, callback, environment bypass or READY path.
No production probe is introduced merely to produce an incomplete observation.

**The default API command refuses in development and production. Do not deploy
this as an availability-preserving update.** The CLI logs a fixed sanitized error
code and exits1. Explicit exit prevents existing import-time in-memory timers
from retaining a refused process. Config validation can also independently fail
before reaching the refusal. Successful syntax/static linking is not startup
admission and does not mean the API can now be released.

All four automatic schema-ensure imports/calls are removed from server startup.
The model functions/native DDL, operator provisioning source, sealed v1/v2
manifests/loader, Prisma schema and all migration sources are unchanged. No boot
ensure is relocated to another helper, import, worker, build or retry. Future
operator-owned provisioning remains subject to its separate approval/target gates.
Queue initialization also no longer catches failure and continues into HTTP;
its preserved body is unreachable until a separately reviewed real admission
implementation replaces the deliberate refusal.

API routes, middleware/mount order, auth, workspace isolation, OAuth, request-time
session/context/project/credential operations and health response semantics remain
unchanged. Default app export remains for existing isolated request tests. Worker
source and its non-bypassable WORKER_ADMISSION_UNQUALIFIED refusal are unchanged.

## Exact file scope

| File | Reason |
|---|---|
| `src/server.js` | Unconditional early refusal; remove four boot ensures and Queue fail-open catch; deterministic CLI failure exit. |
| `src/tests/apiStartupBoundary.test.js` | 15 executable startup/import/negative-authority/CLI regressions. |
| `src/tests/startupAdmission.contract.test.js` | Update only server source pin and historical boot assertions into ensure-absence and admission-order assertions. Preserve other pins, candidate trust tests and Worker/security assertions. |
| This document | Evidence, actual limitations, rollback and release blockers. |

The new tests use fresh native Node processes because the complete cyclic route
graph timed out under the initial Vitest import fixture. Focused startup cases
use20 inert route handlers, intercepted DB and installed Redis/BullMQ mocks;
real server/registry/model bodies execute. They are synthetic ordering/refusal
tests, not production proof or request-route certification. A separate external
fresh-process probe imports the **complete installed graph without route/source
substitution**, intercepting sockets/listen/Redis/BullMQ/Prisma I/O. Both Redis
configured/disabled imports and actual CLI paths are measured; deliberate counter
controls detect HTTP, socket, Queue, Worker and Prisma activity. The import probe
ends its observation window explicitly; actual CLI probes must exit themselves.

Static import effects still include config/dotenv reads, Firebase SDK initialization
and the SSE in-memory expiry timer. This slice does not claim an import-free
application. Credential-free installed-graph observations found no I/O, but do not
qualify an arbitrary production environment or the authenticity of real proofs.

## RED / GREEN and safety evidence

External `lumi-api-startup-03b6` evidence retains exact argv/environment receipts,
JSON case results, raw logs, saved RED sources, source/diff hashes, network journals,
PG17 process/physical/SQL identity and teardown. Initial failed fixtures remain:
missing synthetic config, two Vitest import-hook timeouts, one native-child deadline
and one collector/corpus assertion failure. Each executed **zero** startup cases;
none is represented as RED proof. Fixture corrections kept timeout limits intact.

| Actual verification | Result |
|---|---|
| Executable RED, reviewed server with final new tests | **1 pass / 14 fail / 0 skip**. Imports were inert; unqualified starts reached Queue/listener/19 DDL attempts, continued through Queue/DDL failures, and CLI attempted listening. All I/O intercepted; no actual DDL/customer write. |
| Same15 focused cases, corrected server | **15 pass / 0 fail / 0 skip**. Includes forged READY/lab outputs, boolean/callback/hostile claims, env/dev bypass attempts, failure paths, repeated calls and actual CLI nonzero exit. |
| Expanded startup/validator/Prisma/Redis/Worker/auth/admin/execution regressions | **679 pass / 0 fail / 99 skip**,45 files. DB skips covered by the separate full run. |
| Unchanged `npm run test:full` with REQUIRE_DB=1 | **7,537 pass / 0 fail / 0 skip**. Isolated PostgreSQL17.11, Prisma5.22.0, Node24.20.0; unchanged discovery,12 workers and test-owned76-migration provisioning. |
| Complete installed graph / CLI observations | Four PASS observations, all activity counters0; imports exit0 after explicit observation end, actual CLI exits1 naturally. |
| Instrumentation controls | Five PASS controls; exactly the intended forbidden operation detected in each. |
| `npm run check`; `npm run boot-check` | PASS:878 syntax checks;877 parses and full server static graph link. No runtime boot claim. |
| `npm run lint`; `npm run arch-check:backend`; `npm run security-check:backend` | PASS:0 errors /32 existing lint warnings;0 failures /5 existing architecture warnings;0 security failures /warnings. |
| `npm run build:backend` | PASS: Prisma generation, syntax validation and static graph linking; no build-time migration or UI artifact. |

The full suite uses the previously approved **isolated local test provisioning
only** permission; it does not authorize production migration or recovery. The
first candidate port55567 was occupied and rejected before init/SQL. The new owned
physical lab uses loopback55487, system ID `7699425360894514868`, dedicated synthetic
role/databases. No application .env or inherited DB/provider credentials. Offline
dependency reuse has42-source parity; fresh install is separately required in CI.
The repository network guard is unchanged; external Node journals additionally
constrain commands/targets. Native Prisma target binding is checked through the
owned lab identity and explicit URLs; journals are not a packet capture.

After full verification, only postgres/template0/template1 remained. pg_ctl stop
exit0; PID file absent and listener closed. Physical files are retained; no recursive
deletion workaround of the earlier policy rejection. No existing DB was used.
Final static gates, hosted job steps, exact immutable head and archive SHA256 are
recorded in the Draft PR. Historical/initial failures remain alongside final results.

## Release prerequisites and rollback

Unavailable real authority remains the blocker: independently qualified target /
runtime-role/session bindings, least privileges and tenant boundaries, exact legacy
and canonical native/history contracts, failed/rolled-back #76 history policy,
auth/session/OAuth/vault/credential lifecycle and account-selection authority,
freshness/coherent observation/revalidation and old/new Web+Worker compatibility.
H-1 backup/recovery and separately approved migration/provisioning/cutover plans
remain necessary. No partial schema/health/Redis result closes these gaps.
The historical `scripts/backend-runtime-smoke.js` expects bootable API/Worker
processes and is not a valid success gate for this deliberately refused candidate;
it is NOT_TESTED here. It must not be used to bypass admission or claim readiness.

Before deployment, reverting this source change has no persistent data to reverse,
but restores unsafe automatic DDL and fail-open startup. A historical binary is
not a qualified production fallback. Any future release needs a separately reviewed
no-boot-write rollback binary and controlled traffic/Web/Worker rollout, plus Omar's
explicit merge/deployment decisions. No inverse DDL, receipt repair, credential
selection or restore is implied. **Stop at Draft PR and independent review.**
