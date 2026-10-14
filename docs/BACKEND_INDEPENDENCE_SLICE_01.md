# Backend Independence Slice 01

Approved bounded implementation on 14 October 2026, based on master
`0660e9123f3583e7054336534512e8b3fb098949`. This slice establishes a backend
verification path. Backend Gates B/C and production cutover remain open.

## Installation and build

Use Node 24.20.x (`.nvmrc`) in a fresh checkout without `.env`:

```sh
npm run install:backend
npm run build:backend
```

The install uses `npm ci`, the committed root lockfile, the root package, and
only `@marcom/runtime-contracts` and `@marcom/api-contracts` workspaces. The
`client` workspace can be completely absent. React and the client Vite plugin
are not needed. Vitest has its own transitive Vite tooling; no client Vite build
is invoked. Prisma generation and backend parse/link checks run during build;
build does not call a migration or connect to a database. Migration deployment
remains a separate, explicit operation governed by existing procedures.

The existing `npm run build`, client workspace, frontend tests, production
serving default and Render configuration are retained. The old build still
includes its existing migration and client build behavior.

## Runtime

For a deployment intentionally serving only the backend, set:

```text
SERVE_FRONTEND=false
```

Unset preserves production SPA serving from `client/dist`. `true` preserves
that production behavior; it does not activate SPA serving in development.
Other values fail configuration rather than silently choosing a mode. With
`false`, Express registers no production static or SPA fallback. API/webhook
mounts, order, limits, CORS, identity, security and global error handling remain
unchanged. An unmatched browser GET returns Express 404. A protected unmatched
API request still reaches the existing authentication boundary; it cannot become
a 200 SPA response. When the flag is unset and assets are missing, the existing
SPA failure response is preserved.

No current live Render setting is changed by this slice.

## Verification scopes

```sh
npm run lint
npm run arch-check:backend
npm run security-check:backend
npm run test:full
```

`test:full` remains the repository-owned guarded runner, with the same automatic
discovery and isolated migrated PostgreSQL worker databases. Set
`TEST_DATABASE_URL` to a dedicated test naming/admin root with CREATEDB; keep
`DATABASE_URL` a different database identity. Never point either variable at
production. Full mode still fails when DB verification cannot execute, and the
network guard remains active. No DB suite is skipped to achieve independence.

For a checkout containing the client, also run:

```sh
npm run test:legacy-contracts
npm run test --workspace client
npm run arch-check
npm run security-check
npm run lint:ci --workspace client
npm run build --workspace client
npm run check:tokens --workspace client
```

The full static checks now require a nonempty client subject and refuse a missing
tree. Explicit backend scope runs all backend rules and reports frontend rules
as outside that scope. The default full scope retains frontend rules. Legacy
contract consumption, health-label parity, retired-memory and verdict-authority
consumer checks are in `tests/legacy-frontend`, with their own guarded runner and
a CI frontend step. Backend assertions from mixed tests remain in the backend
suite. The new mutation test proves a removed verified-email guard still fails
the backend security check when no client is present.

Eight existing transport schemas and seven error/retry modules live in
`packages/api-contracts`. Client paths are compatibility re-exports, preserving
object/class identity. Source implementations and semantics were extracted
unchanged. Backend parity and resilience tests use the independent location;
legacy schema reachability follows the compatibility entries. This TypeScript
source package is not a replacement for `packages/runtime-contracts`.

The backend Tests job and additional architecture job use sparse checkout with
the whole `client/` tree absent. The existing full architecture and frontend
jobs retain their safeguards. Hosted CI must execute or receive a new explicit
Product Owner decision for this PR; PR #573's exception does not apply.

## Reproducible runtime smoke

Provision dedicated loopback PostgreSQL and Redis fixtures with no advertising
credentials or customer rows. Create a database named `lumi_slice01_runtime`,
then explicitly apply existing Prisma migrations to that fixture. Supply:

```text
SMOKE_DATABASE_URL=postgresql://<local-test-user>@127.0.0.1:<port>/lumi_slice01_runtime
SMOKE_REDIS_URL=redis://127.0.0.1:<port>
```

```sh
node scripts/backend-runtime-smoke.js
# After the legacy client is built, verify the unchanged default:
node scripts/backend-runtime-smoke.js --legacy
```

The probe rejects `.env`, non-loopback infrastructure and a database outside the
`lumi_slice01_*` naming boundary. It passes an explicit synthetic environment,
creates an offline Firebase certificate, uses a random Redis queue prefix, and
verifies production API boot/health, unauthenticated API/webhook refusal and
browser 404 (or legacy SPA 200). Worker boot uses `NODE_ENV=test` so the existing
Redis policy permits local infrastructure; it verifies scheduling on empty local
queues. These are boot checks, not real provider authentication, advertising
execution, production readiness, or worker fault-recovery certification.

## Audit cross-reference and remaining work

The backend discovery report's F01 coupling is addressed by this bounded path;
the other Gate B/C findings remain open. The supplied October 13 audit package
is supplementary evidence, not implementation instructions. LUMI-01 describes
inbound API charging/polling, which differs from discovery F06's outbound
connector request accounting. LUMI-17/18 support observed currency refusal/UI
denomination concerns but do not prove F07 caused an incorrect production
verdict. Its execution notes corroborate the source `ON_READ` behavior in F08
while leaving actual writes and production impact unverified. No rate limiting,
polling, provider sync, decision, currency, AI, or schema policy is changed here.

Deployment drift remains recorded separately: Render metadata and deploy logs
disagree on the effective web build command; the live service differs from
`render.yaml` and has no configured health path. This slice does not reconcile
live settings or raw-table migration ownership. Hosted billing, Meta campaign
completeness, sync residuals, request accounting, currency provenance, sweep
semantics, security verification gaps, exact removal approval and rollback/cutover
remain Gate B/C blockers.

Rollback is a source revert of this slice. Default production continues to build
and serve the current frontend; there is no database migration to reverse. Any
future backend-only deployment must explicitly choose `SERVE_FRONTEND=false` and
an independently governed migration/runtime configuration.

## Local RED/GREEN evidence — 14 October 2026

RED used an immutable disposable sparse checkout of the reference SHA, with no
`client` directory, `.env`, or production credentials. PostgreSQL 18 on loopback
port 55431 and temporary Redis 8.10.2 on port 56381 were dedicated to this slice.
The API/worker smoke uses synthetic Firebase credentials and empty fixture data.
Verification used Node 24.20.0.

| Baseline check | Actual result |
|---|---|
| `npm ci --include=dev --ignore-scripts` without client | PASS; the lockfile already tolerated an absent client |
| `npx prisma generate` without client | PASS |
| `npm run build:backend` | FAIL; command did not exist |
| Existing `npm run build`, with explicit isolated DB | FAIL at `npm run build --workspace client`, after its existing migration path |
| API / worker boot without client | Both booted; absence itself was not a boot defect |
| Production SPA navigation without client/dist | 500, including when the proposed opt-out flag was supplied (flag previously had no effect) |
| Seven initial client-coupled contract suites | Seven failed; 13 failing tests plus module-load failures, 21 tests passed |
| Three additional schema-parity suites | Three failed to load missing client schemas |
| Default architecture check | Exit 0 with no frontend subject: false full-scope success |
| Default security check | Exit 1 on missing Vite configuration; client XSS still printed a vacuous pass |

| Slice verification | Actual result |
|---|---|
| Fresh client-absent `npm run install:backend` | PASS; no React or client Vite plugin installed; lockfile preserved |
| Client-absent `npm run build:backend`, DB variables blank | PASS; Prisma generation, 854-file syntax checks and complete server module linking; no migration |
| Client-absent `npm run test:full` | 449 suites / 6,929 tests passed, no skips, isolated migrated PostgreSQL |
| Client-absent backend architecture / security | Both pass; default full checks reject missing client |
| Real API/worker runtime smoke, client absent | PASS: health 200 with DB ping, protected API/webhook 401, unmatched browser 404, worker Redis scheduling |
| Legacy root build and default runtime smoke | PASS: existing migration/build path and SPA 200; protected API/webhook 401 |
| `npm run test --workspace client` | 302 suites / 4,897 tests passed on unchanged retry; initial concurrent run had one navigation timeout |
| `npm run test:legacy-contracts` | Six suites / 34 tests passed |
| Extracted implementation comparison | All eight schemas and seven error/retry modules match baseline source (line endings normalized) |
| Backend/client lint, full architecture/security, token resolution | PASS; existing lint warnings remain |

The first complete backend run exposed the three additional client schema paths
and the new mutation fixture's copying cost. Those paths were extracted; the
fixture now uses read-only links with a separate copy for the mutated guard.
The unchanged full runner then passed. An intermediate uncommitted build also
found the relocated test still in the disposable Git index; the final build used
the correct staged tree. These earlier failures are retained in the evidence;
they are not represented as passing runs. Browser end-to-end tests, real provider
authentication and production checks are outside this slice's verification claim.
