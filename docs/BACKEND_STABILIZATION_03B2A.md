# LUMI Backend 03B-2A — startup admission candidate

2026-10-20. Issue [#589](https://github.com/Omar3llam/marcom-marketing-os/issues/589).
**Candidate implemented; runtime NOT_WIRED; integration BLOCKED.** Independent
review pending. No production-readiness, merge, release or Gate B/C approval.

## Baseline and authority

Fresh live GitHub master and fetched source: `475bc0a2e813490c0fe6d066d0a4f9fe13fc8240`,
zero open PRs at entry. Separate `codex/issue589-startup-admission` branch; original
checkout and its four pre-existing untracked files preserved. No changes to #583,
#585 or their history. Those changes are already on this master by source content.

Read Product Truth Rulings, CLAUDE.md, design-governance README/Review Gate,
legacy provisioning contract, 03B-1A report, approved 02A principles and accepted
[03B-0 review](https://github.com/Omar3llam/marcom-marketing-os/issues/581#issuecomment-6234272436).
No new authority contradiction affects this bounded backend authorization. Old
readiness-report counts/status describe their original subjects, not this tree.
Frontend roadmap records are historical context, not new phase authorization.

Exactly three additive paths:

| Path | Purpose |
|---|---|
| `src/services/startup/startupAdmission.js` | Pure, import-free candidate evaluator; separate API/Worker requirements and forbidden-work inventory. |
| `src/tests/startupAdmission.contract.test.js` | Synthetic proof trust boundary, refusal/positive semantics, simulation counters and source isolation regression. |
| This document | Contract, evidence, limitations and deferred integration. |

All existing startup, health, worker, model, validator, execution gate, schema,
migration, config, CI, frontend and scripts remain byte-equivalent through Git
normalization. Seven critical source blobs are pinned in the new tests. No feature
flag or automatic activation path exists.

## Discovery and unchanged operational risk

| Existing source | Confirmed fact / future dependency |
|---|---|
| `src/server.js:140`, `:150` | `/api/health` checks Firebase readiness; `/health` adds SELECT1. Neither attests native schema, ACLs or migration history. |
| `src/server.js:468` | Listener opens before four concurrent ensures; failures are swallowed. The candidate does not change this. |
| `src/models/chatSession.js:25` | `ensureChatSessionSchema`: five DDL statements; sessions base/touch behavior is separately provisioned. |
| `src/models/userContext.js:17` | `ensureUserContextSchema`: one CREATE; legacy context still has active consumers. |
| `src/models/project.js:15` | `ensureProjectSchema`: five DDL statements; project/session dependencies remain. |
| `src/models/credential.js:50`, `:110` | Eight DDL statements followed by `backfillWorkspaceIds`: workspace stamping then duplicate deactivation in separate UPDATEs. NOW-based ranking/partial-write risk is prior synthetic evidence, not a claim of production account switching. |
| `src/workers/index.js` | Five consumers start and campaign/maintenance schedules are registered before global admission. Maintenance can delete data. |
| `src/services/execution/schemaReadiness.js` | Per-execution shipped migration-name check; preserve it. Successful names alone do not prove native structure, failed/rolled-back receipt semantics or whole-worker readiness. |
| `scripts/legacy-schema/verify.js` | Separate privileged, sealed-manifest operator diagnostic. COMPATIBLE is scoped to its legacy catalog/history comparison; no canonical76 native, runtime-role, auth or release qualification. Never imported by the candidate. |

The four ensures and credential backfill are **forbidden automatic work under
the future contract**, including a healthy admission simulation. They remain
active in the actual API. The tests pin that unsafe baseline explicitly rather
than representing counters as live startup protection. No DB SQL was executed.

## Qualification boundary and data contract

`evaluateStartupAdmission(input, trust)` evaluates already-observed results; it
does not run probes. No imports, callbacks, clock, environment, logs, I/O or startup
work. No customer identifiers, URLs, role/database names, secrets or SQL errors
are emitted. Results contain only fixed contract/scope/status/reason identifiers,
fixed issuer names, validated API/WORKER process kind and the qualified subset of
controlled coverage identifiers. Non-string process kinds are rejected without
coercing caller-defined methods.

**No real proof issuer is implemented.** Missing trust or any context other than
`SYNTHETIC` returns UNKNOWN / REAL_PROOF_SOURCES_UNDEFINED, integration BLOCKED.
Even a synthetic READY always carries `scope=SYNTHETIC_ONLY`,
`runtimeAdmission=NOT_WIRED`, `integration=BLOCKED`. It is not a boot capability.

Synthetic trusted test infrastructure supplies a Map from opaque object tokens to
independently constructed fixture receipts. Raw input cannot populate that Map.
A copied token, serialized full receipt, operator result or `COMPATIBLE` string
cannot qualify. The Map and its constructor are a trusted code dependency, never
operator/HTTP JSON. Someone who controls that trusted code can forge a simulation;
this is **not cryptographic attestation or proof of production compatibility**.

Every receipt must match process kind, requirement, fixed fixture issuer, read-only
qualification and four opaque SHA256 bindings: target, runtime-role profile,
binary contract and coherent observation. Cross-observation mixing fails. The
clock is explicitly supplied; observation cannot be in the future, expired, or
older than the fixture's finite maximum age. The 1,000ms test age and other fixture
times are synthetic examples, **not an approved runtime freshness/timeout policy**.
Any real implementation needs a trusted clock, validity/revalidation rules and
bindings to verified deployment, target and authenticated runtime identity.

All required coverage must be present. Native legacy/canonical receipts also
require EXACT native match; canonical76 and history receipts require APPLIED76
and COMPLETE_SUCCESS history, even if status says COMPATIBLE. A fixture's coverage
labels are not native checks. Real check algorithms/manifest revisions, permission
policy, issued-proof authenticity/revocation and coherent capture remain BLOCKED.

### Separate proof requirements and undefined real sources

| Proof | API | Worker | Required independently qualified source (all real integration currently BLOCKED) |
|---|---|---|---|
| IDENTITY | Yes | Yes | Server/database and authenticated session identity; runtime effective/inherited privileges; DDL/role-administration exclusion; tenant permissions. Bind expected target/role contract without exposing names in output. |
| LEGACY_NATIVE | Yes | Yes | Exact approved source/manifest and native catalog, owners/ACL/default privileges/prerequisite keys under a separately qualified read-only runtime diagnostic. #583 operator output alone is insufficient. |
| CANONICAL_76 | Yes | Yes | Four tables, tenant composite FKs, native functions/triggers/seals, owners/ACL/roles and real76 receipt semantics. No history-only or mocked native qualification. |
| MIGRATION_HISTORY | Yes | Yes | All shipped checksums and complete-success receipts; explicit failed/rolled-back/duplicate/extra receipt semantics. Legitimate recovery history needs separately reviewed evolution, not rewriting receipts. |
| AUTH | Yes | Yes | Qualified auth configuration and unchanged workspace authorization/tenant isolation. No real Firebase call in this slice. |
| API_SESSIONS_OAUTH_CREDENTIALS | Yes | No | Session history/touch, legacy context→project transition, OAuth state/callback, vault/decrypt behavior, workspace account selection and absence of automatic reconciliation. |
| WORKER_CREDENTIALS | No | Yes | Vault/decrypt contract, workspace account selection and no automatic reconciliation. |
| WORKER_EFFECTS | No | Yes | Queue identity/permissions; all consumers/schedules; retained per-execution gate; no provider actions while probing; maintenance deletion boundary. |
| BINARY_COMPATIBILITY | Yes | Yes | Exact current binary plus reviewed old/new Web/Worker read/write compatibility matrix and rolling-release safety. A superset migration-name list is insufficient. |

### Truth table

| Evidence | Candidate result | Runtime/integration |
|---|---|---|
| Real issuer undefined or attempted production context | UNKNOWN | NOT_WIRED / BLOCKED |
| Missing/empty/unqualified/copy/boolean/operator-only proof | UNKNOWN | NOT_WIRED / BLOCKED |
| Listener/HTTP200/SELECT1 or migration names alone | UNKNOWN | NOT_WIRED / BLOCKED |
| Partial coverage, stale/future/invalid time | UNKNOWN | NOT_WIRED / BLOCKED |
| Qualified disconnected dependency | NOT_CONNECTED | NOT_WIRED / BLOCKED |
| Qualified connection/probe failure | FAILED | NOT_WIRED / BLOCKED |
| Wrong target/role/binary/observation; native mismatch; failed/rolled-back/unknown76 or incomplete history | INCOMPATIBLE | NOT_WIRED / BLOCKED |
| Complete, current, bound, independently registered synthetic fixtures | READY, SYNTHETIC_ONLY | NOT_WIRED / BLOCKED |

Mixed outcomes preserve every leaf status. Aggregate precedence is INCOMPATIBLE,
FAILED, NOT_CONNECTED, UNKNOWN, READY; it is admission reporting only, not a
product verdict/state-policy change. Errors/getter exceptions are sanitized to
UNKNOWN/MALFORMED_EVIDENCE; no exception messages are returned.

## Executed evidence

Exact commands, invocation/exit timestamps, JSON case reports, raw stdout/stderr,
external Node/network guard audit, source/diff audit and reproduction harnesses
are supplied in the external evidence archive. Pinned Node24.20.0/npm11.19.0,
Vitest4.1.7, Windows. Existing offline dependency tree reused after lockfile,
workspace packages and Prisma schema equality checks; **no fresh install claim**.
No `.env` exists in the disposable subjects; explicit clean environment/profile,
no inherited DB/provider credentials, offline npm. Shared network guard unchanged.
External guard also blocks non-loopback sockets, the inventoried existing local
PG5432 listener, unqualified PostgreSQL URLs and actual migration commands. Local
Redis6379/6380 had no listener. No PG cluster was created or connected.

| Command / subject | Actual result | Elapsed |
|---|---|---|
| Initial focused RED before module existed | 1 failed collection suite, 0 executed cases; exit1. No negative branch coverage claimed. | 1.12s Vitest |
| First candidate focused run | 189 passed, 1 failed: text-only purity assertion matched `process.` in a comment. Reworded comment, assertion preserved; exit1 retained. | 6.79s |
| Corrected intermediate focused run | 190 passed, 0 failed, 0 skipped; exit0. | 0.496s |
| First191-case focused contract | **191 passed, 0 failed, 0 skipped**, exit0. Includes complete forged receipt and deterministic non-mutation controls. | 0.497s |
| Deliberate unsafe lookup mutant in disposable copy | **190 passed, 1 failed, 0 skipped**, exit1. Full forged receipt incorrectly became READY; regression test detects it. Not submitted. | 7.58s |
| First unchanged `npm run test:fast` | **6675 passed, 1 failed, 639 skipped**, exit1. Unchanged `legacyActionRetirement.test.js:175` queue import exceeded5000ms. Cause not established in this slice. | 45.55s |
| Same failed file, unchanged settings | 37 passed, 0 failed, 0 skipped; exit0. | 1.11s |
| Same unchanged `npm run test:fast`, repeat | **6676 passed, 0 failed, 639 skipped**,430 passed/28 skipped files; exit0. Neither first failure nor DB skips are waived. | 45.82s |
| Final process-kind validation/provenance focused run | **191 passed, 0 failed, 0 skipped**, exit0. Additional assertions within existing new cases reject coercible kinds. | 0.480s |
| First final-source fast attempt | **ABORTED**, not a complete suite result:272 passed/6 failed case events delivered before external monitor stopped it. The external reserved55400–55500 range falsely rejected Supertest loopback HTTP ports. No DB connection occurred through those blocked calls. All logs retained. | See fast-final exit/event logs |
| External guard control / correction | Explicit HTTP-only server127.0.0.1:55400 reproduces rejection under guard-v1; same fixture returns200 under corrected guard. Both controls exit0. Narrowed only external rule to inventoried PG5432; repository guard unchanged. | 0.288s /0.363s |
| Final-source unchanged fast, corrected external guard | **6676 passed, 0 failed, 639 skipped**,430 passed/28 skipped files; exit0,0 external guard violations. | 43.25s |
| Final-source forged-proof mutant | **190 passed, 1 failed, 0 skipped**, exit1; complete-forgery assertion detects unsafe acceptance. Restored before final static/build verification. | 0.497s |
| Final `npm run check` | PASS/exit0:867 source syntax checks, no backend aliases. | 59.633s command |
| Final `npm run boot-check` | PASS/exit0:865 backend parses and real server graph link; **not runtime boot**. | 45.013s |
| Final `npm run arch-check:backend` | PASS/exit0:0 failures,5 existing warnings. | 0.466s |
| Final `npm run security-check:backend` | PASS/exit0:0 failures,0 warnings. | 0.392s |
| Final `npm run lint` | PASS/exit0:0 errors,32 warnings, all outside the new files. | 3.749s |
| Final client-absent `npm run build:backend` | PASS/exit0:Prisma5.22.0 generation,867 syntax checks,865 boot parses and server graph link. No UI or migration required. | 106.030s |

The final JS source is identical across focused-final, fast-final-corrected and
the restored final client-absent build subject. Earlier results precede the
process-kind hardening and are labelled separately. Initial reports are preserved.
The first
external harness retained inaccurate historical prose labels about a one-file
subject and an unused migration-replay timeout; `invocation-label-correction.json`
corrects these without rewriting originals. Actual argv, source SHA, base/cwd,
case results and final three-path diff are authoritative. No full mode or migration
replay was invoked. No assertions, existing timeouts, workers or guards changed.

Reproduce with qualified pinned dependencies and no `.env`/credentials:

```text
npm run test:fast -- src/tests/startupAdmission.contract.test.js
npm run test:fast -- src/workers/legacyActionRetirement.test.js
npm run test:fast
npm run check
npm run boot-check
npm run arch-check:backend
npm run security-check:backend
npm run lint
# Separate disposable sparse checkout excluding the entire client/ tree:
npm run build:backend
```

Exact reporter options and safe external environment/harness are in REPRODUCE.md
and invocation logs. Full `test:full` and639 DB cases are **NOT_TESTED** in this
slice; no application migration, including76, is authorized or executed. Hosted
execution is separate and not inferred from local results.

## Deferred integration, release and rollback

**03B-2B candidate for separate Omar approval:** first define/qualify real
read-only proof issuers, sealed contract revisions, roles/targets, clock/lifetime,
failure/revalidation and time-of-check/use semantics. Independently review before
wiring. Then propose bounded API admission before listening and Worker admission
before *all* consumers/schedules, with unhealthy/unknown behavior, graceful exit,
auth/session/OAuth/tenant regressions and ordering tests. This is not implementation
authorization. Existing runtime cannot be gated safely merely by importing this
synthetic candidate or mapping an operator COMPATIBLE into READY.

Prerequisites remain: #76 incident recovery/history contract; independently
qualified restorable backup/recovery rehearsal; actual managed role/native/ACL
qualification; controlled migration/provisioning owner; credential reconciliation
and winning-account policy; raw schema/session/context/OAuth/vault compatibility;
old9b48f328 versus new Web/Worker rolling and rollback behavior; source/live build
drift; independently approved deployment plan. No source merge proves these.
Infrastructure statements in Issue589 are inherited governing evidence, not a
fresh production inspection. Hosted CI audit remains deferred under #588;
zero-step execution is NOT_TESTED, no waiver/retry requested.

Rollback of this candidate is removal/revert of these three additions. There is
no persistent data, runtime wiring or activation to reverse. Never use inverse
DDL, history rewriting, credential data restoration or a historical migration-bearing
build as an implied rollback. Future runtime rollout requires a separate,
non-destructive rollback plan that also accounts for old binaries' startup writes.

The five approved02A principles remain unchanged: qualifying per-entity absolute
evidence; proven applicable cohort completeness for relative judgments; preserved
original historical provenance/freshness across failed refreshes; UNKNOWN for old
snapshots without provenance; connector readiness explanatory under R-8. Admission
is not canonical evidence or Verdict authority. Capture-v1 membershipCoverage
remains UNKNOWN. No auth/API/Decision/ranking/frontend/product policy changed.

**Backend Gates B/C BLOCKED. Full DB tests, migration76, real roles/auth/OAuth,
worker/provider/Redis activity, production and rollout are NOT_TESTED here.**
Stop at Draft PR/evidence for ChatGPT independent review. No merge or deploy.
