# Type Layer — Usage Guide

**Phase B: Type Layer**  
**Generated:** 2026-05-18  
**Based on:** [BACKEND-CONTRACTS.md](../../../BACKEND-CONTRACTS.md)

---

## Overview

This directory contains **frozen TypeScript types** that mirror backend API contracts.

**CRITICAL:**  
- These types are the **source of truth** for frontend TypeScript code.
- They are **frozen** — do NOT modify without updating BACKEND-CONTRACTS.md first.
- Any mismatch between types and backend contracts is a **contract violation**.

---

## Files

| File | Purpose |
|------|---------|
| [`api.ts`](./api.ts) | All API request/response types (campaigns, lumi, execution, projects, credentials, history, memory, rollback) |
| [`auth.ts`](./auth.ts) | Firebase auth and workspace types |
| [`errors.ts`](./errors.ts) | Error classification and handling types |
| [`fsm.ts`](./fsm.ts) | 8-state FSM types (view states, actions) |
| [`sse.ts`](./sse.ts) | Server-Sent Events types (real-time execution updates) |
| [`index.ts`](./index.ts) | Barrel export (central import point) |

---

## Usage

### Import from barrel (recommended)

```typescript
import type { LumiFeedResponse, FSMState, APIError } from '@/types';

// Use in component
const [feed, setFeed] = useState<LumiFeedResponse | null>(null);
const [error, setError] = useState<APIError | null>(null);
```

### Import from specific file

```typescript
import type { LumiFeedResponse } from '@/types/api';
import type { FSMState } from '@/types/fsm';
```

---

## Examples

### API Call with Type Safety

```typescript
import { api } from '@/lib/api';
import type { LumiFeedResponse, APIError } from '@/types';

async function fetchFeed() {
  try {
    const response = await api.get<LumiFeedResponse>('/api/lumi/feed');
    return response.data;
  } catch (err: any) {
    const error: APIError = err.response?.data || { error: err.message };
    if (error.classification === 'auth') {
      // Handle auth error
    }
    throw error;
  }
}
```

### FSM Reducer with Types

```typescript
import type { FSMState, FSMAction } from '@/types';

function fsmReducer(state: FSMState, action: FSMAction): FSMState {
  switch (action.type) {
    case 'START_FLOW':
      return { ...state, view: 'INPUT_VALIDATION', activeMode: action.mode };
    
    case 'PROCESS_SUCCESS':
      return { ...state, view: 'SUCCESS', outputData: action.data };
    
    case 'PROCESS_ERROR':
      return {
        ...state,
        view: 'ERROR',
        errorDetails: {
          message: action.message,
          code: action.code,
          classification: action.classification as any,
          retryable: action.retryable,
          fallbackAction: action.fallbackAction,
        },
      };
    
    default:
      return state;
  }
}
```

### Error Handling with Classification

```typescript
import type { APIError, ErrorClassification } from '@/types';

function handleError(error: APIError) {
  const { classification, retryable, fallbackAction } = error;

  switch (classification) {
    case 'auth':
      // Force-refresh Firebase token
      return { action: 'refresh_token', message: error.error };
    
    case 'network':
      // Show retry button if retryable
      return { action: retryable ? 'retry' : 'fallback', message: error.error };
    
    case 'platform':
      // Check permissions
      return { action: 'check_permissions', message: error.error, hint: error.hint };
    
    case 'validation':
      // Show validation error + fallback
      return { action: fallbackAction, message: error.error };
    
    default:
      return { action: 'unknown', message: error.error };
  }
}
```

### SSE Connection with Types

```typescript
import type { SSEEvent, SSEConnectionState, SSETokenResponse } from '@/types';
import { api } from '@/lib/api';

async function connectSSE() {
  // Step 1: Get stream token
  const { data } = await api.post<SSETokenResponse>('/api/events/token');
  const { streamToken } = data;

  // Step 2: Connect EventSource
  const eventSource = new EventSource(`/api/events/stream?token=${streamToken}`);

  eventSource.onmessage = (event) => {
    const sseEvent: SSEEvent = JSON.parse(event.data);
    
    if (sseEvent.type === 'EXECUTION_STATUS') {
      console.log('Status:', sseEvent.status, 'for', sseEvent.actionType);
      
      if (sseEvent.status === 'EXECUTED_SUCCESS') {
        // Action succeeded
      } else if (sseEvent.status === 'EXECUTED_FAILED') {
        console.error('Execution failed:', sseEvent.error);
      }
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    // Reconnect with exponential backoff
  };
}
```

---

## Type Guards

Use type guards to narrow union types:

```typescript
import type { CredentialStatusResponse } from '@/types';

function isConnected(
  status: CredentialStatusResponse
): status is CredentialStatusConnected {
  return status.connected === true;
}

// Usage
const status = await getCredentialStatus();
if (isConnected(status)) {
  console.log('Account ID:', status.accountId); // TypeScript knows accountId is string
  console.log('Expires:', status.expiresAt);
} else {
  console.log('Not connected'); // TypeScript knows accountId is null
}
```

---

## Contract Violation Detection

If you see a type error that doesn't make sense, check for contract violations:

```typescript
// ❌ Type error: Property 'decisions' does not exist on type 'UploadCSVResponse'
const response = await api.post<UploadCSVResponse>('/api/campaigns/upload-csv', formData);
console.log(response.data.decisions); // Error!

// ✅ Correct: Backend returns { success, mode, decisions, errors, stats }
const response = await api.post<UploadCSVResponse>('/api/campaigns/upload-csv?mode=analyze', formData);
console.log(response.data.decisions); // OK
```

**Diagnosis:**  
- Check query params: `?mode=analyze` is required
- Check request headers: `Authorization: Bearer <token>` is required
- Check BACKEND-CONTRACTS.md for exact endpoint signature

---

## Testing with Types

```typescript
import type { LumiFeedResponse, Campaign } from '@/types';

// Mock data for tests
const mockFeed: LumiFeedResponse = {
  workspaceId: 'test-workspace',
  generatedAt: new Date().toISOString(),
  campaigns: [
    {
      campaign_id: 'Test Campaign',
      stage: 'DYING',
      alerts: [
        {
          action_id: 'test-action',
          idempotency_key: 'test-key',
          priority: 'HIGH',
          analysis: {
            verdict: 'PAUSE_AND_RELAUNCH',
            root_cause: 'Creative fatigue',
          },
          historical_insight: null,
          action_plan: {
            action: 'Pause ad set',
            status: 'PENDING',
            imageUrl: null,
            reference_prompt: null,
          },
          metrics: [],
          memory: [],
          creative_assets: null,
        },
      ],
    },
  ],
};

// TypeScript validates the shape at compile time
```

---

## Migration from Untyped Code

### Before (untyped)

```typescript
const fetchFeed = async () => {
  const response = await api.get('/api/lumi/feed');
  return response.data;
};
```

### After (typed)

```typescript
import type { LumiFeedResponse } from '@/types';

const fetchFeed = async (): Promise<LumiFeedResponse> => {
  const response = await api.get<LumiFeedResponse>('/api/lumi/feed');
  return response.data;
};
```

**Benefits:**  
- Autocomplete for `response.data.campaigns[0].stage`
- Compile-time error if you access `response.data.invalid_field`
- Self-documenting code (no need to read backend code to know shape)

---

## Rules

1. **NEVER modify types without updating BACKEND-CONTRACTS.md first**
2. **ALWAYS use types from this directory (not inline types)**
3. **ALWAYS use barrel import (`@/types`) for cleaner imports**
4. **ALWAYS handle error classifications (auth, network, platform, validation)**
5. **ALWAYS implement retry logic for `retryable: true` errors**
6. **NEVER use `any` when a type exists in this directory**

---

## Freezing Protocol

If the backend changes a contract:

1. Update BACKEND-CONTRACTS.md first
2. Update corresponding type in this directory
3. Update integration tests (see `tests/fixtures/`)
4. Update any components using the changed type
5. Commit with message: `fix(types): update <type> to match backend contract`

---

## Help & Support

**Questions?**  
- Read [BACKEND-CONTRACTS.md](../../../BACKEND-CONTRACTS.md) first
- Check [MIGRATION.md](../../../MIGRATION.md) for migration patterns
- Ask in #eng-frontend Slack

**Bug in types?**  
- Check if backend contract changed
- File issue: `[TYPES] <description>`
- Prefix commit: `fix(types): <description>`

---

**End of Type Layer Guide v1.0**
