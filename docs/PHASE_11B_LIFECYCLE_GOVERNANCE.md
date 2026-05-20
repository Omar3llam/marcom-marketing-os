# PHASE 11B — LIFECYCLE GOVERNANCE SPECIFICATION

**Status:** AUTHORITATIVE SPEC (not implementation)  
**Phase:** 11B-B1 (Design)  
**Date:** 2026-05-19  
**Scope:** Execution lifecycle coordination, state reconciliation, distributed system governance

---

## EXECUTIVE SUMMARY

MARCOM has graduated from a frontend application to a **distributed operational system**. The transition from Phase 11A (resilience infrastructure) to Phase 11B (lifecycle governance) addresses the existential risk of UI/Backend state divergence.

**Core Problem:**
Frontend FSM state is ephemeral (React useState). Backend ExecutionRequest state is durable (PostgreSQL). SSE provides real-time projection. These three components can diverge due to network disconnects, page refreshes, late packets, or timeout races.

**Core Solution:**
Establish **Backend as Single Source of Truth** with reconciliation layer that fetches authoritative state on reconnect/refresh. Add monotonic versioning to reject stale packets. Use stable idempotency keys to prevent duplicate executions.

**Platform Law:**
> **BACKEND TRUTH ALWAYS WINS**  
> Frontend FSM is a projection. SSE is a notification channel. ExecutionRequest table is the authority.

---

## 1. EXECUTION AUTHORITY RULES

### 1.1 Source of Truth Hierarchy

```
┌─────────────────────────────────────────────┐
│ TIER 1: ExecutionRequest (PostgreSQL)      │ ← AUTHORITATIVE
│   - Durable, ACID-guaranteed state          │
│   - Survives server restart                 │
│   - Monotonic version field                 │
│   - Immutable audit trail via Action model  │
└─────────────────────────────────────────────┘
                    ↓ projects to
┌─────────────────────────────────────────────┐
│ TIER 2: SSE Event Stream                    │ ← NOTIFICATION CHANNEL
│   - Real-time state change notifications    │
│   - Best-effort delivery (no guarantees)    │
│   - Can arrive out of order                 │
│   - Ephemeral (lost on disconnect)          │
└─────────────────────────────────────────────┘
                    ↓ updates
┌─────────────────────────────────────────────┐
│ TIER 3: Frontend FSM (useDecisionFSM)       │ ← EPHEMERAL PROJECTION
│   - React useState (lost on refresh)        │
│   - Optimistic UI updates                   │
│   - Must reconcile with Tier 1 on mount     │
│   - Must validate SSE packets against Tier 1│
└─────────────────────────────────────────────┘
```

### 1.2 Authority Rules

| Decision Point | Authority | Rationale |
|---|---|---|
| Execution started? | ExecutionRequest.createdAt | DB timestamp is canonical |
| Current status? | ExecutionRequest.status | Backend state machine is authoritative |
| Execution succeeded? | ExecutionRequest.status = 'EXECUTED_SUCCESS' | Only backend can confirm Meta API success |
| Idempotency check? | ExecutionRequest.idempotencyKey uniqueness | DB constraint enforces once-only |
| Timeout occurred? | ExecutionRequest.timeoutAt IS NOT NULL | Backend timeout detection wins over frontend |
| Version ordering? | ExecutionRequest.version (monotonic integer) | Backend increments, frontend compares |

### 1.3 Write Authority

- **Backend ONLY** writes to ExecutionRequest table
- **Frontend** submits execution requests via POST /api/execute/meta
- **Frontend** fetches status via GET /api/execution/:id/status
- **Frontend NEVER** assumes execution completion without backend confirmation

---

## 2. STATE OWNERSHIP MATRIX

| State Component | Owner | Write Authority | Read Source | Reconciliation |
|---|---|---|---|---|
| Execution status | Backend | ExecutionRequest.status | GET /api/execution/:id/status | Backend truth wins |
| Execution version | Backend | ExecutionRequest.version | SSE payload + status endpoint | Highest version wins |
| Idempotency key | Frontend → Backend | Frontend derives, backend enforces uniqueness | ExecutionRequest.idempotencyKey | Backend existing record wins |
| Decision contract | Frontend | DecisionFSM.outputData | localStorage (ephemeral) | Not reconciled (recreated on demand) |
| FSM view state | Frontend | useDecisionFSM reducer | React useState | Reset to COMMAND_CENTER on mount, restore if active execution found |
| Theater step | Frontend | useOrchestrate onStep | React useState | Not reconciled (UI-only animation) |
| SSE connection state | Frontend | SSEClient state machine | React useState | Reconnect with exponential backoff |
| Execution metadata | Backend | Action.payload | Action table (audit log) | Immutable after write |
| Workspace subscribers | Backend | events.js workspaceStreams Map | In-memory (server-scoped) | Rebuilt on server restart |

---

## 3. CANONICAL EXECUTION LIFECYCLE

### 3.1 Legal State Transitions

```
PENDING
   ↓
QUEUED ────────────┐
   ↓               ↓
EXECUTING      TIMED_OUT
   ↓               
   ├→ EXECUTED_SUCCESS
   ├→ EXECUTED_FAILED
   └→ CANCELLED
```

### 3.2 State Definitions

| Status | Meaning | Terminal? | Retryable? | Next Legal States |
|---|---|---|---|---|
| PENDING | ExecutionRequest created, not yet queued | No | N/A | QUEUED, TIMED_OUT |
| QUEUED | Added to BullMQ queue, awaiting worker pickup | No | N/A | EXECUTING, TIMED_OUT |
| EXECUTING | Worker actively calling Meta API | No | N/A | EXECUTED_SUCCESS, EXECUTED_FAILED, TIMED_OUT |
| EXECUTED_SUCCESS | Meta API returned success | Yes | No | (terminal) |
| EXECUTED_FAILED | Meta API returned error | Yes | Yes | (terminal, but user can retry with new execution) |
| TIMED_OUT | Backend timeout threshold exceeded | Yes | Yes | (terminal, but user can retry with new execution) |
| CANCELLED | User explicitly cancelled execution | Yes | No | (terminal) |

### 3.3 Transition Triggers

| Transition | Trigger | Actor | Version Increment? |
|---|---|---|---|
| → PENDING | POST /api/execute/meta creates ExecutionRequest | Backend | No (initial version = 1) |
| PENDING → QUEUED | ExecutionRequest added to BullMQ queue | Backend | Yes |
| QUEUED → EXECUTING | BullMQ worker picks up job | Backend | Yes |
| EXECUTING → EXECUTED_SUCCESS | Meta API returns 2xx | Backend | Yes |
| EXECUTING → EXECUTED_FAILED | Meta API returns 4xx/5xx | Backend | Yes |
| * → TIMED_OUT | Backend timeout detection | Backend | Yes |
| QUEUED/EXECUTING → CANCELLED | User cancels via DELETE /api/execution/:id | Backend | Yes |

### 3.4 Illegal Transitions (Enforced)

```javascript
// In src/routes/execution.js (implementation phase)
const LEGAL_TRANSITIONS = {
  PENDING: ['QUEUED', 'TIMED_OUT'],
  QUEUED: ['EXECUTING', 'TIMED_OUT', 'CANCELLED'],
  EXECUTING: ['EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED'],
  EXECUTED_SUCCESS: [],
  EXECUTED_FAILED: [],
  TIMED_OUT: [],
  CANCELLED: [],
};

function isLegalTransition(from, to) {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}
```

### 3.5 ExecutionStatus Enum

**Recommendation:** Use a real TypeScript enum instead of string literals to enforce type safety and prevent illegal transitions.

```typescript
// client/src/types/execution.ts (implementation phase)
export enum ExecutionStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  EXECUTING = 'EXECUTING',
  EXECUTED_SUCCESS = 'EXECUTED_SUCCESS',
  EXECUTED_FAILED = 'EXECUTED_FAILED',
  TIMED_OUT = 'TIMED_OUT',
  CANCELLED = 'CANCELLED',
}

// Backend: src/types/execution.js (implementation phase)
export const ExecutionStatus = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  EXECUTING: 'EXECUTING',
  EXECUTED_SUCCESS: 'EXECUTED_SUCCESS',
  EXECUTED_FAILED: 'EXECUTED_FAILED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
} as const;

export type ExecutionStatusValue = typeof ExecutionStatus[keyof typeof ExecutionStatus];
```

#### Benefits

| Benefit | Impact |
|---|---|
| **Illegal transition prevention** | TypeScript exhaustiveness checking ensures all states are handled |
| **Typo prevention** | `ExecutionStatus.EXECUTING` instead of `'EXECUTNG'` (typo) |
| **Analytics consistency** | Single source of truth for status strings in telemetry |
| **Exhaustiveness checking** | Switch statements must handle all enum cases or raise compile error |
| **Refactor safety** | Renaming a status updates all references automatically |

#### Usage Pattern

```typescript
// ❌ Before: String literals (error-prone)
if (execution.status === 'EXECUTNG') {  // typo not caught
  // ...
}

// ✅ After: Enum (type-safe)
if (execution.status === ExecutionStatus.EXECUTING) {
  // TypeScript catches typos at compile time
}

// ✅ Exhaustiveness checking
function getStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case ExecutionStatus.PENDING: return 'Pending';
    case ExecutionStatus.QUEUED: return 'Queued';
    case ExecutionStatus.EXECUTING: return 'Executing';
    case ExecutionStatus.EXECUTED_SUCCESS: return 'Success';
    case ExecutionStatus.EXECUTED_FAILED: return 'Failed';
    case ExecutionStatus.TIMED_OUT: return 'Timed Out';
    case ExecutionStatus.CANCELLED: return 'Cancelled';
    // TypeScript enforces: all cases handled or compilation error
  }
}
```

---

## 4. VERSIONING STRATEGY

### 4.1 Design Decision: Monotonic Integer Version

**Chosen:** ✅ Monotonic Integer  
**Rejected:** ❌ Timestamps (clock drift, time zones, leap seconds)  
**Rejected:** ❌ UUID-based ordering (complex comparison, no natural ordering)  
**Rejected:** ❌ Event sequence numbers (requires event log infrastructure)

### 4.2 Schema Addition

```prisma
model ExecutionRequest {
  id               String   @id @default(cuid())
  version          Int      @default(1)  // ← NEW FIELD
  workspaceId      String
  idempotencyKey   String   @unique
  actionType       String
  targetId         String
  targetType       String   @default("campaign")
  status           String   @default("PENDING")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  timeoutAt        DateTime?
  executedAt       DateTime?
  errorMessage     String?
  
  @@index([workspaceId, status])
  @@index([idempotencyKey])
}
```

### 4.3 Version Increment Rules

- **Initial version:** 1 (on ExecutionRequest.create)
- **Increment on:** Every status transition (PENDING→QUEUED: v2, QUEUED→EXECUTING: v3, etc.)
- **Increment strategy:** `await prisma.executionRequest.update({ where: { id }, data: { status: newStatus, version: { increment: 1 } } })`
- **SSE payload:** Always include current version in EXECUTION_STATUS event
- **Frontend rule:** Ignore SSE events where `event.version <= state.currentVersion`

### 4.4 Stale Packet Detection

```typescript
// In DecisionFeed.jsx (implementation phase)
const { state, updateExecutionStatus } = useDecisionFSM();

useSSE({
  onMessage: (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'EXECUTION_STATUS') {
      const incomingVersion = data.version ?? 0;
      const currentVersion = state.executionStatus?.version ?? 0;
      
      // REJECT stale packets
      if (incomingVersion <= currentVersion) {
        console.warn('[SSE] Rejecting stale packet', { incomingVersion, currentVersion });
        return;
      }
      
      // ACCEPT fresh packets
      updateExecutionStatus(data.status, data.error, data.timestamp, incomingVersion);
    }
  }
});
```

### 4.5 Optimistic Concurrency Control

**Critical Gap:** Versioning alone is not sufficient. Updates must check expected version to prevent race conditions.

#### Race Condition Scenarios

| Actor | Action | Without OCC | With OCC |
|---|---|---|---|
| Worker | Update to EXECUTING | Overwrites timeout | Fails if timeout already set |
| Timeout handler | Update to TIMED_OUT | Overwrites success | Fails if worker already succeeded |
| Cancellation | Update to CANCELLED | Overwrites executing | Fails if execution already terminal |
| Retry | Create new execution | Duplicate execution | Idempotency check prevents |

#### Implementation Pattern

```javascript
// Backend: src/routes/execution.js (implementation phase)
async function transitionStatus(executionId, newStatus, expectedVersion) {
  const result = await prisma.executionRequest.updateMany({
    where: {
      id: executionId,
      version: expectedVersion,  // ← OPTIMISTIC LOCK
    },
    data: {
      status: newStatus,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    // Version mismatch - another actor modified state
    const current = await prisma.executionRequest.findUnique({
      where: { id: executionId },
      select: { status: true, version: true },
    });
    
    throw new ConcurrencyError(
      `Status transition failed: expected version ${expectedVersion}, current version ${current.version}`
    );
  }

  return result;
}
```

#### Critical Update Points

**1. Worker pickup (QUEUED → EXECUTING)**
```javascript
// BullMQ worker
await transitionStatus(executionId, 'EXECUTING', expectedVersion);
// If fails: another worker picked it up OR timeout occurred
```

**2. Meta API completion (EXECUTING → SUCCESS/FAILED)**
```javascript
const expectedVersion = execution.version;
await transitionStatus(executionId, 'EXECUTED_SUCCESS', expectedVersion);
// If fails: timeout handler already marked as TIMED_OUT
```

**3. Timeout detection (ANY → TIMED_OUT)**
```javascript
const expectedVersion = execution.version;
try {
  await transitionStatus(executionId, 'TIMED_OUT', expectedVersion);
} catch (ConcurrencyError) {
  // Success arrived just before timeout - fetch fresh state
  const fresh = await prisma.executionRequest.findUnique({ where: { id: executionId } });
  if (fresh.status === 'EXECUTED_SUCCESS') {
    // Backend truth wins - no timeout error
    return;
  }
}
```

**4. User cancellation (QUEUED/EXECUTING → CANCELLED)**
```javascript
const expectedVersion = execution.version;
await transitionStatus(executionId, 'CANCELLED', expectedVersion);
// If fails: execution already completed
```

#### Error Handling

```javascript
class ConcurrencyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConcurrencyError';
    this.retryable = false; // Never retry concurrency conflicts
  }
}

// In execution route
try {
  await transitionStatus(executionId, newStatus, expectedVersion);
} catch (err) {
  if (err instanceof ConcurrencyError) {
    // Fetch fresh state and return to caller
    const fresh = await getExecutionStatus(executionId);
    return res.status(409).json({
      error: 'Concurrency conflict',
      code: 'VERSION_CONFLICT',
      currentState: fresh,
    });
  }
  throw err;
}
```

### 4.6 ExecutionLifecycleService (Centralized Transition Layer)

**Critical Requirement:** ALL status transitions MUST go through a centralized service. Direct `prisma.executionRequest.update()` calls are FORBIDDEN.

#### Why Centralization Matters

| Concern | Without Service | With Service |
|---|---|---|
| **Version increment** | Manual in each update (easy to forget) | Automatic in every transition |
| **Telemetry** | Scattered tracking calls (inconsistent) | Centralized tracking (guaranteed) |
| **Validation** | Repeated isLegalTransition checks | Single validation point |
| **Concurrency checks** | Manual expectedVersion handling | Enforced in every transition |
| **Audit logging** | Manual ExecutionTransition creation | Automatic in every transition |

#### Service Interface

```javascript
// Backend: src/services/executionLifecycle.js (implementation phase)
import { prisma } from '../lib/prisma.js';
import { trackExecutionTransition } from '../lib/errorTelemetry.js';
import { ExecutionStatus } from '../types/execution.js';

class ExecutionLifecycleService {
  /**
   * Transition execution to new status with full governance.
   * @param {string} executionId - ExecutionRequest.id
   * @param {ExecutionStatus} newStatus - Target status (must be legal transition)
   * @param {number} expectedVersion - Current version (optimistic lock)
   * @param {string} actor - Who triggered transition (e.g., 'worker', 'timeout-handler', 'user')
   * @param {object} metadata - Optional metadata for audit log
   * @returns {Promise<ExecutionRequest>} Updated execution
   * @throws {ConcurrencyError} If version mismatch
   * @throws {IllegalTransitionError} If transition not allowed
   */
  async transition(executionId, newStatus, expectedVersion, actor, metadata = {}) {
    // 1. Fetch current state
    const current = await prisma.executionRequest.findUnique({
      where: { id: executionId },
      select: { status: true, version: true },
    });

    if (!current) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // 2. Validate legal transition
    if (!this.isLegalTransition(current.status, newStatus)) {
      throw new IllegalTransitionError(
        `Illegal transition: ${current.status} → ${newStatus}`
      );
    }

    // 3. Optimistic concurrency control
    const result = await prisma.executionRequest.updateMany({
      where: {
        id: executionId,
        version: expectedVersion,  // ← OPTIMISTIC LOCK
      },
      data: {
        status: newStatus,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    if (result.count === 0) {
      // Version mismatch - fetch fresh state
      const fresh = await prisma.executionRequest.findUnique({
        where: { id: executionId },
        select: { status: true, version: true },
      });
      
      throw new ConcurrencyError(
        `Version conflict: expected ${expectedVersion}, current ${fresh.version} (status: ${fresh.status})`
      );
    }

    // 4. Fetch updated state
    const updated = await prisma.executionRequest.findUnique({
      where: { id: executionId },
    });

    // 5. Write audit log
    await prisma.executionTransition.create({
      data: {
        executionId,
        fromStatus: current.status,
        toStatus: newStatus,
        version: updated.version,
        actor,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    // 6. Emit telemetry
    trackExecutionTransition({
      executionId,
      fromStatus: current.status,
      toStatus: newStatus,
      version: updated.version,
      actor,
      durationMs: Date.now() - new Date(updated.createdAt).getTime(),
    });

    // 7. Broadcast SSE event
    await this.broadcastStatusChange(updated);

    return updated;
  }

  isLegalTransition(from, to) {
    const LEGAL_TRANSITIONS = {
      [ExecutionStatus.PENDING]: [ExecutionStatus.QUEUED, ExecutionStatus.TIMED_OUT],
      [ExecutionStatus.QUEUED]: [ExecutionStatus.EXECUTING, ExecutionStatus.TIMED_OUT, ExecutionStatus.CANCELLED],
      [ExecutionStatus.EXECUTING]: [ExecutionStatus.EXECUTED_SUCCESS, ExecutionStatus.EXECUTED_FAILED, ExecutionStatus.TIMED_OUT, ExecutionStatus.CANCELLED],
      [ExecutionStatus.EXECUTED_SUCCESS]: [],
      [ExecutionStatus.EXECUTED_FAILED]: [],
      [ExecutionStatus.TIMED_OUT]: [],
      [ExecutionStatus.CANCELLED]: [],
    };
    return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
  }

  async broadcastStatusChange(execution) {
    const { broadcastToWorkspace } = await import('../routes/events.js');
    await broadcastToWorkspace(execution.workspaceId, {
      type: 'EXECUTION_STATUS',
      executionId: execution.id,
      status: execution.status,
      version: execution.version,
      timestamp: execution.updatedAt.toISOString(),
    });
  }
}

export const executionLifecycle = new ExecutionLifecycleService();

// Custom errors
export class IllegalTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalTransitionError';
    this.retryable = false;
  }
}

export class ConcurrencyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConcurrencyError';
    this.retryable = false;
  }
}
```

#### Usage Examples

**1. Worker pickup (QUEUED → EXECUTING)**
```javascript
// ❌ Before: Direct Prisma update (dangerous)
await prisma.executionRequest.update({
  where: { id: executionId },
  data: { status: 'EXECUTING' },
});

// ✅ After: Centralized service (safe)
await executionLifecycle.transition(
  executionId,
  ExecutionStatus.EXECUTING,
  expectedVersion,
  'worker',
  { workerId: process.pid }
);
```

**2. Timeout detection (ANY → TIMED_OUT)**
```javascript
// ✅ Service handles concurrency automatically
try {
  await executionLifecycle.transition(
    executionId,
    ExecutionStatus.TIMED_OUT,
    expectedVersion,
    'timeout-handler',
    { threshold: 120000 }
  );
} catch (err) {
  if (err instanceof ConcurrencyError) {
    // Success arrived just before timeout - backend truth wins
    return;
  }
  throw err;
}
```

**3. User cancellation (QUEUED/EXECUTING → CANCELLED)**
```javascript
// DELETE /api/execution/:id route
await executionLifecycle.transition(
  executionId,
  ExecutionStatus.CANCELLED,
  expectedVersion,
  'user',
  { userId: req.user.id }
);
```

### 4.7 Execution Transition Audit Log

**Purpose:** Forensic debugging for production incidents. The current Action audit log tracks execution creation but not status transitions.

#### Schema Addition

```prisma
// prisma/schema.prisma (implementation phase)
model ExecutionTransition {
  id          String   @id @default(cuid())
  executionId String
  fromStatus  String
  toStatus    String
  version     Int      // Version AFTER transition
  actor       String   // 'worker' | 'timeout-handler' | 'user' | 'api'
  metadata    String?  // JSON-encoded context (e.g., { workerId, userId, errorCode })
  createdAt   DateTime @default(now())

  @@index([executionId])
  @@index([createdAt])
}
```

#### What This Captures (vs Action Table)

| Table | Purpose | Example Query |
|---|---|---|
| **Action** | Execution creation + final outcome | "What Meta action was executed?" |
| **ExecutionTransition** | Status transition history | "When did execution get stuck in EXECUTING?" |

#### Example Audit Trail

Execution timeline for debugging timeout incident:

```
executionId: exec_abc123

ExecutionTransition records:
1. 2026-05-19 14:32:01 | NULL → PENDING       | v1 | actor: api              | metadata: { userId: 'omar' }
2. 2026-05-19 14:32:02 | PENDING → QUEUED     | v2 | actor: worker           | metadata: { workerId: 1234 }
3. 2026-05-19 14:32:03 | QUEUED → EXECUTING   | v3 | actor: worker           | metadata: { workerId: 1234 }
4. 2026-05-19 14:34:05 | EXECUTING → TIMED_OUT| v4 | actor: timeout-handler  | metadata: { threshold: 120000 }
```

**Forensic insight:** Execution started at 14:32:03, timed out at 14:34:05 (122 seconds later). Meta API never responded.

#### Query Patterns

**1. Find stuck executions**
```sql
SELECT executionId, fromStatus, toStatus, createdAt
FROM ExecutionTransition
WHERE toStatus = 'EXECUTING'
  AND executionId NOT IN (
    SELECT executionId FROM ExecutionTransition
    WHERE toStatus IN ('EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED')
  )
ORDER BY createdAt DESC
LIMIT 10;
```

**2. Analyze timeout patterns**
```sql
SELECT 
  DATE_TRUNC('hour', createdAt) AS hour,
  COUNT(*) AS timeout_count
FROM ExecutionTransition
WHERE toStatus = 'TIMED_OUT'
GROUP BY hour
ORDER BY hour DESC;
```

**3. Concurrency conflict frequency**
```sql
-- Infer conflicts from rapid version jumps (< 1 second between transitions)
SELECT 
  executionId,
  version,
  toStatus,
  actor,
  createdAt,
  LAG(createdAt) OVER (PARTITION BY executionId ORDER BY version) AS prev_timestamp
FROM ExecutionTransition
WHERE (EXTRACT(EPOCH FROM createdAt) - EXTRACT(EPOCH FROM LAG(createdAt) OVER (PARTITION BY executionId ORDER BY version))) < 1
ORDER BY createdAt DESC;
```

#### When NOT to Use This

- **Ephemeral UI state:** Theater step animations, FSM view transitions (not persisted)
- **SSE connection state:** Client reconnect attempts (telemetry only)
- **User interactions:** Button clicks, modal opens (not execution-related)

#### Retention Policy

- **Beta (Phase 11B):** Keep all transitions (no pruning)
- **Production (Phase 12+):** Prune transitions older than 90 days, keep only:
  - All transitions for executions with `status IN ('EXECUTED_FAILED', 'TIMED_OUT')`
  - All transitions from last 7 days (debugging window)

---

## 5. RECONCILIATION RULES

### 5.1 Truth Winner Matrix

| Scenario | Frontend State | Backend State | Winner | Action |
|---|---|---|---|---|
| Timeout vs Success | TIMED_OUT (local) | EXECUTED_SUCCESS (DB) | Backend | Fetch status, update FSM to SUCCESS, show toast |
| Stale SSE packet | EXECUTED_SUCCESS (v5) | EXECUTING (v3, late packet) | Frontend (higher version) | Ignore SSE packet |
| Refresh during execution | (lost, default COMMAND_CENTER) | EXECUTING (DB) | Backend | On mount, fetch active execution, restore FSM |
| Duplicate click | Two execution attempts | One ExecutionRequest (unique key) | Backend | Second POST returns existing execution (idempotent replay) |
| Network disconnect | EXECUTING (optimistic) | EXECUTED_SUCCESS (DB, completed during downtime) | Backend | On reconnect, fetch status, reconcile FSM |
| SSE reconnect | EXECUTING (stale) | EXECUTED_FAILED (DB) | Backend | SSE resumes, fresh event sent with current version |

### 5.2 Reconciliation Trigger Points

1. **On SSE reconnect** (after network recovery)
2. **On page refresh** (DecisionFeed mount)
3. **On timeout** (before showing timeout error to user)
4. **On SSE version conflict** (incoming version ≤ current version)
5. **Before execution** (idempotency check via POST /api/execute/meta)

### 5.3 Reconciliation Protocol

#### Critical Design Decision: Backend Authority for Active Executions

**Problem with sessionStorage-only approach:**
- Tab crash → lost
- Browser cleanup → lost
- Multi-tab → inconsistent
- Mobile memory reclaim → lost

**Solution: Two-tier recovery**

```
┌─────────────────────────────────────────────┐
│ TIER 1: GET /api/execution/active          │ ← AUTHORITATIVE
│   - Backend query: WHERE status IN (...)    │
│   - Survives all failure modes              │
│   - Source of truth for recovery            │
└─────────────────────────────────────────────┘
                    ↓ optimized by
┌─────────────────────────────────────────────┐
│ TIER 2: sessionStorage hint                 │ ← OPTIMIZATION ONLY
│   - Fast path (no API call if null)         │
│   - NOT authoritative                       │
│   - Always validated against backend        │
└─────────────────────────────────────────────┘
```

#### Backend Endpoint: GET /api/execution/active

```javascript
// src/routes/execution.js (implementation phase)
router.get('/active', requireAuth, async (req, res) => {
  const { workspaceId, uid } = req;

  // Query for all non-terminal executions in this workspace
  const activeExecutions = await prisma.executionRequest.findMany({
    where: {
      workspaceId,
      status: { in: ['PENDING', 'QUEUED', 'EXECUTING'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 5, // Limit to recent 5 (prevents runaway query)
    select: {
      id: true,
      idempotencyKey: true,
      actionType: true,
      targetId: true,
      targetType: true,
      status: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res.json({
    executions: activeExecutions,
    count: activeExecutions.length,
  });
});
```

#### Frontend Recovery Pattern

```typescript
// New hook: useExecutionRecovery (implementation phase)
async function reconcileExecution(executionId: string): Promise<ExecutionState | null> {
  try {
    // Step 1: Fetch authoritative state from backend
    const { data } = await api.get(`/api/execution/${executionId}/status`);
    
    // Step 2: Return normalized state
    return {
      executionId: data.id,
      status: data.status,
      version: data.version,
      createdAt: data.createdAt,
      executedAt: data.executedAt,
      error: data.errorMessage,
    };
  } catch (err) {
    console.error('[Reconciliation] Failed to fetch execution status', err);
    return null;
  }
}

// CORRECTED: Backend authority pattern (DecisionFeed.jsx)
useEffect(() => {
  // Step 1: Check sessionStorage hint (optimization)
  const hintExecutionId = sessionStorage.getItem('lumi:activeExecution');

  // Step 2: ALWAYS fetch from backend (source of truth)
  api.get('/api/execution/active').then(({ data }) => {
    const activeExecutions = data.executions || [];

    if (activeExecutions.length === 0) {
      // No active executions - clear stale hint
      sessionStorage.removeItem('lumi:activeExecution');
      return;
    }

    // Step 3: Restore most recent active execution
    const mostRecent = activeExecutions[0];
    
    // Step 4: Validate hint matches backend truth
    if (hintExecutionId && hintExecutionId !== mostRecent.id) {
      console.warn('[Recovery] sessionStorage hint stale', {
        hint: hintExecutionId,
        actual: mostRecent.id,
      });
    }

    // Step 5: Restore FSM
    dispatch({ type: 'RESTORE_EXECUTION', executionState: mostRecent });
    toast.info('Restored active execution', { duration: 2000 });

    // Step 6: Update hint to match backend
    sessionStorage.setItem('lumi:activeExecution', mostRecent.id);
  }).catch((err) => {
    console.error('[Recovery] Failed to fetch active executions', err);
    // Clear stale hint on error
    sessionStorage.removeItem('lumi:activeExecution');
  });
}, []);
```

#### Recovery Failure Modes Solved

| Failure Mode | sessionStorage-only | Backend Authority |
|---|---|---|
| Tab crash | ❌ Lost forever | ✅ Restored on next mount |
| Browser cleanup | ❌ Lost forever | ✅ Restored from backend |
| Multi-tab | ❌ Inconsistent state | ✅ All tabs see same execution |
| Mobile memory reclaim | ❌ Lost forever | ✅ Restored on app resume |
| Server restart | ❌ Lost (SSE disconnected) | ✅ Backend state persisted |
| Cache clear | ❌ Lost | ✅ Backend source of truth |

#### sessionStorage Usage Rules

```typescript
// ✅ CORRECT: Write hint for optimization
sessionStorage.setItem('lumi:activeExecution', executionId);

// ✅ CORRECT: Read hint, but validate against backend
const hint = sessionStorage.getItem('lumi:activeExecution');
const { data } = await api.get('/api/execution/active');
const actual = data.executions[0]?.id;
if (hint !== actual) {
  console.warn('Hint stale - backend wins');
}

// ❌ WRONG: Trust hint without validation
const executionId = sessionStorage.getItem('lumi:activeExecution');
if (executionId) {
  // DANGER: assumes hint is authoritative
  dispatch({ type: 'RESTORE_EXECUTION', executionId });
}

// ❌ WRONG: Skip backend check if hint exists
const hint = sessionStorage.getItem('lumi:activeExecution');
if (!hint) {
  // ONLY fetch if no hint - WRONG
  await api.get('/api/execution/active');
}
```

---

## 6. RECOVERY PROTOCOL

### 6.1 UX Decision: Silent Recovery + Toast

**Chosen:** ✅ Silent Recovery + Toast Notification  
**Rejected:** ❌ Modal Dialog (interrupts user flow, requires dismissal)  
**Rejected:** ❌ Error boundary (treats reconciliation as error, too aggressive)  
**Rejected:** ❌ Banner notification (screen real estate cost, dismissal burden)

### 6.2 Recovery Scenarios

#### Scenario A: Page Refresh During Execution

**State Before Refresh:**
- FSM: API_EXECUTION (isLocked: true)
- Backend: EXECUTING (version: 3)
- sessionStorage: `lumi:activeExecution = exec_xyz123`

**State After Refresh:**
- FSM: COMMAND_CENTER (default initial state)
- Backend: EXECUTING (version: 3, unchanged)
- sessionStorage: `lumi:activeExecution = exec_xyz123` (persists)

**Recovery Flow:**
1. DecisionFeed mounts
2. Check sessionStorage for `lumi:activeExecution`
3. Call GET /api/execution/exec_xyz123/status
4. Backend returns: `{ status: 'EXECUTING', version: 3 }`
5. Dispatch `RESTORE_EXECUTION` action
6. FSM transitions to API_EXECUTION state
7. Show toast: "Restored active execution"
8. SSE client reconnects, resumes receiving updates

#### Scenario B: SSE Reconnect After Network Drop

**State Before Disconnect:**
- FSM: EXECUTING (version: 4)
- SSE: CONNECTED
- Backend: EXECUTING (version: 4)

**State During Downtime (30s):**
- FSM: EXECUTING (stale, version: 4)
- SSE: RECONNECTING (exponential backoff)
- Backend: EXECUTED_SUCCESS (version: 5, completed during downtime)

**Recovery Flow:**
1. SSE client reconnects (new EventSource created)
2. Backend sends fresh EXECUTION_STATUS event with version: 5
3. Frontend receives event: `{ status: 'EXECUTED_SUCCESS', version: 5 }`
4. Version check: 5 > 4 ✅ (fresh packet)
5. FSM transitions to EXECUTED_SUCCESS
6. Show toast: "Action executed successfully"
7. No additional API call needed (SSE delivered fresh state)

#### Scenario C: Timeout Race Condition

**State at T=118s:**
- FSM: EXECUTING (optimistic)
- Backend: EXECUTING (Meta API call in progress)
- Frontend timeout: fires in 2s (120s threshold)

**State at T=120s:**
- Frontend timeout fires
- FSM: About to transition to ERROR
- Backend: Meta API returns success 100ms later

**Recovery Flow:**
1. Frontend timeout fires
2. **Before** showing error to user, call GET /api/execution/:id/status
3. Backend returns: `{ status: 'EXECUTED_SUCCESS', version: 5 }`
4. Backend truth wins ✅
5. Clear timeout timer
6. FSM transitions to EXECUTED_SUCCESS (not ERROR)
7. Show toast: "Action executed successfully"

### 6.3 Recovery Hook API

```typescript
// client/src/hooks/useExecutionRecovery.ts (implementation phase)

interface UseExecutionRecoveryOptions {
  onRecovered: (state: ExecutionState) => void;
  onRecoveryFailed: (error: Error) => void;
}

export function useExecutionRecovery(options: UseExecutionRecoveryOptions) {
  const recover = useCallback(async (executionId: string) => {
    try {
      const state = await reconcileExecution(executionId);
      if (state) {
        options.onRecovered(state);
      } else {
        throw new Error('Reconciliation returned null');
      }
    } catch (err) {
      options.onRecoveryFailed(err);
    }
  }, [options]);

  const checkActiveExecution = useCallback(async () => {
    const activeId = sessionStorage.getItem('lumi:activeExecution');
    if (activeId) {
      await recover(activeId);
    }
  }, [recover]);

  return { recover, checkActiveExecution };
}
```

---

## 7. IDEMPOTENCY CONTRACT

### 7.1 Current Problem: Unstable Keys

**Current Implementation (DecisionFeed.jsx:259):**
```javascript
const idempotencyKey = crypto.randomUUID(); // ⚠️ UNSTABLE
```

**Issue:**
- Each execution attempt generates a new UUID
- Double-click creates two ExecutionRequest rows with different keys
- Backend idempotency check fails (keys don't match)
- Result: duplicate executions on Meta API

### 7.2 Solution: Stable Key Derivation

**Formula:**
```
idempotencyKey = `execution:${decisionId}:${actionType}`
```

**Example:**
```javascript
// Decision contract has stable ID (created during orchestration)
const decisionId = state.outputData.id; // e.g., "dec-1716134567-a3f9k2"
const actionType = 'PAUSE_CAMPAIGN';

// Derive stable key
const idempotencyKey = `execution:${decisionId}:${actionType}`;
// Result: "execution:dec-1716134567-a3f9k2:PAUSE_CAMPAIGN"
```

**Guarantees:**
- Same decision + same action = same key
- Double-click → same key → idempotency check succeeds
- Backend returns existing ExecutionRequest (no duplicate)
- Frontend receives `{ idempotentReplay: true }` response

### 7.3 Key Lifecycle

```
┌─────────────────────────────────────────────┐
│ 1. User clicks "Confirm Execution"          │
│    FSM: SUCCESS → CONFIRM_EXECUTION         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 2. Frontend derives idempotency key         │
│    key = execution:${decisionId}:${action}  │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 3. POST /api/execute/meta { key, ... }     │
│    Backend checks: ExecutionRequest exists? │
└─────────────────────────────────────────────┘
         ↓ NO                    ↓ YES
┌──────────────────┐    ┌──────────────────┐
│ Create new       │    │ Return existing  │
│ ExecutionRequest │    │ { idempotentReplay: true } │
│ Start execution  │    │ Status = EXECUTED_SUCCESS │
└──────────────────┘    └──────────────────┘
```

### 7.4 Edge Cases

| Scenario | Key Behavior | Backend Response |
|---|---|---|
| User clicks twice rapidly | Same key both times | Second request returns existing ExecutionRequest (202 response) |
| User clicks Execute, refreshes page, clicks again | Same key (decisionId persists in localStorage) | Idempotent replay, returns existing execution |
| Same decision executed twice (e.g., PAUSE, later SCALE) | Different keys (different actionType) | Two separate ExecutionRequest rows (correct behavior) |
| Decision replayed from history, executed again | Same decisionId → same key | Idempotent replay (expected - decision already executed) |
| Decision ID collision (crypto.randomUUID) | Statistically impossible (2^122 keyspace) | N/A |

### 7.5 Migration Note

**Existing ExecutionRequest rows** (created with `crypto.randomUUID()` keys) remain valid. After implementation:
- Old keys: UUIDv4 format (e.g., `a1b2c3d4-...`)
- New keys: Prefixed format (e.g., `execution:dec-...:PAUSE_CAMPAIGN`)
- No conflict (different key spaces)
- No migration needed (old rows are immutable audit log)

---

## 8. ACTIVE EXECUTION POLICY

### 8.1 Design Decision: One Active Execution Per Decision

**Chosen:** ✅ One Active Execution Per Decision  
**Rejected:** ❌ One per workspace (too restrictive, blocks concurrent decisions)  
**Rejected:** ❌ Unlimited concurrent (risk of resource exhaustion, Meta API rate limits)

**Rationale:**
- A decision is an atomic unit of work (one campaign analysis → one action)
- User can make multiple decisions concurrently (analyze 3 campaigns)
- But the same decision should not execute twice simultaneously
- Idempotency key (`execution:${decisionId}:${actionType}`) enforces this at DB level

### 8.2 Active Execution Definition

An execution is "active" if:
```sql
status IN ('PENDING', 'QUEUED', 'EXECUTING')
```

Terminal statuses (not active):
```sql
status IN ('EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED')
```

### 8.3 Active Execution Query

```javascript
// Backend helper (implementation phase)
async function getActiveExecution(decisionId, actionType) {
  const idempotencyKey = `execution:${decisionId}:${actionType}`;
  return await prisma.executionRequest.findFirst({
    where: {
      idempotencyKey,
      status: { in: ['PENDING', 'QUEUED', 'EXECUTING'] },
    },
  });
}
```

### 8.4 Frontend Active Execution Tracking

```javascript
// Store active execution ID in sessionStorage (survives refresh)
sessionStorage.setItem('lumi:activeExecution', executionId);

// Clear on terminal status
if (isTerminalStatus(status)) {
  sessionStorage.removeItem('lumi:activeExecution');
}
```

### 8.5 Concurrent Decision Scenario

**User Flow:**
1. Upload CSV with 5 campaigns
2. Analyze Campaign A → Decision A (id: `dec-001`)
3. Click "Execute PAUSE" → ExecutionRequest created (id: `exec-A`)
4. While exec-A running, analyze Campaign B → Decision B (id: `dec-002`)
5. Click "Execute SCALE" → ExecutionRequest created (id: `exec-B`)

**Result:**
- Two active executions: `exec-A` (PAUSE) and `exec-B` (SCALE)
- Different decisionIds → different idempotency keys → no conflict
- Both execute concurrently ✅

**Prevented Scenario:**
1. Analyze Campaign A → Decision A
2. Click "Execute PAUSE" → `exec-A` created (status: EXECUTING)
3. User double-clicks "Execute PAUSE" again
4. Second POST /api/execute/meta with same idempotency key
5. Backend finds existing `exec-A` (status: EXECUTING)
6. Returns `{ idempotentReplay: true, executionId: 'exec-A' }`
7. No duplicate execution ✅

---

## 9. IMPLEMENTATION ROADMAP

### Phase 11B-B2: Core Implementation (8 tasks)

**Architectural Foundation (3 new tasks from final recommendations):**
1. ExecutionStatus enum (type safety)
2. ExecutionLifecycleService (centralized transitions)
3. ExecutionTransition audit log (forensic debugging)

**Original Core Tasks:**
4. Version field (monotonic versioning)
5. Status endpoints (GET /api/execution/:id/status, GET /api/execution/active)
6. Stable idempotency (derive from decisionId)
7. Reconciliation hook (useExecutionRecovery)
8. Version-aware SSE (stale packet rejection)

#### Task 1: ExecutionStatus Enum — Type Safety
**Files:**
- `client/src/types/execution.ts` (new)
- `src/types/execution.js` (new)

**Frontend (TypeScript):**
```typescript
// client/src/types/execution.ts
export enum ExecutionStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  EXECUTING = 'EXECUTING',
  EXECUTED_SUCCESS = 'EXECUTED_SUCCESS',
  EXECUTED_FAILED = 'EXECUTED_FAILED',
  TIMED_OUT = 'TIMED_OUT',
  CANCELLED = 'CANCELLED',
}

export type ExecutionStatusValue = `${ExecutionStatus}`;
```

**Backend (JavaScript):**
```javascript
// src/types/execution.js
export const ExecutionStatus = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  EXECUTING: 'EXECUTING',
  EXECUTED_SUCCESS: 'EXECUTED_SUCCESS',
  EXECUTED_FAILED: 'EXECUTED_FAILED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
};

export const isValidStatus = (status) => {
  return Object.values(ExecutionStatus).includes(status);
};
```

**Migration Strategy:**
1. Create type files (no breaking changes)
2. Import ExecutionStatus in new code
3. Gradually replace string literals in existing code
4. Add exhaustiveness checks in switch statements

**Validation:**
- Import ExecutionStatus in execution.js routes
- Replace `status: 'PENDING'` with `status: ExecutionStatus.PENDING`
- Verify TypeScript catches typos at compile time
- Test switch statement exhaustiveness checking

#### Task 2: DB Migration — Version Field
**File:** `prisma/migrations/YYYYMMDDHHMMSS_add_execution_version/migration.sql`

```sql
ALTER TABLE "ExecutionRequest"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill existing rows (all get version 1)
-- No need to increment (historical data, already terminal)
```

**Validation:**
- Run `npx prisma migrate dev --name add_execution_version`
- Verify `prisma/schema.prisma` includes `version Int @default(1)`
- Check existing ExecutionRequest rows have `version = 1`

#### Task 3: Status Endpoints — GET /api/execution/:id/status + GET /api/execution/active
**File:** `src/routes/execution.js`

```javascript
// New endpoint (add to existing routes)
router.get('/:executionId/status', requireAuth, async (req, res) => {
  const { executionId } = req.params;
  const { workspaceId } = req;

  const execution = await prisma.executionRequest.findFirst({
    where: { id: executionId, workspaceId },
  });

  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }

  return res.json({
    id: execution.id,
    status: execution.status,
    version: execution.version,
    createdAt: execution.createdAt,
    executedAt: execution.executedAt,
    errorMessage: execution.errorMessage,
    idempotencyKey: execution.idempotencyKey,
    actionType: execution.actionType,
    targetId: execution.targetId,
  });
});

// Active executions endpoint
router.get('/active', requireAuth, async (req, res) => {
  const { workspaceId } = req;

  const activeExecutions = await prisma.executionRequest.findMany({
    where: {
      workspaceId,
      status: { in: ['PENDING', 'QUEUED', 'EXECUTING'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      idempotencyKey: true,
      actionType: true,
      targetId: true,
      status: true,
      version: true,
      createdAt: true,
    },
  });

  return res.json({
    executions: activeExecutions,
    count: activeExecutions.length,
  });
});
```

**Validation:**
- Create test ExecutionRequest row
- Call GET /api/execution/:id/status
- Verify response includes version field
- Test 404 case (nonexistent executionId)
- Call GET /api/execution/active
- Verify only non-terminal executions returned
- Test with no active executions (empty array)

#### Task 4: Stable Idempotency — Key Derivation
**File:** `client/src/pages/DecisionFeed.jsx` (line 259)

**Before:**
```javascript
const idempotencyKey = crypto.randomUUID();
```

**After:**
```javascript
const decisionId = state.outputData?.id;
if (!decisionId) {
  reportError('Missing decision ID', 'INVALID_STATE', 'validation', false, 'Decision contract corrupted');
  return;
}
const idempotencyKey = `execution:${decisionId}:${actionType}`;
```

**Validation:**
- Click "Execute" twice rapidly
- Verify second request returns `idempotentReplay: true`
- Check DB: only one ExecutionRequest row created
- Verify toast shows "Action already executed"

#### Task 5: Reconciliation Hook — useExecutionRecovery
**File:** `client/src/hooks/useExecutionRecovery.ts` (new file)

```typescript
export function useExecutionRecovery({ onRecovered, onRecoveryFailed }) {
  const reconcileExecution = useCallback(async (executionId: string) => {
    try {
      const { data } = await api.get(`/api/execution/${executionId}/status`);
      onRecovered({
        executionId: data.id,
        status: data.status,
        version: data.version,
        createdAt: data.createdAt,
        executedAt: data.executedAt,
        error: data.errorMessage,
      });
    } catch (err) {
      onRecoveryFailed(err);
    }
  }, [onRecovered, onRecoveryFailed]);

  const checkActiveExecution = useCallback(async () => {
    const activeId = sessionStorage.getItem('lumi:activeExecution');
    if (activeId) {
      await reconcileExecution(activeId);
    }
  }, [reconcileExecution]);

  return { reconcileExecution, checkActiveExecution };
}
```

**Integration:** `client/src/pages/DecisionFeed.jsx`

```javascript
const { checkActiveExecution } = useExecutionRecovery({
  onRecovered: (state) => {
    if (!isTerminalStatus(state.status)) {
      dispatch({ type: 'RESTORE_EXECUTION', executionState: state });
      toast.info('Restored active execution');
    } else {
      sessionStorage.removeItem('lumi:activeExecution');
    }
  },
  onRecoveryFailed: (err) => {
    console.error('[Recovery] Failed', err);
    sessionStorage.removeItem('lumi:activeExecution');
  },
});

useEffect(() => {
  checkActiveExecution();
}, [checkActiveExecution]);
```

**Validation:**
- Start execution (PAUSE campaign)
- Refresh page mid-execution
- Verify FSM restores to API_EXECUTION state
- Verify toast: "Restored active execution"
- Wait for completion
- Verify sessionStorage cleared after success

#### Task 6: Version-Aware SSE — Stale Packet Rejection
**File:** `client/src/pages/DecisionFeed.jsx` (SSE onMessage handler)

**Before:**
```javascript
const { state: sseState } = useSSE({
  onMessage: (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'EXECUTION_STATUS') {
      updateExecutionStatus(data.status, data.error, data.timestamp);
    }
  },
});
```

**After:**
```javascript
const { state: sseState } = useSSE({
  onMessage: (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'EXECUTION_STATUS') {
      const incomingVersion = data.version ?? 0;
      const currentVersion = state.executionStatus?.version ?? 0;

      // Reject stale packets
      if (incomingVersion <= currentVersion) {
        console.warn('[SSE] Rejecting stale packet', { incomingVersion, currentVersion });
        return;
      }

      // Accept fresh packets
      updateExecutionStatus(data.status, data.error, data.timestamp, incomingVersion);
    }
  },
});
```

**Backend change:** `src/routes/execution.js` (SSE broadcast)

**Before:**
```javascript
broadcastWorkspaceEvent(workspaceId, {
  type: 'EXECUTION_STATUS',
  status: 'EXECUTED_SUCCESS',
  executionId: executionRequest.id,
});
```

**After:**
```javascript
broadcastWorkspaceEvent(workspaceId, {
  type: 'EXECUTION_STATUS',
  status: 'EXECUTED_SUCCESS',
  executionId: executionRequest.id,
  version: executionRequest.version, // ← ADD VERSION
  timestamp: new Date().toISOString(),
});
```

**Validation:**
- Mock out-of-order SSE packets in browser DevTools
- Send EXECUTED_SUCCESS (v5), then EXECUTING (v3)
- Verify frontend ignores v3 packet
- Check console: "Rejecting stale packet"

#### Task 7: ExecutionLifecycleService — Centralized Transition Layer
**File:** `src/services/executionLifecycle.js` (new)

**Purpose:** Centralize ALL status transitions through a single service to enforce:
- Version increment on every transition
- Optimistic concurrency control (WHERE version = expectedVersion)
- Telemetry tracking
- Legal transition validation
- ExecutionTransition audit log creation
- SSE broadcast

**Implementation:** See Section 4.6 for full service code.

**Migration Strategy:**
1. Create executionLifecycle.js service
2. Add IllegalTransitionError and ConcurrencyError classes
3. Import ExecutionStatus enum from Task 1
4. Replace direct `prisma.executionRequest.update()` calls in:
   - `src/routes/execution.js` (status updates)
   - `src/workers/metaExecutionWorker.js` (worker transitions)
   - `src/utils/timeoutHandler.js` (timeout detection)
5. Add isLegalTransition validation
6. Add optimistic lock (WHERE version = expectedVersion)
7. Add ExecutionTransition audit log write
8. Add SSE broadcast

**Critical Rules:**
- ❌ FORBIDDEN: Direct `prisma.executionRequest.update({ data: { status: newStatus } })`
- ✅ REQUIRED: `await executionLifecycle.transition(id, newStatus, expectedVersion, actor)`

**Validation:**
- Replace one status update with service call
- Verify version increments correctly
- Verify ExecutionTransition row created
- Test concurrency conflict (two simultaneous transitions)
- Verify ConcurrencyError thrown with 409 response
- Test illegal transition (e.g., EXECUTED_SUCCESS → PENDING)
- Verify IllegalTransitionError thrown with 400 response

#### Task 8: ExecutionTransition Audit Log — Forensic Debugging
**File:** `prisma/migrations/YYYYMMDDHHMMSS_add_execution_transition/migration.sql`

**Purpose:** Track every status transition for forensic debugging when production incidents occur.

**Schema:**
```prisma
model ExecutionTransition {
  id          String   @id @default(cuid())
  executionId String
  fromStatus  String
  toStatus    String
  version     Int      // Version AFTER transition
  actor       String   // 'worker' | 'timeout-handler' | 'user' | 'api'
  metadata    String?  // JSON-encoded context
  createdAt   DateTime @default(now())

  @@index([executionId])
  @@index([createdAt])
}
```

**Migration:**
```sql
CREATE TABLE "ExecutionTransition" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "actor" TEXT NOT NULL,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExecutionTransition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExecutionTransition_executionId_idx" ON "ExecutionTransition"("executionId");
CREATE INDEX "ExecutionTransition_createdAt_idx" ON "ExecutionTransition"("createdAt");
```

**Validation:**
- Run migration: `npx prisma migrate dev --name add_execution_transition`
- Verify table created
- Execute test action (PAUSE campaign)
- Query ExecutionTransition: verify 4 rows created (PENDING → QUEUED → EXECUTING → SUCCESS)
- Check version increments: v1, v2, v3, v4
- Verify actor field populated correctly
- Test forensic query: "Find all stuck executions"

### Phase 11B-C: Recovery + Observability (3 tasks)

#### Task 9: Timeout Reconciliation
**File:** `client/src/hooks/useDecisionFSM.js` (executeAction timeout)

**Current behavior:** Timeout fires → immediate ERROR state  
**New behavior:** Timeout fires → fetch status → reconcile → show truth

```javascript
executionTimeoutRef.current = setTimeout(async () => {
  // Before showing timeout error, check backend truth
  try {
    const { data } = await api.get(`/api/execution/${executionId}/status`);
    if (data.status === 'EXECUTED_SUCCESS') {
      // Backend completed just in time
      updateExecutionStatus('EXECUTED_SUCCESS', null, data.executedAt, data.version);
      toast.success('Action executed successfully');
      return;
    }
  } catch (err) {
    // Status fetch failed, show timeout error
  }

  dispatch({
    type: 'PROCESS_ERROR',
    message: 'Execution timeout - Meta API operation took too long',
    code: 'EXECUTION_TIMEOUT',
  });
}, 120_000);
```

#### Task 10: Active Execution Dashboard
**File:** `client/src/components/decision/ActiveExecutionBanner.jsx` (new component)

Display active executions at top of DecisionFeed:
- "Executing PAUSE on Campaign ABC123" (spinner)
- "Last updated 5s ago" (live timer)
- Click to view details (opens modal with full status)

Query backend on mount + every 10s:
```javascript
const { data } = await api.get('/api/execution/active');
// Returns: [{ id, actionType, targetId, status, createdAt, version }]
```

#### Task 11: Execution Telemetry
**File:** `src/lib/errorTelemetry.js` (extend existing)

```javascript
export function trackExecutionReconciliation({ 
  executionId, 
  trigger, // 'refresh' | 'reconnect' | 'timeout'
  beforeState, 
  afterState, 
  versionDelta 
}) {
  logger.info({
    event: 'execution_reconciliation',
    executionId,
    trigger,
    beforeState,
    afterState,
    versionDelta,
    timestamp: new Date().toISOString(),
  });
}
```

Track:
- Reconciliation events (how often frontend diverges)
- Stale packet rejections (SSE ordering issues)
- Version deltas (how far behind SSE gets)
- Timeout vs success races (backend truth wins)

### Phase 11B-D: Testing + Docs (2 tasks)

#### Task 12: Integration Tests
**File:** `src/tests/lifecycle-governance.integration.test.js` (new file)

**Test Coverage:**
1. ExecutionStatus enum exhaustiveness (all states handled)
2. ExecutionLifecycleService transitions (legal/illegal validation)
3. Optimistic concurrency control (version conflicts)
4. ExecutionTransition audit log (forensic queries)
5. Stable idempotency (same decisionId → same key)
6. Version increment on each transition
7. Stale packet rejection (lower version ignored)
8. Reconciliation on mount (active execution restored)
9. Timeout reconciliation (backend truth wins)
10. Idempotent replay (double-click → single execution)
11. SSE reconnect recovery (fresh state fetched)
12. Terminal status cleanup (sessionStorage cleared)

#### Task 13: Runbook Documentation
**File:** `docs/LIFECYCLE_GOVERNANCE_RUNBOOK.md` (new file)

**Sections:**
- Troubleshooting split-brain states
- Manual reconciliation steps (SQL queries)
- Recovery from stuck executions
- SSE disconnect diagnosis
- Version mismatch investigation

---

## 10. MIGRATION STRATEGY

### 10.1 Backward Compatibility

**Existing ExecutionRequest rows** (created before Phase 11B):
- Missing `version` field → backfill with `version = 1`
- Old idempotency keys (UUIDv4) → remain valid (no conflict)
- Terminal statuses → no reconciliation needed (historical audit log)

**Frontend during rollout:**
- New code checks for `version` field in SSE payload
- If missing (old backend), skip version check (graceful degradation)
- If present (new backend), apply version-aware logic

### 10.2 Rollout Plan

**Phase 1: Backend migration (zero-downtime)**
1. Deploy DB migration (add `version` column with default 1)
2. Deploy backend code (version increment + status endpoint)
3. Old frontend continues working (no version checks yet)

**Phase 2: Frontend rollout (gradual)**
1. Deploy frontend with version-aware SSE logic
2. Deploy reconciliation hook (checkActiveExecution on mount)
3. Deploy stable idempotency key derivation
4. Monitor telemetry for reconciliation events

**Phase 3: Validation (1 week)**
1. Track metrics: reconciliation frequency, version deltas, stale packets
2. Monitor for stuck executions (active > 5 minutes)
3. Test failure scenarios: network disconnect, server restart, timeout race

**Phase 4: Full activation**
1. Remove graceful degradation fallbacks (require version field)
2. Document new execution lifecycle in runbook
3. Update CLAUDE.md with Phase 11B patterns

### 10.3 Rollback Plan

If Phase 11B causes regressions:

**Backend rollback:**
- Revert to previous deployment (remove version increment logic)
- `version` column remains in DB (no harm, defaults to 1)
- Old idempotency keys still work (no breaking change)

**Frontend rollback:**
- Revert to `crypto.randomUUID()` keys (idempotency weaker but functional)
- Remove version checks from SSE handler (accept all packets)
- Remove reconciliation hook (no mount recovery)

**Data integrity:**
- ExecutionRequest rows remain valid (version column ignored by old code)
- No data migration needed (rollback is code-only)

---

## 11. OBSERVABILITY & MONITORING

### 11.1 Key Metrics

| Metric | Threshold | Alert |
|---|---|---|
| Reconciliation events per hour | > 10 | Warning (investigate SSE reliability) |
| Stale packet rejections per hour | > 5 | Warning (SSE ordering issues) |
| Stuck executions (active > 5 min) | > 0 | Critical (backend worker issue) |
| Version delta (SSE vs DB) | > 3 | Warning (SSE lag) |
| Timeout reconciliation success rate | < 95% | Warning (backend timeout too aggressive) |
| Idempotent replay rate | > 5% of executions | Warning (double-click UX issue) |

### 11.2 Logging

**Reconciliation event:**
```json
{
  "event": "execution_reconciliation",
  "executionId": "exec_xyz123",
  "trigger": "refresh",
  "beforeState": "EXECUTING",
  "afterState": "EXECUTED_SUCCESS",
  "versionDelta": 2,
  "timestamp": "2026-05-19T14:32:11Z"
}
```

**Stale packet rejection:**
```json
{
  "event": "sse_stale_packet_rejected",
  "executionId": "exec_xyz123",
  "incomingVersion": 3,
  "currentVersion": 5,
  "status": "EXECUTING",
  "timestamp": "2026-05-19T14:32:11Z"
}
```

### 11.3 Dashboard (Future)

**ExecutionRequest health:**
- Active executions count (by workspace)
- Average execution duration
- Success rate (last 24h)
- Timeout rate (last 24h)

**SSE health:**
- Connected clients (by workspace)
- Reconnect frequency
- Stale packet rate
- Average version delta

### 11.4 SSE Durability Limitations

**Current State: Resilient but NOT Durable**

Phase 11B provides:
- ✅ Resilient SSE (exponential backoff, reconnect, heartbeat timeout)
- ✅ Version-aware packet rejection (stale packets ignored)
- ✅ Reconciliation on reconnect (fetch fresh state)

Phase 11B does NOT provide:
- ❌ Durable event replay (no event log persistence)
- ❌ Guaranteed delivery (packets lost during downtime are not replayed)
- ❌ Event sourcing (no append-only event store)

**Why This Is Acceptable Now:**

Current scale assumptions:
- Execution duration: 2-30 seconds (typically)
- SSE downtime: < 5 seconds (exponential backoff reconnect)
- Execution completion rate: ~95% within SSE uptime window

**Impact of SSE packet loss:**
```
Scenario: SSE disconnected for 10s, execution completes during downtime

Without durability:
1. Execution completes (backend: EXECUTED_SUCCESS)
2. SSE packet sent (no subscribers - lost)
3. SSE reconnects 5s later
4. No replay mechanism - packet never arrives
5. Frontend stuck in EXECUTING state

With Phase 11B reconciliation:
1. Execution completes (backend: EXECUTED_SUCCESS)
2. SSE packet lost (expected)
3. SSE reconnects
4. Reconciliation triggered: GET /api/execution/:id/status
5. Frontend receives fresh state: EXECUTED_SUCCESS
6. FSM transitions correctly ✅

Result: Packet loss is transparent to user (reconciliation solves it)
```

**When Durability Becomes Required:**

Threshold indicators for Phase 12 (SSE Durability Layer):

| Metric | Current Acceptable | Phase 12 Trigger |
|---|---|---|
| Execution duration | < 30s | > 60s (long-running workflows) |
| SSE disconnect frequency | < 1/hour | > 5/hour (unstable network) |
| Missed status transitions | < 1% | > 5% (UX degradation) |
| Active concurrent executions | < 5 per workspace | > 20 per workspace (scale) |
| Reconciliation API load | < 10 calls/min | > 100 calls/min (polling storm) |

**Phase 12 Migration Path (Future):**

**Option A: Polling reconciliation loop** (simpler, acceptable for mid-scale)
```javascript
// Fallback when SSE fails
setInterval(async () => {
  if (!sseConnected && hasActiveExecution) {
    await reconcileExecution(activeExecutionId);
  }
}, 5000); // Poll every 5s when SSE down
```

**Option B: Event replay mechanism** (complex, needed for high scale)
```javascript
// Backend: Store SSE events in Redis with TTL
await redis.rpush(`events:workspace:${workspaceId}`, JSON.stringify(event));
await redis.expire(`events:workspace:${workspaceId}`, 300); // 5 min retention

// Frontend: On reconnect, request replay
const { data } = await api.get(`/api/events/replay?since=${lastEventId}`);
data.events.forEach(event => handleSSE(event));
```

**Decision:** Defer durability to Phase 12. Current reconciliation + resilient SSE is sufficient for controlled beta.

**Monitoring:** Track "reconciliation triggered by SSE miss" metric. If > 5%, escalate to Phase 12 planning.

---

## 12. EXECUTION AGGREGATE EVOLUTION

**Current State: Flat Execution Model**

Phase 11B ExecutionRequest schema:
```prisma
model ExecutionRequest {
  id               String   @id @default(cuid())
  version          Int      @default(1)
  workspaceId      String
  idempotencyKey   String   @unique
  actionType       String
  targetId         String
  status           String
  createdAt        DateTime @default(now())
  // ... basic execution fields only
}
```

**What's Missing (Advanced, Not a Blocker):**

### 12.1 Correlation Lineage

**Concept:** Link execution back to the orchestration that triggered it.

```prisma
model ExecutionRequest {
  // Existing fields...
  orchestrationId  String?  // ← NEW: links to orchestration that created this decision
  decisionId       String?  // ← NEW: links to decision contract
}
```

**Use case:**
- Debug: "Why did this execution fail?" → trace back to orchestration input
- Analytics: "Which orchestration patterns lead to highest success rate?"
- Compliance: Full audit trail from campaign upload → analysis → decision → execution

### 12.2 Parent Orchestration Link

**Concept:** Execution may be part of a multi-step workflow.

```prisma
model ExecutionRequest {
  // Existing fields...
  parentExecutionId String?  // ← NEW: for multi-step workflows
  childExecutions   ExecutionRequest[] @relation("ExecutionHierarchy")
}
```

**Use case:**
- Workflow: "Pause campaign → wait 5 min → verify paused → scale winning variant"
- Rollback: "Execution 3 failed → rollback executions 1 and 2"
- Dependency: "Don't start execution B until execution A succeeds"

### 12.3 Causal Chain

**Concept:** Track why this execution was triggered.

```prisma
model ExecutionRequest {
  // Existing fields...
  triggerType      String   // 'manual' | 'automated' | 'scheduled' | 'rollback'
  triggerUserId    String?  // If manual, who clicked execute?
  triggerRuleId    String?  // If automated, which rule fired?
  triggerContext   Json?    // Metadata (e.g., "ROAS dropped below 2.0")
}
```

**Use case:**
- Blame analysis: "Who paused this campaign?" → trace to user
- Rule debugging: "Why did automation kill this ad?" → trace to rule evaluation
- Context: "What was the ROAS when this was triggered?" → stored in triggerContext

### 12.4 Execution Journal

**Concept:** Append-only log of all state changes within an execution.

```prisma
model ExecutionEvent {
  id              String   @id @default(cuid())
  executionId     String
  eventType       String   // 'status_changed' | 'retry_attempted' | 'timeout_extended'
  fromStatus      String?
  toStatus        String?
  metadata        Json
  createdAt       DateTime @default(now())
  
  execution       ExecutionRequest @relation(fields: [executionId], references: [id])
  @@index([executionId, createdAt])
}
```

**Use case:**
- Debugging: "Why did this execution timeout?" → replay journal events
- SLA analysis: "How long between QUEUED and EXECUTING?" → measure from journal
- Retry forensics: "How many retries before success?" → count retry_attempted events

### 12.5 When to Implement

**Phase 11B (NOW):** Skip all advanced aggregate features. Focus on:
- Monotonic versioning (implemented)
- Optimistic concurrency control (implemented)
- Backend authority (implemented)

**Phase 12 (FUTURE):** Add correlation lineage if:
- ✅ Multi-workspace teams need blame tracking
- ✅ Compliance audit requirements expand
- ✅ Debugging complex execution failures becomes frequent

**Phase 13+ (ADVANCED):** Add full execution aggregate if:
- ✅ Multi-step workflows become common
- ✅ Automated execution rules deployed
- ✅ SLA tracking required for executions
- ✅ Event-sourcing patterns needed for replay/rollback

**Current Assessment:** Phase 11B flat model is sufficient for controlled beta. Execution aggregate evolution is **deferred to Phase 12+** based on actual operational needs.

**Design Note:** All Phase 12+ fields are nullable (non-breaking additions). Current ExecutionRequest schema is forward-compatible.

---

## 13. PRODUCTION READINESS GAPS

**Status after Phase 11B-B2 implementation:**

| Gap | Status | Blocker? | Mitigation |
|---|---|---|---|
| **Gap 1: sessionStorage authority** | ✅ RESOLVED | No | GET /api/execution/active is now authoritative |
| **Gap 2: Optimistic concurrency control** | ✅ RESOLVED | No | WHERE version = expectedVersion in all critical updates |
| **Gap 3: SSE durability** | ⚠️ KNOWN LIMITATION | No | Reconciliation + resilient SSE sufficient for beta |
| **Gap 4: Execution aggregate** | 📋 DEFERRED | No | Flat model sufficient, evolution path documented |

**Recommendation:** Proceed to Phase 11B-B2 implementation. All blocking gaps resolved. Non-blocking gaps have clear migration paths for Phase 12+.

**Beta readiness criteria:**
- [x] Backend truth always wins (implemented)
- [x] Race conditions prevented (optimistic concurrency)
- [x] Recovery survives all failure modes (backend authority)
- [x] SSE packet ordering guaranteed (version-aware)
- [ ] 1 week validation period (post-11B-B2)
- [ ] Telemetry shows < 5% reconciliation rate
- [ ] Zero stuck executions in validation period

**Production readiness criteria (future):**
- [ ] SSE durability layer (Phase 12)
- [ ] Execution aggregate (Phase 12+)
- [ ] SLA tracking (Phase 13)
- [ ] Multi-step workflows (Phase 13)

---

## 14. APPENDICES

### Appendix A: Glossary

| Term | Definition |
|---|---|
| Authoritative state | The single source of truth (ExecutionRequest table) |
| Projection | A read-only view of authoritative state (FSM, SSE) |
| Reconciliation | Fetching authoritative state to sync projections |
| Monotonic version | Integer that only increases, never decreases |
| Stale packet | SSE event with version ≤ current frontend version |
| Idempotent replay | Backend returns existing execution instead of creating duplicate |
| Terminal status | Execution reached final state (success, failed, timeout, cancelled) |
| Active execution | Execution in non-terminal state (pending, queued, executing) |
| Split-brain | Frontend and backend disagree on current state |

### Appendix B: File Change Summary

| File | Change Type | Description |
|---|---|---|
| prisma/schema.prisma | Modify | Add `version Int @default(1)` to ExecutionRequest |
| src/routes/execution.js | Modify | Add GET /:id/status endpoint, increment version on transitions, include version in SSE |
| client/src/pages/DecisionFeed.jsx | Modify | Stable idempotency key, version-aware SSE, mount recovery |
| client/src/hooks/useExecutionRecovery.ts | Create | New hook for reconciliation logic |
| client/src/hooks/useDecisionFSM.js | Modify | Add RESTORE_EXECUTION action, timeout reconciliation |
| src/tests/lifecycle-governance.integration.test.js | Create | Integration tests for Phase 11B |
| docs/LIFECYCLE_GOVERNANCE_RUNBOOK.md | Create | Operational runbook |

### Appendix C: References

- Phase 11A Audit: `docs/PHASE_11A_EXECUTION_LIFECYCLE_AUDIT.md`
- MARCOM Architecture: `MARCOM-ARCHITECTURE.md`
- FSM State Machine: `client/src/hooks/useDecisionFSM.js`
- SSE Client: `client/src/services/sseClient.ts`
- Execution Route: `src/routes/execution.js`

---

## APPROVAL CHECKLIST

Before proceeding to Phase 11B-B2 (implementation):

**Core Specification:**

- [ ] Execution authority rules validated (Backend Truth Always Wins)
- [ ] State ownership matrix reviewed (clear authority for each component)
- [ ] Canonical lifecycle transitions approved (legal state machine)
- [ ] Versioning strategy confirmed (monotonic integer, not timestamps)
- [ ] Reconciliation rules validated (truth winner for each scenario)
- [ ] Recovery UX approved (silent recovery + toast, not modal)
- [ ] Idempotency contract validated (stable key derivation formula)
- [ ] Active execution policy approved (one per decision, not per workspace)
- [ ] Implementation roadmap sequenced (11B-B2 → 11B-C → 11B-D)
- [ ] Migration strategy validated (backward compatible, zero-downtime)
- [ ] Observability metrics defined (thresholds, alerts, logging)
- [ ] Team alignment confirmed (no event-sourcing, no replay buffer)

**Final Architectural Recommendations (3 new components):**

- [ ] **ExecutionStatus enum:** Type-safe status values (prevents typos, enables exhaustiveness checking)
- [ ] **ExecutionLifecycleService:** Centralized transition layer (enforces version increment, telemetry, audit logging)
- [ ] **ExecutionTransition audit log:** Forensic debugging table (tracks all status transitions with actor + metadata)
- [ ] Implementation roadmap updated (8 tasks total: 3 foundation + 5 original)
- [ ] Integration tests expanded (12 test cases covering new components)

**Critical Gaps Addressed:**

- [ ] **Gap 1 resolved:** GET /api/execution/active is authoritative (sessionStorage is optimization only)
- [ ] **Gap 2 resolved:** Optimistic concurrency control specified (WHERE version = expectedVersion)
- [ ] **Gap 3 documented:** SSE durability limitations acknowledged (Phase 12 migration path defined)
- [ ] **Gap 4 documented:** Execution aggregate evolution path defined (deferred to Phase 12+)

**Production Readiness:**

- [ ] All blocking gaps resolved (Gap 1 & 2)
- [ ] Non-blocking gaps have clear mitigation (Gap 3 & 4)
- [ ] Beta readiness criteria defined
- [ ] Production readiness criteria defined

**Status:** AWAITING APPROVAL

**Next Phase:** 11B-B2 (Implementation) — blocked until this spec is approved

---

**Document Version:** 1.1 (Final Recommendations Incorporated)  
**Last Updated:** 2026-05-19 (3 architectural components added)  
**Owner:** Architecture Team  
**Reviewers:** Backend Lead, Frontend Lead, SRE Lead

**Changelog:**
- **v1.0 (2026-05-19):** Initial specification with 4 critical gaps addressed
- **v1.1 (2026-05-19):** Added 3 final architectural recommendations:
  - Section 3.5: ExecutionStatus enum
  - Section 4.6: ExecutionLifecycleService
  - Section 4.7: ExecutionTransition audit log
  - Implementation roadmap expanded from 5 to 8 tasks (Task 1-8)
  - Phase 11B-C tasks renumbered to Task 9-11
  - Phase 11B-D tasks renumbered to Task 12-13
  - Integration test coverage expanded to 12 test cases
