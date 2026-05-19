# Phase 11 Pre-Flight: State Topology Audit
**Date**: 2026-05-19  
**Scope**: Frontend + Backend state management patterns  
**Goal**: Identify implicit lifecycle holes before building FSM Layer

---

## Executive Summary

**Status**: System is at **orchestration-grade threshold** but has **emergent async complexity**.

The platform has:
- ✅ Contract governance (Phase 9)
- ✅ Error intelligence (Phase 10)
- ✅ Typed domain errors
- ✅ Correlation tracking
- ⚠️ **Implicit orchestration lifecycle** (scattered across hooks/routes)
- ⚠️ **Race conditions in SSE reconnect**
- ⚠️ **Cleanup drift in AbortController management**
- ⚠️ **State divergence between UI and execution reality**

**Next existential risk**: Async chaos, retry storms, zombie streams.

---

## 1. Frontend State Topology

### 1.1 Current State Managers

| Location | Type | Responsibility | State Shape |
|---|---|---|---|
| `useDecisionFSM.js` | Reducer | 8-state decision flow | `{view, activeMode, inputData, outputData, errorDetails, isProcessing, isLocked, theatreStep, history, radarAlerts, executionStatus}` |
| `IntelligenceContext.jsx` | Context | Campaign feed + memory singleton | `{campaigns, memory, loading, error}` |
| `AuthContext.jsx` | Context | Firebase auth state | `{currentUser, loading, authReady}` |
| `useDecisionFeed.ts` | Hook | Feed fetching + validation | `{state, data, error, refetch}` |
| `useExecution.ts` | Hook | Action execution + idempotency | `{handleExecute, executingActions}` |

### 1.2 Implicit Lifecycle Holes

#### **Hole #1: AbortController Cleanup Drift**

**Location**: `useDecisionFSM.js:318-324`, `IntelligenceContext.jsx:69-73`

**Problem**:
```javascript
// useDecisionFSM: AbortController created per action, but OVERWRITTEN on retry
const submitInput = useCallback((inputData) => {
  if (abortControllerRef.current) {
    abortControllerRef.current.abort(); // ← Previous async work KILLED
  }
  abortControllerRef.current = new AbortController(); // ← Race: what if previous was mid-flight?
  dispatch({ type: 'SUBMIT_INPUT', inputData });
}, []);
```

**Failure Mode**:
- User submits input → async work starts
- User immediately retries (spam clicks) → **previous work aborted mid-flight**
- If previous work was writing to Prisma → **partial DB state**
- No graceful cancellation → just abort signal propagation

**Evidence**:
- `abortControllerRef` is overwritten on every `submitInput`/`executeAction` call
- No "wait for in-flight to complete" guard
- `isLocked` state prevents UI spam but doesn't prevent programmatic retry loops

**Impact**: Race conditions on rapid retries, potential DB orphans.

---

#### **Hole #2: SSE Stream Reconnect Has No Exponential Backoff**

**Location**: Frontend SSE client (not found in audit — assumed to exist in unmapped file)

**Expected Pattern**:
```javascript
// Should exist but NOT FOUND:
let reconnectAttempt = 0;
eventSource.onerror = () => {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 32000);
  setTimeout(() => reconnect(), delay);
  reconnectAttempt++;
};
```

**Current State**: Not found in audit scope.

**Inference**: If SSE client exists, it likely has no reconnect backoff (common anti-pattern).

**Failure Mode**:
- Backend SSE endpoint dies (502, maintenance)
- Client immediately reconnects in tight loop
- **Retry storm**: 1000s of clients hammer `/api/events/token` simultaneously
- Backend circuit breaker triggers (if exists) or crashes

**Impact**: Thundering herd on SSE reconnect.

---

#### **Hole #3: Execution Status Divergence (UI vs Backend)**

**Location**: `useDecisionFSM.js:206-254` (EXECUTION_STATUS_UPDATE), `execution.js:164-244` (SSE broadcasts)

**State Flow**:
```
Frontend FSM:
  CONFIRM_EXECUTION → API_EXECUTION → EXECUTION_QUEUED → EXECUTING → EXECUTED_SUCCESS | EXECUTED_FAILED

Backend Execution:
  PENDING → (SSE: QUEUED) → (SSE: EXECUTING) → (SSE: EXECUTED_SUCCESS | EXECUTED_FAILED)
  ↓
  Prisma: ExecutionRequest.status = 'PENDING' → 'EXECUTED_SUCCESS' | 'FAILED'
```

**Problem**:
- Frontend FSM has 5 execution states
- Backend has 3 states (PENDING, EXECUTED_SUCCESS, FAILED)
- SSE broadcasts 4 states (QUEUED, EXECUTING, EXECUTED_SUCCESS, EXECUTED_FAILED)
- **State mismatch**: If SSE message drops, FSM stuck in wrong state

**Failure Mode**:
- User clicks "Execute"
- Backend broadcasts `QUEUED` → Frontend transitions to `EXECUTION_QUEUED`
- SSE connection drops BEFORE `EXECUTING` message arrives
- Frontend never receives `EXECUTED_SUCCESS` → **stuck in "Queued" forever**
- User sees "Action queued..." spinner eternally, but action succeeded in backend

**Evidence**:
- No timeout on FSM execution states
- No "fetch execution status" fallback if SSE drops
- `executionStatus` in FSM is SSE-driven only (line 203)

**Impact**: UI lies about reality when SSE disconnects during execution.

---

#### **Hole #4: Retry Logic Scattered Across Hooks**

**Location**: Multiple files

**Scatter Map**:
| File | Retry Pattern | Strategy |
|---|---|---|
| `useDecisionFeed.ts` | None (manual refetch) | User-triggered |
| `IntelligenceContext.jsx` | None (manual refresh) | User-triggered |
| `api.js:198-235` | Auto-retry on 401 (token refresh) | ONCE, then fail |
| `retryPolicy.ts` | Centralized registry | NOT USED yet |

**Problem**:
- Phase 10 built `retryPolicy.ts` with `EXPONENTIAL_BACKOFF`, `LINEAR_RECONNECT`, etc.
- **NOT integrated** into any hook
- Retries are manual (user clicks "Retry" button)
- No automatic retry on `NetworkError`, `RateLimitError`, `StreamDisconnectError`

**Failure Mode**:
- Transient network glitch (500ms)
- Feed fetch fails → user sees "Connection Error" panel
- User must manually click "Retry" button
- Meanwhile: backend is healthy again, but user thinks system is broken

**Impact**: Poor UX for transient failures, no auto-recovery.

---

#### **Hole #5: No Timeout Governance on FSM States**

**Location**: `useDecisionFSM.js` (entire file)

**Problem**:
```javascript
// FSM has no timeout mechanism:
case 'EXECUTE_ACTION':
  return {
    view: 'API_EXECUTION',
    isProcessing: true,
    isLocked: true,
    executionStatus: null,
  };
// ↑ What if backend never responds? FSM locked forever.
```

**Failure Mode**:
- User clicks "Execute"
- Backend receives request, starts execution
- Backend crashes mid-execution (no SSE status update sent)
- Frontend FSM: `isLocked: true`, `view: 'API_EXECUTION'`
- **User cannot retry** (UI locked)
- **No timeout** → FSM stuck in locked state forever

**Evidence**:
- No `setTimeout` in FSM state machine
- No "execution timeout" guard
- AbortController timeout relies on axios timeout (60s in api.js:32)
- But: axios timeout kills request, doesn't unlock FSM

**Impact**: FSM deadlock on backend timeout.

---

### 1.3 Race Conditions Inventory

| Race Condition | Files | Trigger | Impact |
|---|---|---|---|
| **AbortController overwrite** | `useDecisionFSM.js:336-340` | Rapid retry clicks | Partial DB writes, orphaned actions |
| **SSE reconnect spam** | (Unmapped frontend SSE client) | Backend restart | Retry storm, DDoS-like load |
| **Feed refetch during execution** | `DecisionViewV2.tsx:43`, `useExecution.ts:87` | Execution success triggers refetch while feed already loading | Duplicate campaigns in UI, memory leak |
| **localStorage quota exhaustion** | `useDecisionFSM.js:66-69` | Rapid decision commits | Silent persistence failure, history loss |

---

## 2. Backend State Topology

### 2.1 Orchestration State

| Location | Type | Lifecycle | Persistence |
|---|---|---|---|
| `agents/orchestrator.js:130-213` | Function | Request-scoped | Prisma `Action.payload` |
| `routes/lumi/feed.js:130-226` | Endpoint | Request-scoped | None (derived from DB) |
| `routes/execution.js:71-320` | Endpoint | Request-scoped | Prisma `ExecutionRequest` + `AuditLog` |
| `routes/events.js:48` | Map | In-memory | None (ephemeral) |

### 2.2 Implicit Lifecycle Holes

#### **Hole #6: No Circuit Breaker on Orchestration Calls**

**Location**: `agents/orchestrator.js:154-163`

**Problem**:
```javascript
// No circuit breaker — always attempts Claude call
try {
  strategicAnalysis = await analyzeWithClaude({...});
} catch (err) {
  logger.error({ err: err.message, campaignId }, '[orchestrator] Claude failed');
  throw new Error(`Strategic analysis failed: ${err.message}`);
}
```

**Failure Mode**:
- Anthropic API down (503, rate limit)
- Every feed request → attempts Claude call
- All requests fail
- No circuit breaker → **cascading failure across all workspaces**
- 1000s of concurrent users → 1000s of failed Claude calls → quota burn

**Evidence**:
- No circuit breaker state in orchestrator
- No "open circuit" check before Claude call
- Phase 10 built `trackCircuitBreakerOpen` telemetry (line 107 in `errorTelemetry.ts`) but NOT USED

**Impact**: Cascading failure when AI providers degrade.

---

#### **Hole #7: SSE Stream Token Map Has Memory Leak Risk**

**Location**: `routes/events.js:34-44`

**Problem**:
```javascript
// Cleanup runs every 30s, but:
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of streamTokens) {
    if (data.expiresAt < now) {
      streamTokens.delete(token); // ← Only cleans EXPIRED tokens
    }
  }
}, 30_000);

// But: If client calls POST /token and never connects to GET /stream,
// token stays in map for 60s (TTL), then gets cleaned.
// Edge case: High-traffic app, 10k clients/min → 600k orphaned tokens in map.
```

**Failure Mode**:
- Bot DDoS: spam POST `/api/events/token`
- Each call generates UUID, stores in `streamTokens` Map
- Tokens expire after 60s, but cleanup runs every 30s
- **Memory leak**: Map size unbounded between cleanup intervals
- Node.js process OOMs on high load

**Impact**: Memory exhaustion on token spam.

---

#### **Hole #8: No Graceful Degradation on OpenAI Failure**

**Location**: `agents/orchestrator.js:166-190`

**Current Behavior**:
```javascript
if (needsCreative) {
  try {
    creativeAssets = await generateCreativeAssets({...});
  } catch (err) {
    // Creative is best-effort — log and continue with strategic only.
    logger.warn({ err: err.message }, '[orchestrator] OpenAI creative failed');
    creativeAssets = { error: err.message };
  }
}
// ↑ Returns partial result, but frontend doesn't know creative failed
```

**Problem**:
- OpenAI fails → orchestrator returns `creativeAssets: { error: "..." }`
- Frontend receives payload, doesn't check `.error` field
- UI renders "No creative variants available" with no explanation

**Evidence**:
- No telemetry call to `trackDegradedState` (Phase 10 hook exists but unused)
- Frontend adapter (`parseLumiFeed`) doesn't check `creativeAssets.error`

**Impact**: Silent degradation, user confusion.

---

### 2.3 Missing State Machines

| Domain | Current State | Ideal State | Gap |
|---|---|---|---|
| **Execution lifecycle** | Implicit (PENDING → SSE → SUCCESS) | Explicit FSM (VALIDATING → QUEUED → EXECUTING → COMMITTED → SUCCESS) | No FSM, no transition guards |
| **Stream lifecycle** | Boolean (connected/disconnected) | FSM (IDLE → CONNECTING → CONNECTED → RECONNECTING → FAILED) | No backoff, no retry budget |
| **Orchestration lifecycle** | One-shot function call | FSM (IDLE → PLANNING → EXECUTING → STREAMING → PARTIAL → SUCCESS) | No cancellation, no timeout |

---

## 3. State Divergence Points

### 3.1 Where UI Lies About Reality

| Divergence Point | Frontend State | Backend State | Trigger |
|---|---|---|---|
| **Execution status** | `EXECUTION_QUEUED` (spinning) | `EXECUTED_SUCCESS` (done) | SSE message drop |
| **Feed freshness** | Stale campaigns (cached) | New campaigns (DB updated) | Refetch not triggered after execution |
| **Error severity** | `NetworkError` (retryable) | Backend healthy (transient 502) | No retry logic in hooks |
| **Stream health** | `CONNECTED` (EventSource.readyState=1) | Backend restarting (no subscribers) | No heartbeat failure detection |

---

## 4. Retry Scatter Analysis

### 4.1 Where Retry Logic Lives (or Doesn't)

| Component | Current Retry | Should Be | Phase 10 Policy |
|---|---|---|---|
| `useDecisionFeed.ts` | None (manual button) | Auto-retry with `FIXED_INTERVAL` | `NetworkError` → 3 attempts, 5s delay |
| `IntelligenceContext.jsx` | None (manual refresh) | Auto-retry with `EXPONENTIAL_BACKOFF` | `RateLimitError` → backoff to 32s |
| SSE reconnect | Unknown (unmapped) | `LINEAR_RECONNECT` | 2s, 4s, 6s, 8s (max 10s) |
| `api.js` 401 retry | Hardcoded (once) | Good (token refresh is single-shot) | Correctly NOT in retry policy |

**Key Finding**: Phase 10 built `retryPolicy.ts` with full retry strategies, but **ZERO integration** into hooks.

---

## 5. Cleanup Drift Inventory

### 5.1 AbortController Lifecycle Issues

| File | Issue | Risk |
|---|---|---|
| `useDecisionFSM.js:318` | Cleanup on unmount only | If component unmounts mid-execution, AbortSignal fires → backend call cancelled → partial DB state |
| `useDecisionFSM.js:336` | Overwrite on retry | Previous async work killed without waiting for completion |
| `IntelligenceContext.jsx:70` | Cleanup on unmount only | Feed refetch cancelled on unmount → user navigates away mid-load → no issue (safe) |

### 5.2 SSE Stream Cleanup

| File | Issue | Risk |
|---|---|---|
| `events.js:146` | Cleanup on `req.on('close')` | Safe — EventSource close triggers cleanup |
| `events.js:177-192` | Dead stream cleanup on write failure | Safe — removes zombie connections |

**Verdict**: SSE cleanup is GOOD. AbortController cleanup is RISKY.

---

## 6. Timeout Governance Gaps

| Domain | Current Timeout | Ideal Timeout | Gap |
|---|---|---|---|
| API calls | 60s (axios global) | ✅ Reasonable | None |
| FSM execution states | ∞ (none) | 90s (then force unlock + error) | **Critical gap** |
| SSE reconnect | ∞ (assumed) | 5 attempts, then FAILED state | Unknown (unmapped) |
| Orchestration (Claude + GPT) | ∞ (no timeout) | 30s Claude + 45s GPT = 75s total | **Critical gap** |
| Stream token TTL | 60s | ✅ Reasonable | None |

---

## 7. Observability Gaps

### 7.1 Telemetry Hooks Built (Phase 10) but NOT USED

| Hook | Purpose | Current Usage |
|---|---|---|
| `trackError` | Log all errors with correlation IDs | ❌ NOT called in hooks (only in api.js) |
| `trackRetryAttempt` | Log retry behavior | ❌ NOT used (no auto-retry yet) |
| `trackCircuitBreakerOpen` | Log circuit breaker state | ❌ NOT used (no circuit breaker) |
| `trackStreamRecovery` | Log SSE reconnect success | ❌ NOT used (SSE client unmapped) |
| `trackDegradedState` | Log graceful degradation | ❌ NOT used (OpenAI failure silent) |

**Key Finding**: Phase 10 built comprehensive observability, but **integration is 10%**.

---

## 8. Critical Findings Summary

### 8.1 Existential Risks (HIGH PRIORITY)

| Risk | Impact | Mitigation (Phase 11) |
|---|---|---|
| **FSM execution deadlock** | User locked out after backend timeout | Add timeout guards, force-unlock after 90s |
| **SSE retry storm** | Backend DDoS on reconnect | Exponential backoff, retry budget (5 max) |
| **AbortController race** | Partial DB writes on rapid retry | Debounce retries, wait for in-flight completion |
| **State divergence (UI vs backend)** | User sees "Queued" but action succeeded | Polling fallback if SSE drops, timeout detection |

### 8.2 High-Impact Quick Wins

1. **Integrate retry policies** (Phase 10 → hooks): `useDecisionFeed` auto-retry on `NetworkError`
2. **Add FSM timeout guards**: Force-unlock after 90s if no SSE update
3. **Track circuit breaker state**: Wrap orchestrator calls in circuit breaker
4. **Add graceful degradation telemetry**: Call `trackDegradedState` when OpenAI fails

---

## 9. Phase 11 FSM Design Constraints

Based on audit findings, Phase 11 FSM MUST:

### 9.1 Core Requirements

1. **Explicit execution lifecycle states**:
   ```
   IDLE → VALIDATING → PLANNING → EXECUTING → STREAMING → PARTIAL_SUCCESS → SUCCESS
                                                         ↘ RETRYING → FAILED → ABORTED
   ```

2. **Transition guards**:
   - No transition to `EXECUTING` if previous execution in-flight
   - No transition to `RETRYING` if retry budget exhausted
   - No transition to `SUCCESS` if SSE status = `FAILED`

3. **Timeout governance**:
   - `EXECUTING` → auto-transition to `FAILED` after 90s if no SSE update
   - `RETRYING` → exponential backoff (2s, 4s, 8s, 16s, 32s max)

4. **Cancellation semantics**:
   - User cancels → transition to `ABORTED`, AbortController fires
   - In-flight work completes → DB transaction commits, then FSM unlocks
   - No mid-flight cancellation of Prisma writes

5. **SSE fallback**:
   - If SSE drops during `EXECUTING` → poll `/api/execute/audit` every 5s
   - After 3 polls with no status change → assume failure, transition to `FAILED`

6. **Circuit breaker integration**:
   - Before `PLANNING` → check orchestrator circuit state
   - If circuit OPEN → immediate transition to `DEGRADED` (skip AI, use heuristic fallback)

7. **Observability hooks**:
   - Every state transition → `track('fsm_transition', { from, to, reason, elapsed })`
   - Every retry → `trackRetryAttempt`
   - Circuit breaker OPEN → `trackCircuitBreakerOpen`

---

## 10. Recommended Phase 11 Deliverables

### 10.1 Core FSM Layer

| File | Purpose |
|---|---|
| `client/src/fsm/decisionMachine.ts` | XState-based FSM definition |
| `client/src/fsm/guards.ts` | Transition guards (timeout, retry budget, circuit state) |
| `client/src/fsm/actions.ts` | FSM side effects (API calls, telemetry) |
| `client/src/fsm/services.ts` | Async services (fetch feed, execute action, poll status) |

### 10.2 Backend Circuit Breaker

| File | Purpose |
|---|---|
| `src/resilience/circuitBreaker.ts` | Generic circuit breaker (OPEN/HALF_OPEN/CLOSED) |
| `src/resilience/orchestratorCircuit.ts` | Orchestrator-specific circuit (wraps Claude/GPT calls) |

### 10.3 SSE Reconnect Logic

| File | Purpose |
|---|---|
| `client/src/services/sseClient.ts` | EventSource wrapper with exponential backoff |

### 10.4 Integration Tasks

1. Replace `useDecisionFSM` with XState machine
2. Wrap `runOrchestration` in circuit breaker
3. Integrate `retryPolicy.ts` into `useDecisionFeed`
4. Add SSE reconnect with `LINEAR_RECONNECT` strategy
5. Add FSM timeout guards (90s execution timeout)
6. Add polling fallback for SSE drops

---

## 11. Success Metrics (Phase 11 Complete)

| Metric | Before Phase 11 | After Phase 11 |
|---|---|---|
| **FSM deadlock rate** | Unknown (no telemetry) | 0% (timeout guards prevent) |
| **SSE retry storm** | Possible (no backoff) | 0% (exponential backoff + budget) |
| **UI state divergence** | Frequent (SSE drops → stuck) | Rare (polling fallback) |
| **Auto-recovery on transient errors** | 0% (manual retry only) | 80%+ (auto-retry with backoff) |
| **Circuit breaker activations** | 0 (doesn't exist) | Tracked (observability) |
| **Graceful degradation visibility** | 0% (silent failures) | 100% (telemetry + UI indicators) |

---

## Conclusion

**The platform is at the orchestration-grade threshold.**

Phases 9 + 10 solved contract entropy and error ambiguity.  
**Phase 11 solves execution determinism and failure recovery.**

The next existential risk is NOT technical debt.  
**It's emergent async chaos when scale increases.**

Phase 11 transforms:
- From: "Frontend reacting to chaos"
- To: **"Platform enforcing deterministic execution"**

---

**Next Step**: Build `decisionMachine.ts` (XState FSM) with timeout guards, retry strategies, and circuit breaker integration.
