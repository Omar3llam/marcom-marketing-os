# MARCOM v4.1 — Backend Contracts (FROZEN)
**Phase 1: Backend Contracts Freeze**  
**Generated:** 2026-05-18  
**Purpose:** Frozen API contracts for UI v2 reconstruction

> **CRITICAL:** This is the source of truth for all frontend rebuild work.  
> Backend changes MUST update this document BEFORE shipping.  
> Frontend MUST NOT assume any API behavior not documented here.

---

## Table of Contents

1. [Authentication Flow](#authentication-flow)
2. [API Routes](#api-routes)
3. [FSM States](#fsm-states)
4. [Error Contracts](#error-contracts)
5. [Loading States](#loading-states)
6. [Real-Time Events (SSE)](#real-time-events-sse)

---

## Authentication Flow

### Firebase ID Token Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ Client (React)                                              │
├─────────────────────────────────────────────────────────────┤
│ 1. auth.currentUser.getIdToken()  → cached if <60min       │
│ 2. axios request interceptor      → attaches Bearer token  │
│ 3. Backend verifies via Firebase Admin SDK                 │
│ 4. req.user, req.userId, req.workspaceId populated         │
│ 5. 401 → retry once with getIdToken(true) force-refresh    │
└─────────────────────────────────────────────────────────────┘
```

### Request Headers

```http
Authorization: Bearer <firebase-id-token>
```

### Auth Middleware Chain

```javascript
// server.js
app.use(firebaseAuthMiddleware);  // Global — populates req.user
app.use('/api/lumi', requireAuth); // Route-specific — rejects if !req.user
```

### Auth Response (401)

```json
{
  "error": "Unauthenticated"
}
```

### User Auto-Provisioning

When a Firebase user signs in for the first time:
1. `firebaseAuthMiddleware` detects no Prisma `User` row
2. Creates `Workspace` + `User` atomically
3. Sets `context: null` (not onboarded yet)
4. Frontend redirects to `/onboarding`

---

## API Routes

### 1. Campaigns (`/api/campaigns`)

#### POST `/api/campaigns/upload-csv?mode=analyze`

**Purpose:** Stateless AI analysis of CSV campaigns  
**Auth:** `requireAuth`  
**Body:** `multipart/form-data` with field `campaignData` (CSV file, ≤10MB)

**Request:**
```http
POST /api/campaigns/upload-csv?mode=analyze
Content-Type: multipart/form-data
Authorization: Bearer <token>

------WebKitFormBoundary
Content-Disposition: form-data; name="campaignData"; filename="meta_export.csv"
Content-Type: text/csv

Campaign name,Ad set name,Amount spent (EGP),Impressions,Results,...
Summer Sale,Broad Lookalike,12500,45000,320,...
```

**Response (200):**
```json
{
  "success": true,
  "mode": "analyze",
  "decisions": [
    {
      "campaignId": "summer-sale-broad-lookalike",
      "campaignName": "Summer Sale",
      "adsetName": "Broad Lookalike",
      "verdict": "PAUSE_AND_RELAUNCH",
      "rootCause": "Creative fatigue + audience saturation",
      "confidence": "HIGH",
      "actionPlan": {
        "primaryAction": "Pause Broad Lookalike ad set",
        "reasoning": "CPA tripled, ROAS below break-even",
        "steps": ["Pause ad set", "Refresh creative", "Re-launch with 1-3% LAL"]
      },
      "signals": [
        { "metric": "CTR", "value": 0.42, "threshold": 1.5, "status": "CRITICAL" },
        { "metric": "ROAS", "value": 0.71, "threshold": 2.0, "status": "CRITICAL" },
        { "metric": "Frequency", "value": 8.6, "threshold": 3.0, "status": "WARNING" }
      ],
      "sourceMetrics": {
        "spend": 12500,
        "impressions": 45000,
        "results": 320,
        "ctr": 0.42,
        "cpc": 39.06,
        "roas": 0.71,
        "frequency": 8.6,
        "reach": 5232,
        "costPerResult": 39.06
      }
    }
  ],
  "errors": [],
  "stats": {
    "uploaded": 15,
    "analyzed": 14,
    "failed": 1
  }
}
```

**Error (400):**
```json
{
  "success": false,
  "error": "CSV has 25 rows. Maximum for analysis mode is 20.",
  "hint": "Split your export into smaller date ranges."
}
```

---

#### POST `/api/campaigns/fetch-meta?mode=analyze`

**Purpose:** Fetch live Meta campaigns + AI analysis  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "projectId": "proj_abc123",
  "datePreset": "last_7d"
}
```

**Response (200):** Same shape as `/upload-csv?mode=analyze`

**Error (404 — No credential):**
```json
{
  "status": "error",
  "message": "No Meta Ads credential found for this project. Connect Meta first."
}
```

**Error (401 — Token expired):**
```json
{
  "status": "error",
  "message": "Meta access token expired. Please reconnect Meta Ads."
}
```

---

#### GET `/api/campaigns/me/context`

**Purpose:** Check if user is onboarded (has context)  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "context": {
    "brandName": "Acme Corp",
    "industry": "E-commerce",
    "objectives": ["ROAS > 3x", "Scale winners"]
  }
}
```

**Response (200 — Not onboarded):**
```json
{
  "context": null
}
```

---

#### PUT `/api/campaigns/me/context`

**Purpose:** Save onboarding context (creates User + Workspace if needed)  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "context": {
    "brandName": "Acme Corp",
    "industry": "E-commerce",
    "objectives": ["ROAS > 3x", "Scale winners"]
  },
  "email": "user@example.com",
  "workspaceName": "Acme Marketing"
}
```

**Response (200 — Created):**
```json
{
  "ok": true,
  "user": {
    "id": "user-uuid",
    "workspaceId": "workspace-uuid",
    "context": { ... }
  },
  "created": true
}
```

**Response (200 — Updated):**
```json
{
  "ok": true,
  "user": {
    "id": "user-uuid",
    "workspaceId": "workspace-uuid",
    "context": { ... }
  },
  "created": false
}
```

---

### 2. Lumi Feed (`/api/lumi`)

#### GET `/api/lumi/feed`

**Purpose:** Fetch workspace-scoped campaign feed with pending actions  
**Auth:** `requireAuth` (JWT)  
**Response (200):**
```json
{
  "workspaceId": "workspace-uuid",
  "generatedAt": "2026-05-18T12:34:56Z",
  "campaigns": [
    {
      "campaign_id": "Summer Promo — Broad Lookalike",
      "stage": "DYING",
      "alerts": [
        {
          "action_id": "action-uuid",
          "idempotency_key": "meta:campaign-id:timestamp:uuid",
          "priority": "HIGH",
          "analysis": {
            "verdict": "PAUSE_AND_RELAUNCH",
            "root_cause": "Creative fatigue + audience saturation"
          },
          "historical_insight": "Last 2 budget-scale actions regressed within 24h",
          "action_plan": {
            "action": "Pause Broad Lookalike ad set immediately",
            "status": "PENDING",
            "imageUrl": null,
            "reference_prompt": "UGC-style 9:16, natural lighting, product mid-frame"
          },
          "metrics": [
            {
              "metric": "CTR",
              "trend": "down",
              "value": "0.42%",
              "delta": "-58% vs last week",
              "context": "Last 48h",
              "status": "danger"
            },
            {
              "metric": "ROAS",
              "trend": "down",
              "value": "0.71x",
              "delta": "-1.4x vs target",
              "context": "7-day avg",
              "status": "danger"
            }
          ],
          "memory": [
            {
              "actionType": "meta.scale_budget",
              "decisionRationale": "Doubled budget after 3 days >3x ROAS",
              "isSustainable": false,
              "impactDurationHrs": 24
            }
          ],
          "creative_assets": null
        }
      ]
    }
  ]
}
```

**Error (401):**
```json
{
  "error": "Unauthenticated"
}
```

---

#### GET `/api/lumi/demo-feed`

**Purpose:** Public demo feed for stakeholders (no auth)  
**Auth:** None (public)  
**Response (200):** Same shape as `/api/lumi/feed`

---

### 3. Execution (`/api/execute`)

#### POST `/api/execute/meta`

**Purpose:** Execute Meta API action with 4-layer guardrails  
**Auth:** `requireAuth` + `contextGuard`  
**Body:**
```json
{
  "actionType": "PAUSE_CAMPAIGN",
  "targetId": "123456789",
  "targetType": "campaign",
  "idempotencyKey": "uuid-v4",
  "options": {
    "amount": 5000
  }
}
```

**Response (200 — Success):**
```json
{
  "success": true,
  "idempotentReplay": false,
  "executionId": "exec-uuid",
  "auditLogId": "audit-uuid",
  "status": "EXECUTED_SUCCESS",
  "data": {
    "meta_response": { ... }
  },
  "message": "PAUSE_CAMPAIGN executed successfully on Meta"
}
```

**Response (200 — Idempotent replay):**
```json
{
  "success": true,
  "idempotentReplay": true,
  "executionId": "exec-uuid",
  "status": "EXECUTED_SUCCESS",
  "data": { ... }
}
```

**Error (400 — Validation):**
```json
{
  "success": false,
  "error": "Invalid action type: INVALID_ACTION. Must be one of: PAUSE_CAMPAIGN, RESUME_CAMPAIGN, ...",
  "code": "VALIDATION_ERROR"
}
```

**Error (400 — Execution failed):**
```json
{
  "success": false,
  "idempotentReplay": false,
  "executionId": "exec-uuid",
  "auditLogId": "audit-uuid",
  "status": "FAILED",
  "error": "Meta API error: Insufficient permissions",
  "code": "META_API_ERROR",
  "message": "PAUSE_CAMPAIGN failed: Insufficient permissions"
}
```

---

#### GET `/api/execute/audit`

**Purpose:** Retrieve execution audit trail  
**Auth:** `requireAuth`  
**Query Params:**
- `limit` (default: 50)
- `offset` (default: 0)
- `status` (optional: 'SUCCESS' | 'FAILED' | 'PENDING')
- `actionType` (optional filter)

**Response (200):**
```json
{
  "logs": [
    {
      "id": "audit-uuid",
      "workspaceId": "workspace-uuid",
      "userId": "firebase-uid",
      "actionType": "PAUSE_CAMPAIGN",
      "targetId": "123456789",
      "platform": "META",
      "status": "SUCCESS",
      "payload": { ... },
      "response": { ... },
      "errorMessage": null,
      "performedAt": "2026-05-18T12:00:00Z"
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

---

### 4. Projects (`/api/projects`)

#### GET `/api/projects/list`

**Purpose:** List user's projects (auto-migrates from legacy UserContext)  
**Auth:** `requireAuth`  
**Response (200):**
```json
[
  {
    "projectId": "proj_abc123",
    "name": "Acme Marketing",
    "updatedAt": "2026-05-18T10:00:00Z"
  }
]
```

---

#### GET `/api/projects/mine`

**Purpose:** Get active project (creates blank if none exists)  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "projectId": "proj_abc123",
  "name": "My Workspace",
  "source": "existing"
}
```

**Possible `source` values:**
- `"existing"` — returned most-recently-updated project
- `"migrated"` — auto-migrated from legacy UserContext
- `"created"` — created blank project

---

#### POST `/api/projects/create`

**Purpose:** Create new project  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "projectId": "proj_unique_id",
  "name": "New Campaign",
  "context": "E-commerce brand targeting ROAS > 3x"
}
```

**Response (201):**
```json
{
  "ok": true,
  "projectId": "proj_unique_id"
}
```

**Error (409 — Duplicate):**
```json
{
  "error": "Project ID already exists. Please try again."
}
```

---

#### PATCH `/api/projects/:projectId`

**Purpose:** Update project name/context  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "name": "Updated Name",
  "context": "Updated context"
}
```

**Response (200):**
```json
{
  "ok": true
}
```

---

#### DELETE `/api/projects/:projectId`

**Purpose:** Delete project (cannot delete last project)  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "ok": true
}
```

**Error (400 — Last project):**
```json
{
  "error": "Cannot delete your only project. Create another first."
}
```

---

### 5. Credentials (`/api/credentials`)

#### GET `/api/credentials/status?projectId=&platform=meta_ads`

**Purpose:** Check if credential exists (lightweight)  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "status": "ok",
  "connected": true,
  "platform": "meta_ads",
  "accountId": "act_123456789",
  "expiresAt": "2026-06-18T12:00:00Z"
}
```

**Response (200 — Not connected):**
```json
{
  "status": "ok",
  "connected": false,
  "platform": "meta_ads",
  "accountId": null,
  "expiresAt": null
}
```

---

#### POST `/api/credentials`

**Purpose:** Save/update OAuth credential  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "project_id": "proj_abc123",
  "platform": "meta_ads",
  "access_token": "encrypted-by-backend",
  "refresh_token": "encrypted-by-backend",
  "account_id": "act_123456789",
  "scopes": ["ads_read", "ads_management"],
  "expires_at": "2026-06-18T12:00:00Z"
}
```

**Response (200):**
```json
{
  "status": "ok",
  "credential": {
    "id": "cred-uuid",
    "platform": "meta_ads",
    "accountId": "act_123456789",
    "scopes": ["ads_read", "ads_management"],
    "expiresAt": "2026-06-18T12:00:00Z",
    "createdAt": "2026-05-18T12:00:00Z"
  }
}
```

**Note:** `accessToken` and `refreshToken` are NEVER returned in responses.

---

#### DELETE `/api/credentials/:projectId/:platform`

**Purpose:** Delete credential  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "status": "ok"
}
```

---

### 6. History (`/api/history`)

#### GET `/api/history/list?projectId=proj_abc123`

**Purpose:** List chat sessions (metadata only, no messages)  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "sessions": [
    {
      "sessionId": "session-uuid",
      "title": "Summer Campaign Analysis",
      "updatedAt": "2026-05-18T10:00:00Z",
      "projectId": "proj_abc123"
    }
  ]
}
```

---

#### GET `/api/history/:sessionId`

**Purpose:** Load full session with messages  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "sessionId": "session-uuid",
  "title": "Summer Campaign Analysis",
  "messages": [
    {
      "role": "user",
      "content": "Analyze this campaign",
      "timestamp": "2026-05-18T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "Campaign shows creative fatigue...",
      "timestamp": "2026-05-18T10:00:30Z"
    }
  ],
  "projectId": "proj_abc123",
  "updatedAt": "2026-05-18T10:00:30Z"
}
```

---

#### POST `/api/history/save`

**Purpose:** Upsert chat session  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "sessionId": "session-uuid",
  "title": "Summer Campaign Analysis",
  "messages": [ ... ],
  "projectId": "proj_abc123"
}
```

**Response (200):**
```json
{
  "ok": true,
  "sessionId": "session-uuid",
  "title": "Summer Campaign Analysis",
  "updatedAt": "2026-05-18T10:00:30Z"
}
```

---

#### DELETE `/api/history/:sessionId`

**Purpose:** Delete session  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "ok": true
}
```

---

### 7. Memory (`/api/memory`)

#### POST `/api/memory/record`

**Purpose:** Record decision outcome (CMO learning system)  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "campaignId": "summer-sale-broad-lookalike",
  "actionType": "meta.scale_budget",
  "decisionRationale": "Doubled budget after 3 days >3x ROAS",
  "resultStatus": "FAILED",
  "deltaCtr": -0.5,
  "deltaRoas": -1.2
}
```

**Response (201):**
```json
{
  "success": true,
  "id": "memory-uuid"
}
```

---

#### GET `/api/memory/patterns`

**Purpose:** Retrieve semantic patterns ("what worked before")  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "patterns": [
    {
      "action": "meta.scale_budget",
      "count": 12,
      "avgDeltaRoas": -0.85,
      "sustainableRate": 25
    },
    {
      "action": "meta.refresh_creative",
      "count": 8,
      "avgDeltaRoas": 1.2,
      "sustainableRate": 75
    }
  ],
  "narratives": [
    {
      "id": "memory-uuid",
      "line": "meta.scale_budget on summer-sale — Doubled budget after 3 days >3x ROAS",
      "roas": -1.2,
      "recorded": "2026-05-17T12:00:00Z"
    }
  ],
  "total": 50
}
```

---

### 8. User (`/api/user`)

#### GET `/api/user/workspace`

**Purpose:** Fetch user's workspace metadata  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "workspace": {
    "id": "workspace-uuid",
    "name": "Acme Marketing",
    "ownerId": "firebase-uid",
    "createdAt": "2026-01-01T00:00:00Z"
  },
  "hasWorkspace": true
}
```

**Response (200 — No workspace):**
```json
{
  "workspace": null,
  "hasWorkspace": false
}
```

---

#### PATCH `/api/user/profile`

**Purpose:** Update Firebase display name  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "displayName": "John Doe"
}
```

**Response (200):**
```json
{
  "success": true,
  "displayName": "John Doe"
}
```

---

#### PATCH `/api/user/workspace`

**Purpose:** Update workspace name  
**Auth:** `requireAuth`  
**Body:**
```json
{
  "workspaceName": "Acme Growth Team"
}
```

**Response (200):**
```json
{
  "success": true,
  "workspaceName": "Acme Growth Team"
}
```

---

#### DELETE `/api/user/account`

**Purpose:** Permanently delete account + workspace + all data  
**Auth:** `requireAuth`  
**Response (200):**
```json
{
  "success": true
}
```

**Architecture:**
1. Delete Workspace (CASCADE deletes: Users, Actions, CampaignStates, DecisionMemory, Integrations, AuditLogs)
2. Delete Firebase Auth user
3. Client signs out + clears localStorage

---

### 9. Rollback (`/api/lumi/rollback`)

#### POST `/api/lumi/rollback/:actionId`

**Purpose:** Rollback executed action (24h window)  
**Auth:** `requireAuth` (JWT)  
**Response (200):**
```json
{
  "ok": true,
  "rolledBackAction": "original-action-uuid",
  "inverseActionId": "inverse-action-uuid",
  "enqueued": true
}
```

**Error (409 — Not rollbackable):**
```json
{
  "error": "NotRollbackable",
  "reason": "status is PENDING; only EXECUTED_SUCCESS can be rolled back"
}
```

**Error (410 — Window expired):**
```json
{
  "error": "RollbackWindowExpired",
  "reason": "executed 36h ago; window is 24h"
}
```

---

## FSM States

### 8-State Decision FSM

```
COMMAND_CENTER (idle)
      ↓
INPUT_VALIDATION (user uploads CSV / connects Meta)
      ↓
THEATER (locked — AI analysis in progress)
      ↓
SUCCESS (decision ready, awaiting confirmation)
      ↓
CONFIRM_EXECUTION (user confirms action)
      ↓
API_EXECUTION (locked — Meta API call in progress)
      ↓
EXECUTED_SUCCESS / EXECUTED_FAILED
      ↓
MEMORY_COMMIT (persist to DecisionMemory)
      ↓
COMMAND_CENTER (reset)
```

### State Schema

```typescript
type FSMView =
  | 'COMMAND_CENTER'
  | 'INPUT_VALIDATION'
  | 'THEATER'
  | 'SUCCESS'
  | 'CONFIRM_EXECUTION'
  | 'API_EXECUTION'
  | 'EXECUTION_QUEUED'
  | 'EXECUTING'
  | 'EXECUTED_SUCCESS'
  | 'EXECUTED_FAILED'
  | 'MEMORY_COMMIT'
  | 'ERROR';

interface FSMState {
  view: FSMView;
  activeMode: 'csv' | 'meta' | null;
  inputData: any;
  outputData: any;
  errorDetails: {
    message: string;
    code: string;
    classification: 'auth' | 'network' | 'platform' | 'validation';
    retryable: boolean;
    fallbackAction: string;
  } | null;
  isProcessing: boolean;
  isLocked: boolean;
  theatreStep: number;
  history: Array<any>;
  radarAlerts: Array<any>;
  executionStatus: {
    status: 'QUEUED' | 'EXECUTING' | 'SUCCESS' | 'FAILED';
    error?: string;
    timestamp: string;
  } | null;
}
```

### FSM Actions

```typescript
type FSMAction =
  | { type: 'START_FLOW'; mode: 'csv' | 'meta' }
  | { type: 'REVIEW_ALERT'; alertData: any }
  | { type: 'SUBMIT_INPUT'; inputData: any }
  | { type: 'THEATRE_ADVANCE'; step: number }
  | { type: 'PROCESS_SUCCESS'; data: any }
  | { type: 'PROCESS_ERROR'; message: string; code: string; classification: string; retryable: boolean; fallbackAction: string }
  | { type: 'CONFIRM_EXECUTION' }
  | { type: 'EXECUTE_ACTION' }
  | { type: 'EXECUTION_STATUS_UPDATE'; status: string; error?: string; timestamp: string }
  | { type: 'EXECUTION_COMPLETE' }
  | { type: 'COMMIT_TO_MEMORY' }
  | { type: 'RESET_FLOW' }
  | { type: 'REPLAY_DECISION'; data: any }
  | { type: 'LOAD_HISTORY'; history: Array<any> }
  | { type: 'LOAD_RADAR_ALERTS'; alerts: Array<any> }
  | { type: 'CLEAR_HISTORY' };
```

---

## Error Contracts

### Standard Error Shape

All API errors follow this shape:

```typescript
interface APIError {
  error: string;           // Human-readable error message
  code?: string;           // Machine-readable error code
  hint?: string;           // Optional hint for resolution
  classification?: 'auth' | 'network' | 'platform' | 'validation';
  retryable?: boolean;     // Can the request be retried?
  fallbackAction?: string; // Suggested fallback for user
}
```

### Common Error Codes

| Code | HTTP Status | Meaning | Retryable? |
|------|-------------|---------|------------|
| `UNAUTHENTICATED` | 401 | Firebase token missing/invalid | Yes (refresh token) |
| `VALIDATION_ERROR` | 400 | Request body validation failed | No |
| `META_API_ERROR` | 400 | Meta API rejected request | Maybe (check permissions) |
| `CREDENTIAL_NOT_FOUND` | 404 | No OAuth credential for project | No (reconnect Meta) |
| `TOKEN_EXPIRED` | 401 | Meta OAuth token expired | Yes (refresh or reconnect) |
| `ROLLBACK_WINDOW_EXPIRED` | 410 | Action >24h old, cannot rollback | No |
| `INTERNAL_ERROR` | 500 | Server error | Yes (retry) |

### Error Classification

```typescript
type ErrorClassification =
  | 'auth'       // Firebase/OAuth token issues → refresh or reconnect
  | 'network'    // Timeout, connection refused → retry
  | 'platform'   // Meta API rejected request → check permissions
  | 'validation' // Bad request body → fix input and retry
  | 'parsing';   // CSV parse failure → check format
```

---

## Loading States

### Per-Request States

Every API call follows this lifecycle:

```typescript
type RequestState =
  | 'idle'      // No request in flight
  | 'loading'   // Request sent, awaiting response
  | 'success'   // Response received (2xx)
  | 'error'     // Response received (4xx/5xx) or network error
  | 'stale';    // Success but data may be outdated (polling use case)
```

### Retry Logic

```typescript
// Exponential backoff for retryable errors
const retryDelays = [1000, 2000, 4000]; // ms

// Auth-specific: axios interceptor retries 401 once with force-refresh
// After that, fail and show "Session expired" modal
```

### Loading UI Patterns

| State | UI Treatment |
|-------|--------------|
| `idle` | Show empty state or skeleton |
| `loading` | Show spinner + disable interactions |
| `success` | Render data + enable interactions |
| `error (retryable)` | Show error banner + "Retry" button |
| `error (not retryable)` | Show error modal + fallback action |
| `stale` | Show data + "Refresh" indicator |

---

## Real-Time Events (SSE)

### Connection Flow

```
1. POST /api/events/token (Authorization: Bearer <firebase-jwt>)
   → { streamToken: "uuid", expiresIn: 60 }

2. GET /api/events/stream?token=<uuid>
   → Upgrades to SSE stream
   → Receives events: data: {...}\n\n
```

### Event Types

```typescript
type SSEEvent =
  | { type: 'CONNECTED'; timestamp: string }
  | { type: 'EXECUTION_STATUS'; status: 'QUEUED' | 'EXECUTING' | 'EXECUTED_SUCCESS' | 'EXECUTED_FAILED'; targetId: string; actionType: string; auditLogId?: string; error?: string; timestamp: string };
```

### Event Stream Example

```
data: {"type":"CONNECTED","timestamp":"2026-05-18T12:00:00Z"}

data: {"type":"EXECUTION_STATUS","status":"QUEUED","targetId":"123456789","actionType":"PAUSE_CAMPAIGN","timestamp":"2026-05-18T12:00:05Z"}

data: {"type":"EXECUTION_STATUS","status":"EXECUTING","targetId":"123456789","actionType":"PAUSE_CAMPAIGN","timestamp":"2026-05-18T12:00:06Z"}

data: {"type":"EXECUTION_STATUS","status":"EXECUTED_SUCCESS","targetId":"123456789","actionType":"PAUSE_CAMPAIGN","auditLogId":"audit-uuid","timestamp":"2026-05-18T12:00:08Z"}

: heartbeat
```

### Heartbeat

Server sends `: heartbeat\n\n` every 30s to prevent idle timeout.

### Reconnection

- Stream token is single-use (deleted on first connect)
- Client must call `POST /api/events/token` again to get new token
- Recommended: reconnect on `close` event with exponential backoff

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-18 | Initial freeze (Phase 1) | Claude Code |

---

## Notes for UI Rebuild

### DO

✅ Trust this document as the source of truth  
✅ Write integration tests against these contracts  
✅ Use TypeScript types derived from these schemas  
✅ Handle all error classifications gracefully  
✅ Implement retry logic for retryable errors  
✅ Use FSM states for UI state management  
✅ Connect to SSE for live execution updates

### DON'T

❌ Assume any API behavior not documented here  
❌ Hardcode error messages (use `error.message` from response)  
❌ Skip loading states (users need feedback)  
❌ Ignore `retryable` flag (UX depends on it)  
❌ Poll for status updates (use SSE instead)  
❌ Build UI-first without state graph (FSM is mandatory)

---

**End of Backend Contracts v1.0**
