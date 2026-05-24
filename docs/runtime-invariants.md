# MARCOM Runtime Invariants

**Version:** 1.0  
**Status:** Active  
**Enforced since:** PR #17 (Observability)  
**Owner:** Execution Engine (`src/services/execution-engine/`, `src/services/execution/`)

These are the laws of the MARCOM runtime. They do not bend for convenience, deadlines, or clever optimizations. Any PR that would violate an invariant must first update this document and get explicit architecture sign-off.

---

## I. Identity Invariants

### I-1 — executionId is immutable

Once an `ExecutionRequest` row is created, its `id` never changes. No rename, no re-use, no aliasing.

- **Why:** The trace layer, audit log, metrics, and transitions all reference `executionId` as a foreign key. Mutation causes ghost references and unreconstructable timelines.
- **Enforcement:** No `UPDATE executionRequest SET id = ...` path exists. Prisma schema: `id String @id @default(cuid())`.

### I-2 — correlationId traces a logical operation end-to-end

Every `ExecutionRequest`, `ExecutionTransition`, and graph event must carry the same `correlationId` for a given logical action. If a retry spawns a new execution, the new execution inherits the original `correlationId` with a new `executionId`.

- **Why:** Without a shared correlation ID, retry chains are invisible in the trace layer.
- **Enforcement:** `lifecycleService.transition()` copies `correlationId` from the parent request. Route handlers may not strip it.

### I-3 — eventId is globally unique

Every graph event has a unique `eventId` in format `evt_<base36-ts>_<random-7>`. No two events in the same process may share an ID, regardless of execution.

- **Why:** The trace timeline merges events by reference. Duplicate IDs collapse two distinct events into one.
- **Enforcement:** `createGraphEvent()` in `graphEvents.js` generates the ID — callers may not supply their own.

---

## II. State Invariants

### II-1 — Transitions are append-only

`ExecutionTransition` rows are never updated or deleted. A correction to a transition is a new transition, not a mutation of the old one.

- **Why:** The deterministic trace reconstructs history by replaying transitions in order. Any in-place mutation breaks replay fidelity.
- **Enforcement:** No `DELETE FROM ExecutionTransition` or `UPDATE ExecutionTransition` paths exist in the codebase.

### II-2 — ExecutionMetric rows are append-only

`ExecutionMetric` has one row per `executionId`. It is written once (after terminal state) and never updated. If metric data must be corrected, a separate reconciliation model handles it.

- **Why:** Metrics are evidence. Post-hoc mutation makes incident analysis unreliable.
- **Enforcement:** `emitExecutionMetric()` uses `upsert` with `create` fields only. Update fields are identical to prevent accidental mutation via retry.

### II-3 — Status only moves forward through the FSM

An `ExecutionRequest` status transitions strictly according to the FSM defined in `@marcom/runtime-contracts`. No transition skips states, and no terminal state (`EXECUTED_SUCCESS`, `EXECUTED_FAILED`, `TIMED_OUT`, `CANCELLED`) ever transitions to a non-terminal state.

- **Why:** Out-of-order transitions corrupt the timeline narrative. "EXECUTED_SUCCESS → EXECUTING" has no coherent narrative.
- **Enforcement:** `lifecycleService.transition()` validates against the FSM before writing. Invalid transitions throw `InvalidTransitionError` and are logged as warnings, not silently dropped.

### II-4 — AuditLog entries are immutable

Rows in `AuditLog` are never updated or deleted. They represent what happened, not what we wish had happened.

- **Why:** Audit logs are the trust boundary for debugging user-reported incidents.
- **Enforcement:** No update or delete path to `AuditLog` in the codebase. Only `create` is permitted.

---

## III. Graph Invariants

### III-1 — Graph traversal is deterministic

Given the same graph definition and input, traversal always produces the same node execution order and the same skip/fail decisions. No random, time-dependent, or environment-dependent branching occurs inside the graph layer.

- **Why:** Determinism is what makes traces replayable. "Why was node X skipped on Tuesday?" must have a clear causal chain.
- **Enforcement:** Graph traversal logic in `ExecutionGraph.js` is pure: no side effects, no I/O, no external state reads during traversal.

### III-2 — Graph events never mutate execution state

Graph events (from `eventStore`) are observational. They describe what happened but never cause state transitions, trigger retries, or write to the database. They are read-only signals.

- **Why:** Mixing observation with control creates unpredictable feedback loops. The graph layer emits; the lifecycle layer decides.
- **Enforcement:** `eventStore.append()` takes no action beyond storing the event. Callers of `eventStore.getEvents()` must not write back to the execution layer.

### III-3 — Node SKIPPED is final within a traversal

Once a node is marked `SKIPPED` during a traversal, it cannot be re-attempted in the same traversal. Skipped nodes are only re-eligible in a new execution (retry).

- **Why:** Allowing mid-traversal re-attempts makes the event timeline ambiguous — was the first SKIPPED entry an error or a placeholder?
- **Enforcement:** `ExecutionGraph.js` SKIPPED transitions are terminal. No "unskip" operation exists.

---

## IV. Retry Invariants

### IV-1 — Retries are bounded

Every execution has a maximum retry count defined at queue time. The system never retries indefinitely. The current bound is **3 attempts** (configurable per action type, never unlimited).

- **Why:** Unbounded retries cause zombie executions that consume worker slots and hit Meta API rate limits.
- **Enforcement:** BullMQ `attempts: MAX_RETRY_COUNT` set at job creation. `MAX_RETRY_COUNT` from environment or contract defaults — not hardcoded per-call.

### IV-2 — Retry uses exponential backoff with jitter

Each retry waits `base * 2^attempt + jitter` milliseconds. No linear backoff, no fixed delay, no immediate re-queue.

- **Why:** Immediate retries amplify Meta API overload. Linear backoff creates thundering herds across concurrent workers.
- **Enforcement:** BullMQ backoff strategy set to `{ type: 'exponential', delay: 1000 }`. No custom delay logic in route handlers.

### IV-3 — Retries are idempotent

The Meta API call inside a retry produces the same observable outcome as the original call. If the original call succeeded but the result was not recorded, the retry detects this via idempotency key and records the result without re-executing.

- **Why:** Double-execution of a "PAUSE_CAMPAIGN" action causes two audit log entries for one real event, confusing reconciliation.
- **Enforcement:** Guard 2 in `meta.js` checks `actionId` uniqueness before queuing. Worker checks idempotency key before calling Meta API.

### IV-4 — Failed-terminal executions do not auto-retry

Once `EXECUTED_FAILED` is written to the DB, no automatic retry occurs. Re-execution requires an explicit user action or operator intervention via the reconciliation route.

- **Why:** Automatic retry of a failed execution may re-execute a destructive action that was intentionally aborted.
- **Enforcement:** `lifecycleService` does not schedule retries on transition to `EXECUTED_FAILED`. Retry is manual via `POST /api/execute/:id/retry`.

---

## V. Worker Invariants

### V-1 — Workers are stateless

A worker process holds no execution-specific state between jobs. All state lives in the database or the event store. A worker that crashes mid-job loses nothing that the system cannot reconstruct.

- **Why:** Stateful workers prevent horizontal scaling and make crash recovery unpredictable.
- **Enforcement:** Workers read all required context from the job payload + DB at job start. No module-level mutable maps keyed by executionId in worker code.

### V-2 — Workers hold leases, not locks

A worker claims an execution via a lease with a TTL. If the lease expires before the job completes, the job is eligible for re-queuing. Workers extend their lease periodically while executing.

- **Why:** Hard locks create zombie executions if the worker crashes before releasing the lock.
- **Enforcement:** BullMQ job locks with TTL. Workers call `job.extendLock()` every `LOCK_DURATION / 2` ms during long-running Meta API calls. **(PR #18 implementation target.)**

### V-3 — A worker reports health or is assumed dead

Each worker emits a heartbeat every `HEARTBEAT_INTERVAL_MS`. If no heartbeat is received within `HEARTBEAT_TIMEOUT_MS`, the worker is marked unavailable and its claimed jobs are released back to the queue.

- **Why:** Silent worker death causes queue stalls. Jobs sit "PROCESSING" forever with no way to detect the failure.
- **Enforcement:** `healthContracts.js` (PR #18) implements heartbeat emission and timeout detection. **(PR #18 implementation target.)**

---

## VI. Queue Invariants

### VI-1 — Jobs are durable across restarts

No job is accepted unless it is persisted to Redis before the HTTP 202 is returned. In-memory queuing is not permitted.

- **Why:** A server restart between "job accepted" and "job persisted" would silently drop the execution.
- **Enforcement:** BullMQ `add()` awaits Redis write before returning. `REDIS_DISABLED=true` returns 503, not 202 with silent drop.

### VI-2 — Poison executions go to dead-letter, not retry

A job that fails with a non-retriable error (schema invalid, target not found, Meta API auth revoked) is moved to the dead-letter queue immediately — no retry attempts. Retriable errors (network timeout, 5xx) follow the retry policy (IV-1).

- **Why:** Retrying a poison execution wastes worker slots and masks the root cause in noise.
- **Enforcement:** Worker error handlers classify errors as retriable vs non-retriable before throwing. Non-retriable errors resolve the job as `failed` with `{ retryable: false }` metadata. **(PR #18 implementation target.)**

### VI-3 — Dead-letter queue is inspectable, not silent

Dead-letter entries are queryable via `GET /api/execute/vitals` response and the operator audit log. Poison executions are visible, not buried in BullMQ internals.

- **Why:** Silent dead-letter accumulation means failed executions are invisible until queue depth becomes a production issue.
- **Enforcement:** `vitalsService.js` includes dead-letter count in the health snapshot. **(PR #18 implementation target.)**

### VI-4 — Backpressure is enforced before queueing

If the active queue depth exceeds `MAX_QUEUE_DEPTH`, new execution requests are rejected with HTTP 429, not silently enqueued.

- **Why:** Unbounded queue growth causes memory pressure on Redis and delays all executions, including urgent ones.
- **Enforcement:** `meta.js` Guard 3 checks queue depth before `queue.add()`. `MAX_QUEUE_DEPTH` is an environment variable, not a magic number. **(PR #18 implementation target.)**

---

## VII. Observability Invariants

### VII-1 — Every execution has a reconstructable timeline

Given only the `ExecutionTransition` rows for an execution, it must be possible to reconstruct a coherent, ordered timeline with human-readable narrative. Graph events (from `eventStore`) supplement but are not required.

- **Why:** `eventStore` is in-memory with TTL. After 1 hour, graph events evict. The DB-backed timeline must stand alone.
- **Enforcement:** `buildTrace()` in `executionTrace.js` constructs a valid timeline from transitions alone when `eventStore.getEvents()` returns `[]`.

### VII-2 — Correlation IDs appear on every observable

Every event, transition, metric, and audit log entry carries `correlationId`. An execution is traceable end-to-end by `correlationId` alone.

- **Why:** Debugging a retry chain requires linking original + retry executions. Without a shared correlation ID, the link is invisible.
- **Enforcement:** `buildTrace()` surfaces `correlationId` at the top level. `emitExecutionMetric()` receives `correlationId` from the request. `auditLog.create()` calls include `correlationId`.

### VII-3 — Narrative is deterministic

Given a transition `fromStatus → toStatus` or a graph event `eventType`, the human-readable narrative is fixed. Two traces for identical transitions produce identical narratives.

- **Why:** If the narrative varies, automated diff-ing of two execution traces is unreliable.
- **Enforcement:** `traceSerializer.js` uses a static lookup table (`TRANSITION_NARRATIVE`, `GRAPH_NARRATIVE`). No string interpolation with runtime-variable data in the narrative field.

---

## VIII. Security Invariants

### VIII-1 — workspaceId is always a query filter, never inferred

Every DB read for execution data includes `WHERE workspaceId = req.user.workspaceId`. The system never infers workspace from the executionId alone.

- **Why:** Without explicit workspace scoping, a valid executionId from another workspace could return data across tenant boundaries.
- **Enforcement:** `buildTrace()`, `getTransitions()`, `getAuditLog()`, and all lifecycle reads include `workspaceId` in the `where` clause. This is verified by test: `passes workspaceId to findFirst for auth boundary`.

### VIII-2 — Trace API is read-only

`GET /api/execute/:id/trace` never writes to the database, mutates in-memory state, or triggers side effects. It is a pure read path.

- **Why:** Read paths with side effects create unpredictable state when callers retry on error.
- **Enforcement:** `registerTraceRoute()` calls only `buildTrace()` and `serializeTrace()`. Neither function performs writes. Verified by code review — no Prisma `create`, `update`, or `delete` calls in either function.

---

## Invariant Status Summary

| # | Invariant | Status |
|---|-----------|--------|
| I-1 | executionId immutable | ✅ Active (schema) |
| I-2 | correlationId end-to-end | ✅ Active (PR #17) |
| I-3 | eventId globally unique | ✅ Active (PR #17) |
| II-1 | Transitions append-only | ✅ Active |
| II-2 | Metrics append-only | ✅ Active (PR #14) |
| II-3 | Status forward-only FSM | ✅ Active (PR #15) |
| II-4 | AuditLog immutable | ✅ Active |
| III-1 | Graph traversal deterministic | ✅ Active (PR #15) |
| III-2 | Graph events read-only | ✅ Active (PR #17) |
| III-3 | SKIPPED is final | ✅ Active (PR #15) |
| IV-1 | Retries bounded | ✅ Active (BullMQ config) |
| IV-2 | Exponential backoff with jitter | ✅ Active (BullMQ config) |
| IV-3 | Retries idempotent | ✅ Active (Guard 2) |
| IV-4 | Failed-terminal no auto-retry | ✅ Active |
| V-1 | Workers stateless | ✅ Active |
| V-2 | Workers use leases | 🔲 PR #18 |
| V-3 | Workers report health | 🔲 PR #18 |
| VI-1 | Jobs durable across restarts | ✅ Active (BullMQ) |
| VI-2 | Poison → dead-letter | 🔲 PR #18 |
| VI-3 | Dead-letter inspectable | 🔲 PR #18 |
| VI-4 | Backpressure enforced | 🔲 PR #18 |
| VII-1 | Timeline reconstructable from DB | ✅ Active (PR #17) |
| VII-2 | Correlation IDs on every observable | ✅ Active (PR #17) |
| VII-3 | Narrative deterministic | ✅ Active (PR #17) |
| VIII-1 | workspaceId always a filter | ✅ Active |
| VIII-2 | Trace API read-only | ✅ Active (PR #17) |

**Legend:**  
✅ Active — enforced today, verified by tests or schema  
🔲 PR #18 — required implementation target for Production Runtime Hardening

---

## Changing an Invariant

Invariants are not changed lightly. To propose a change:

1. Open a PR that modifies this document.
2. The PR description must explain: what breaks the invariant, why the invariant was wrong or overly restrictive, and what replaces it.
3. The PR must include tests that verify the new behavior.
4. The change requires explicit architecture sign-off (not just code review approval).

Invariant violations found in the codebase are treated as bugs, not tech debt.
