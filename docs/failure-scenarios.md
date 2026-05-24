# MARCOM Failure Scenarios

**Version:** 1.0  
**Status:** Active  
**Owner:** Execution Engine  
**Related:** [runtime-invariants.md](./runtime-invariants.md), [ADR-005](./adr/ADR-005-bullmq-execution-layer.md)

Each scenario answers: *what happens deterministically when X goes wrong?*  
If a scenario has a gray area, it is called out explicitly. No happy-path assumptions.

---

## 1. Worker dies mid-node

**Trigger:** Worker process crashes, OOMs, or is killed while executing a Meta API call. BullMQ job lock TTL expires before completion.

**Expected outcome:**  
BullMQ detects a stalled job and moves it back to the waiting queue. Attempt count increments. A new worker picks up the job and calls the Meta API with the same idempotency key. If Meta already processed the action, the idempotency layer returns the existing result — no second execution occurs. The new worker writes the terminal transition (`EXECUTING → EXECUTED_SUCCESS/FAILED`). The original execution's `EXECUTING` DB state was never advanced, so there is no version conflict.

**Gray area:** The original worker may have partially completed local work (e.g., started writing to `eventStore`) before dying. Graph events from the first attempt are in the in-memory store with TTL. The timeline will show events from both attempts, ordered by timestamp. This is expected and reconstructable — the second attempt's terminal event appears last.

**Governing invariants:** V-1 (workers stateless), V-2 (workers hold leases), IV-3 (retries idempotent)

---

## 2. Heartbeat delayed

**Trigger:** Worker is alive but heartbeat is late — GC pause, network jitter, or CPU saturation causes the worker to miss its heartbeat window.

**Expected outcome:**  
Two sub-cases depending on what the worker was doing:

- **Between jobs (idle):** Health system marks worker unavailable. No jobs are affected. When the heartbeat resumes, worker is re-marked available and continues accepting jobs. No data loss.

- **During execution:** Health system marks worker unavailable and releases its job back to the queue (same path as scenario 1). A new worker picks up the job. When the original worker's heartbeat resumes, it is re-marked available — but the job is already locked by the new worker, so the original worker's job.extendLock() call fails. The original worker exits cleanly, recognizing it no longer holds the lock.

**Critical calibration:** `HEARTBEAT_TIMEOUT_MS` must exceed the maximum expected GC pause + heartbeat interval. Too short → spurious false-death detections. Too long → genuinely dead workers hold jobs for too long.

**Governing invariants:** V-2 (lease-based), V-3 (heartbeat health contract)

---

## 3. Retry scheduled after lease expiration

**Trigger:** Worker A is executing but runs slow (long Meta API response). The BullMQ lock TTL expires mid-call. Worker B acquires the lock and starts attempt 2 before Worker A finishes.

**Expected outcome:**  
Worker B calls Meta API with the same idempotency key. Meta returns the existing result (idempotency hit if Worker A's call already completed) or processes a fresh call (if Meta hadn't received Worker A's call yet). Worker B writes the terminal transition and increments the version.

Worker A eventually finishes its Meta API call and tries to write its own terminal transition. `lifecycleService.transition()` uses optimistic concurrency: `WHERE id = X AND version = expectedVersion`. Since Worker B already incremented the version, Worker A's write finds zero rows updated → `ConcurrencyError`. Worker A logs a warning and exits without writing. Worker A also tries to extend its BullMQ lock — fails, since Worker B holds it.

**Result:** Exactly one terminal transition, one metric emitted, one timeline entry. Worker A's late write is silently rejected with no visible side effect.

**Governing invariants:** IV-3 (idempotent retries), V-2 (leases not locks), II-3 (forward-only FSM via optimistic concurrency)

---

## 4. Duplicate worker pickup

**Trigger:** A race condition allows two workers to both pass BullMQ's lock acquisition check for the same job (extremely rare but possible under high load or Redis partition).

**Expected outcome:**  
Both workers call Meta API with the same idempotency key. Meta processes the first call and returns a cached result for the second (idempotency). Both workers attempt to write a terminal transition.

The first writer succeeds: `lifecycleService.transition()` updates the row and increments version. The second writer finds a version mismatch → `ConcurrencyError`. The second worker logs a warning and exits.

**Result:** Exactly one terminal transition. No duplicate execution on Meta API. `ConcurrencyError` here is expected behavior, not a bug — it is the invariant working correctly. The warning log is the only observable trace of the duplicate pickup.

**Governing invariants:** IV-3 (idempotent), II-3 (optimistic concurrency), I-3 (eventIds unique — both workers emit distinct events, both appear in timeline, later attempt's terminal event is last)

---

## 5. Queue full during retry

**Trigger:** Execution fails (attempt 1). BullMQ schedules a retry with exponential backoff. When the retry fires, the active queue depth exceeds `MAX_QUEUE_DEPTH`.

**Expected outcome:**  
Backpressure (`MAX_QUEUE_DEPTH` check) is enforced **only at initial submission** via Guard 3 in the route handler. BullMQ manages retries internally — they do not re-enter the route handler and are not subject to the backpressure check. The retry job joins the BullMQ waiting queue regardless of queue depth.

This is intentional: a retry is pre-committed work. Blocking it at backpressure would strand an execution that the system already accepted responsibility for.

The retry executes when a worker slot opens. If the queue is persistently full, the retry may wait longer than expected but will eventually execute.

**Gray area:** If the retry's backoff delay elapses while BullMQ itself is under severe load, the retry may be delayed further. This does not change the outcome — the job eventually runs — but can extend the total execution duration beyond what the user expects.

**New submission during queue-full:** A concurrent new execution request submitted while the queue is full is rejected at Guard 3 with HTTP 429. The caller must retry the submission. This is the only point where backpressure is visible to the caller.

**Governing invariants:** VI-4 (backpressure at submission), IV-1 (retries bounded), IV-2 (exponential backoff)

---

## 6. Dead-letter replay requested

**Trigger:** An execution exhausted all retry attempts and was moved to the dead-letter queue. An operator wants to re-execute it.

**Expected outcome:**  
The system creates a **new** `ExecutionRequest` with a new `executionId`. The new execution inherits the original `correlationId`. The original execution stays at `EXECUTED_FAILED` — immutable. No mutation of original transitions, metrics, or audit log entries.

The new execution goes through the full four-layer guard pipeline (validation → idempotency → queue → audit). The idempotency check uses a new key derived from the replay action (not the original), so it is not blocked by the original's idempotency record.

The trace for the original execution remains complete and unchanged. The trace for the new execution is a fresh timeline. Both share `correlationId`, so an operator querying by correlation ID sees the full retry lineage.

**Operator visibility:** The dead-letter count is visible in `GET /api/execute/vitals`. The replay must be triggered explicitly — no automatic dead-letter replay exists.

**Governing invariants:** II-1 (transitions append-only), I-2 (correlationId inherited), VI-3 (dead-letter inspectable), IV-4 (failed-terminal no auto-retry)

---

## 7. Redis unavailable at job submission

**Trigger:** Redis goes down between the time an execution request is accepted and when Guard 3 tries to enqueue the BullMQ job.

**Expected outcome:**  
`queue.add()` throws. The route handler catches the error and returns HTTP 503. The `ExecutionRequest` row was created at PENDING before the queue attempt — it now has no path to advance.

The orphaned PENDING row is detectable: `GET /api/execute/vitals` surfaces executions stuck at PENDING beyond a TTL threshold. Operator action: either manually delete the PENDING row (after confirming Redis is back and the caller will retry) or let the reconciliation route mark it TIMED_OUT.

**Critical distinction from `REDIS_DISABLED=true`:** When Redis is explicitly disabled (local dev), `actionQueue` is null and the route returns 503 before creating any `ExecutionRequest` row — no orphan. The orphaned-PENDING scenario only occurs when Redis is expected to be up but fails mid-request.

**Governing invariants:** VI-1 (jobs durable — 503 rather than silent drop), II-3 (PENDING cannot self-advance)

---

## 8. Meta API timeout race: system times out, but Meta completed

**Trigger:** Backend timeout handler fires and writes `EXECUTING → TIMED_OUT` at T=120s. One second later, the Meta API call returns success. Worker tries to write `EXECUTING → EXECUTED_SUCCESS`.

**Expected outcome:**  
`TIMED_OUT` is a terminal state. `lifecycleService.isLegalTransition('TIMED_OUT', 'EXECUTED_SUCCESS')` returns false. The worker's transition attempt throws `IllegalTransitionError`. The worker logs a warning: "execution already timed out, discarding late success."

**The system records `TIMED_OUT`. The Meta API action may have actually executed.**

This is the most important gray area in the system. The DB says TIMED_OUT. Meta's platform says the campaign is paused. These are now inconsistent. The reconciliation route (`POST /api/execute/:id/reconcile`) exists to surface this — it re-checks the actual Meta API state and writes a reconciliation audit entry without mutating the original transition history.

**Governing invariants:** II-3 (forward-only FSM), II-1 (transitions append-only), VIII-1 (backend truth wins for our records — but Meta's truth is external)

---

## 9. Database connection lost during transition write

**Trigger:** `lifecycleService.transition()` calls `prisma.executionRequest.updateMany()`. The DB connection drops mid-write. The transaction is unknown: committed or rolled back.

**Expected outcome:**  
Two sub-cases:

- **Transaction rolled back:** Version unchanged. Worker's `updateMany` returns 0 rows updated, which is treated as a `ConcurrencyError`. Worker retries the BullMQ job (if within MAX_RETRY_COUNT). On the next attempt, the version check passes (version is still at the expected value), transition succeeds.

- **Transaction committed:** Version incremented. Worker did not receive confirmation. Worker retries. On next attempt, the optimistic lock fails (version already advanced). `ConcurrencyError` thrown. Worker reads fresh state, sees terminal status, and exits cleanly.

In both cases the system converges to a correct final state. The DB connection loss adds at most one extra retry consumption.

**Governing invariants:** IV-3 (idempotent), II-3 (optimistic concurrency handles both cases)

---

## 10. Concurrent timeout and cancellation

**Trigger:** User cancels execution (`DELETE /api/execute/:id`) at the exact moment the backend timeout handler also fires for the same execution.

**Expected outcome:**  
Both call `lifecycleService.transition()` with the same `expectedVersion`. The first to write wins. The second finds a version mismatch → `ConcurrencyError`. The second logs a warning and exits.

**Result:** Exactly one terminal transition. The final status is whichever of `CANCELLED` or `TIMED_OUT` won the race — both are valid terminal states. The timeline accurately shows which one landed.

Neither actor is treated as an error if it loses the race. `ConcurrencyError` during a cancel or timeout operation is an expected competitive outcome, not a system failure.

**Governing invariants:** II-3 (forward-only FSM, optimistic concurrency), II-4 (audit log captures the winner)

---

## Scenario Summary

| # | Scenario | Final state | Data loss? | Operator action? |
|---|----------|-------------|------------|-----------------|
| 1 | Worker dies mid-node | Terminal (via retry) | No | No |
| 2 | Heartbeat delayed (idle) | No change | No | No |
| 2 | Heartbeat delayed (mid-exec) | Terminal (via retry) | No | No |
| 3 | Retry after lease expiration | Terminal (first writer wins) | No | No |
| 4 | Duplicate worker pickup | Terminal (first writer wins) | No | No |
| 5 | Queue full at retry | Terminal (delayed, not blocked) | No | No |
| 5 | Queue full at new submission | HTTP 429 | No | Caller retries |
| 6 | Dead-letter replay | New execution, original preserved | No | Manual trigger |
| 7 | Redis down at submission | HTTP 503, orphaned PENDING | No | Reconcile/delete orphan |
| 8 | Meta completes after timeout | TIMED_OUT (Meta state unknown) | **Possible** | Check Meta + reconcile |
| 9 | DB connection lost mid-write | Converges to terminal via retry | No | No |
| 10 | Concurrent cancel + timeout | Terminal (race winner) | No | No |

**Only scenario 8 can produce a discrepancy between MARCOM's recorded state and the actual state in Meta's platform.** All other scenarios converge to a correct, consistent final state without operator intervention.
