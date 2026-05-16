# ADR-005: BullMQ for Async Meta API Execution

**Status:** ✅ Accepted  
**Date:** Sprint 5 (v4.1)  
**Deciders:** Backend lead + infrastructure review

## Context

When MARCOM executes a Meta API action (pause a campaign, adjust budget, scale spend), this operation must be:

1. **Idempotent** — the same action cannot execute twice even if retried
2. **Auditable** — every execution must be logged with timestamps and results
3. **Resilient** — a Meta API timeout should not fail the user's HTTP request
4. **Reversible** — the rollback feature needs a complete execution history

In v1-v3, Meta API calls were executed **synchronously within the HTTP request**:

```javascript
POST /api/execute/meta
  → Validate action
  → Call Meta API directly (await metaSDK.pauseCampaign(...))
  → Return result to user
```

This caused **3 production incidents**:

1. **30-second timeout**: Meta API took 25 seconds to respond → user's HTTP request timed out → they clicked "Execute" again → campaign paused TWICE
2. **No retry logic**: Meta API returned 500 error → user saw error screen → had to manually retry → by then the campaign had already burned budget
3. **No audit trail**: When a user claimed "I never executed that action", we had no proof of when/why it ran

The question: **Continue with synchronous execution and add retry/idempotency guards, or move to async job queue?**

## Decision

**Use BullMQ (Redis-backed job queue)** for all Meta API execution with a **4-layer guard** pattern.

Architecture:
```
User clicks "Execute"
  ↓
POST /api/execute/meta
  ↓
[GUARD 1] Schema validation (Zod)
  ↓
[GUARD 2] Idempotency check (has action_id been executed before?)
  ↓
[GUARD 3] Queue job in BullMQ → HTTP 202 (Accepted) returned immediately
  ↓
[GUARD 4] Log attempt to Action table (audit trail)
  ↓
Worker (src/workers/actionWorker.js) picks up job asynchronously
  ↓
Execute Meta API call
  ↓
Update Action record with result (success/failure)
  ↓
SSE stream sends status update to frontend
```

Key changes:
- **New:** `src/queues/index.js` (BullMQ queue registry)
- **New:** `src/queues/connection.js` (Redis connection with graceful degradation)
- **New:** `src/workers/actionWorker.js` (async job processor)
- **Updated:** `src/routes/execution.js` (4-layer guard pattern)
- **Graceful degradation:** When `REDIS_DISABLED=true`, queues export `null` → routes return 503

## Rationale

### Why BullMQ over synchronous execution?

1. **Non-blocking**: User gets HTTP 202 in <100ms, even if Meta API takes 30 seconds
2. **Automatic retry**: BullMQ retries failed jobs (3 attempts with exponential backoff)
3. **Idempotency**: Job IDs prevent duplicate execution — retry is safe
4. **Audit trail**: BullMQ stores job start time, end time, attempts, errors
5. **Rollback support**: Action records have timestamps → "undo actions from last 5 minutes"
6. **Concurrency control**: BullMQ limits concurrent Meta API calls (prevents rate limit 429s)

### Why BullMQ specifically (vs alternatives)?

- **Built for Node.js**: Native async/await support, unlike Celery (Python) or Sidekiq (Ruby)
- **Redis-backed**: Fast, in-memory queue (vs. database-backed queues like PostgreSQL's SKIP LOCKED)
- **Job priorities**: Can prioritize KILL actions over SCALE actions
- **Delayed jobs**: Can schedule actions to execute at a specific time (future feature)
- **Job metrics**: Built-in metrics for job duration, success rate, queue depth

### Why NOT synchronous with retry?

- Synchronous retry still blocks the HTTP request — if Meta API is down for 2 minutes, user waits 2 minutes
- No way to cancel a retry mid-flight — BullMQ jobs can be cancelled
- Hard to implement concurrency limits without a queue

## Consequences

### Positive

✅ **Non-blocking UX**: Users get instant feedback (202), then SSE streams status updates  
✅ **Automatic retry**: Meta API transient errors (500, timeout) are retried 3 times  
✅ **Idempotency**: Duplicate clicks don't cause double-execution (job ID deduplication)  
✅ **Full audit trail**: Action table has `queuedAt`, `startedAt`, `completedAt`, `attempts`  
✅ **Rollback support**: Can query "all actions in last 5 minutes" and reverse them  
✅ **Concurrency control**: Limit to 5 concurrent Meta API calls (prevents 429 rate limits)  
✅ **Graceful degradation**: App runs in dev without Redis (features disabled, but doesn't crash)

### Negative

❌ **Infrastructure dependency**: Requires Redis instance (additional $15/mo cost)  
❌ **Worker process**: Must run `npm run worker` alongside server (2 processes instead of 1)  
❌ **Complexity**: Async execution is harder to debug than synchronous (need distributed tracing)  
❌ **SSE overhead**: Frontend must maintain SSE connection for status updates (additional complexity)  
❌ **Eventual consistency**: User sees "Queued" state for 1-5 seconds before "Executed"  
❌ **Dev friction**: Local dev without Redis means execution features are disabled (503 errors)

### Graceful degradation implementation

When Redis is unavailable (local dev, Redis outage), the app does NOT crash:

```javascript
// src/queues/index.js
export const actionQueue = REDIS_DISABLED ? null : new Queue(...);

// src/routes/execution.js
if (!actionQueue) {
  return res.status(503).json({ 
    error: 'Execution disabled (Redis unavailable)' 
  });
}
```

This allows:
- Frontend to deploy without Redis (analytics work, but execution disabled)
- Local dev to run `npm run dev` without `docker-compose up redis`
- Gradual rollout (enable Redis region-by-region)

**Trade-off:** Silent feature degradation — users don't know Redis is down until they try to execute.

## Evidence in Code

**Queue registry:**
```
src/queues/index.js
  → Exports actionQueue, observerQueue, syncQueue
  → REDIS_DISABLED check → null if Redis unavailable
  → Line 34: export const actionQueue = REDIS_DISABLED ? null : new Queue(...)
```

**Redis connection:**
```
src/queues/connection.js
  → REDIS_DISABLED flag set when REDIS_URL missing or localhost
  → Graceful degradation: no crash if Redis down
```

**Execution route (4-layer guard):**
```
src/routes/execution.js
  → Guard 1: Zod schema validation
  → Guard 2: Idempotency check (action_id already executed?)
  → Guard 3: Queue job in BullMQ
  → Guard 4: Log to Action table
```

**Worker process:**
```
src/workers/actionWorker.js
  → Processes jobs from actionQueue
  → Calls Meta API (metaExecutionService.js)
  → Updates Action record with result
```

**Action model:**
```
prisma/schema.prisma
  model Action {
    id         String   @id @default(cuid())
    actionId   String   @unique  // idempotency key
    queuedAt   DateTime
    startedAt  DateTime?
    completedAt DateTime?
    attempts   Int      @default(0)
    status     String   // QUEUED, PROCESSING, SUCCESS, FAILED
  }
```

## Alternatives Considered

### 1. Synchronous with retry (status quo + retry logic)
- **Pro**: No Redis dependency, simpler architecture
- **Con**: User waits 30+ seconds if Meta API is slow, no way to cancel mid-retry

### 2. PostgreSQL SKIP LOCKED (database-backed queue)
- **Pro**: No Redis dependency (reuse existing PostgreSQL)
- **Con**: 10x slower than Redis (polling database every second), no job metrics

### 3. AWS SQS (managed queue service)
- **Pro**: Fully managed (no Redis to maintain), infinite scalability
- **Con**: Vendor lock-in, higher latency (SQS polling is ~1 second), costs scale with usage

### 4. Celery (Python task queue)
- **Pro**: Battle-tested, widely used
- **Con**: Requires Python workers (we're a Node.js shop), separate deployment pipeline

### 5. Background jobs in same process (setTimeout)
- **Pro**: Zero dependencies
- **Con**: Not persistent (jobs lost on server restart), no retry, no monitoring

## Performance Benchmarks

| Metric | Synchronous (v3) | BullMQ (v4) |
|---|---|---|
| User-perceived latency (SCALE action) | 8-12 seconds | 200ms (HTTP 202) |
| Meta API timeout impact | User sees error after 30s | Worker retries, user unaffected |
| Duplicate execution (double-click) | 2 executions (race condition) | 1 execution (idempotent) |
| Rollback query | Manual grep of logs | SQL query on Action table |
| Concurrent Meta API calls | Unbounded (hit 429 rate limits) | 5 max (configurable) |
| Infrastructure cost | $0 (no queue) | +$15/mo (Redis) |

**Net impact:** Much better UX (instant feedback), eliminates double-execution bugs, adds $15/mo cost.

## Rollback Plan

If BullMQ proves too complex, we can rollback to synchronous execution in ~1 sprint:

1. Remove BullMQ queue from `execution.js`
2. Call Meta API synchronously: `await metaExecutionService.executeAction(...)`
3. Return result directly in HTTP response (no 202, no SSE)
4. Keep Action table for audit trail
5. Accept timeout and double-execution risks

**Likelihood of rollback:** <5% — BullMQ has been stable for 3 months, no incidents. The instant UX feedback is a huge win for users.

## When to NOT use BullMQ

Not every operation needs to be queued. Only use BullMQ for:

✅ **Meta API execution** (pause, scale, update) — long-running, needs retry  
✅ **Observer sync** (fetch latest campaign data from Meta) — background task  
✅ **Scheduled jobs** (weekly reports, health checks)

Do NOT use BullMQ for:

❌ **Campaign analysis** (Claude AI) — synchronous is fine, results stream via SSE  
❌ **Database reads** (GET /api/campaigns) — instant, no need for queue  
❌ **User login** (Firebase Auth) — must be synchronous

## Related ADRs

- None (this is the first async execution decision)
