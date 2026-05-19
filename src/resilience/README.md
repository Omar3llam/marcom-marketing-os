# Resilience Layer (Phase 11B)

**Purpose**: Prevent cascading failures and enable graceful degradation when AI services degrade.

---

## Architecture

### Circuit Breaker Pattern

```
CLOSED (normal) → (failures >= threshold) → OPEN (fast-fail)
                                              ↓
                                        (timeout expires)
                                              ↓
                                          HALF_OPEN (testing)
                                          ↙         ↘
                                   (success)      (failure)
                                      ↓              ↓
                                   CLOSED         OPEN
```

**States**:
- **CLOSED**: Normal operation, all calls pass through
- **OPEN**: Service degraded, all calls fail fast (no external call)
- **HALF_OPEN**: Testing recovery, limited calls pass through

---

## Components

### 1. Generic Circuit Breaker (`circuitBreaker.js`)

Reusable circuit breaker implementation.

**Configuration**:
```javascript
const breaker = new CircuitBreaker({
  name: 'my-service',
  failureThreshold: 5,      // Consecutive failures before opening
  successThreshold: 2,      // Successes in HALF_OPEN to close
  timeout: 60_000,          // Ms before HALF_OPEN attempt
  volumeThreshold: 10,      // Minimum calls before evaluating
  onStateChange: (state, metrics) => {
    // Telemetry callback
  },
});
```

**Usage**:
```javascript
const result = await breaker.execute(async () => {
  return await callExternalService();
});

if (!result.success) {
  if (result.circuitState === 'OPEN') {
    // Circuit open → use fallback
  } else {
    // Execution failed → rethrow
    throw result.error;
  }
}
```

**Metrics**:
```javascript
const metrics = breaker.getMetrics();
// {
//   state: 'OPEN',
//   failureCount: 15,
//   successCount: 120,
//   consecutiveFailures: 5,
//   totalCalls: 135,
//   downtime: 45000, // ms
// }
```

---

### 2. Orchestrator Circuit (`orchestratorCircuit.js`)

Circuit breaker wrapper for dual-agent orchestrator (Claude + GPT).

**Configuration**:
- Opens after **3 consecutive failures**
- Half-open test after **60s**
- Requires **2 successes** in half-open to close
- Minimum **5 calls** before evaluating

**Integration**:
```javascript
import { executeOrchestration } from './resilience/orchestratorCircuit.js';

const result = await executeOrchestration({
  campaignId: 'camp_123',
  workspaceId: 'wks_456',
  actionId: 'act_789',
  userId: 'usr_001',
});

// If circuit open, result contains fallback:
// {
//   degraded: true,
//   degradationReason: 'CIRCUIT_BREAKER_OPEN',
//   strategicAnalysis: { verdict: 'HOLD', ... }
// }
```

**Graceful Degradation**:

When circuit opens, orchestrator returns:
```json
{
  "degraded": true,
  "degradationReason": "CIRCUIT_BREAKER_OPEN",
  "strategicAnalysis": {
    "verdict": "HOLD",
    "rootCause": "CIRCUIT_OPEN",
    "diagnosis": "AI analysis temporarily unavailable due to service degradation. Manual review recommended.",
    "confidence": 0,
    "riskLevel": "Unknown",
    "actionPlan": {
      "action": "Manual review required - AI orchestrator unavailable"
    }
  },
  "creativeAssets": null
}
```

**Health Check**:
```javascript
import { getOrchestratorHealth } from './resilience/orchestratorCircuit.js';

const health = getOrchestratorHealth();
// {
//   status: 'degraded',
//   state: 'OPEN',
//   failureCount: 15,
//   consecutiveFailures: 5,
//   uptime: 45000,
//   lastFailure: 1705847293000
// }
```

---

## Integration Points

### Routes

**Lumi Intelligence** (`src/routes/lumi/intelligence.js`):
- `POST /api/lumi/orchestrate/:campaignId` — Uses circuit breaker wrapper

**Lumi Health** (`src/routes/lumi/health.js`):
- `GET /api/lumi/_health` — Exposes circuit state and metrics

### Telemetry (Phase 10D)

Circuit state changes emit telemetry events:
```javascript
{
  type: 'CIRCUIT_BREAKER_OPEN',
  service: 'orchestrator',
  endpoint: '/api/lumi/analyze',
  failureCount: 5,
  threshold: 3,
  openDuration: 60000
}
```

### Frontend Integration (Phase 11A)

FSM guards check circuit state:
```typescript
// client/src/fsm/decisionMachine.ts
always: [
  {
    guard: 'isCircuitOpen',
    target: 'degraded',
    actions: 'trackDegraded',
  },
]
```

---

## Monitoring

### Health Endpoint

```bash
curl http://localhost:8080/api/lumi/_health
```

Response:
```json
{
  "ok": true,
  "orchestrator": {
    "status": "healthy",
    "state": "CLOSED",
    "failureCount": 2,
    "successCount": 150,
    "consecutiveFailures": 0,
    "lastFailure": null
  }
}
```

### Logs

Circuit state changes are logged:
```
[OrchestratorCircuit] Circuit OPEN — AI orchestration degraded
[OrchestratorCircuit] Circuit HALF_OPEN — testing recovery
[OrchestratorCircuit] Circuit CLOSED — orchestrator recovered
```

---

## Manual Control (Testing/Maintenance)

```javascript
import {
  forceOpenCircuit,
  forceCloseCircuit,
  resetCircuit,
} from './resilience/orchestratorCircuit.js';

// Force circuit open (simulate degradation)
forceOpenCircuit();

// Force circuit closed (manual recovery)
forceCloseCircuit();

// Reset metrics (clear history)
resetCircuit();
```

---

## Failure Scenarios

### 1. Anthropic API Down

**Trigger**: Claude API returns 503 for 3+ consecutive requests  
**Response**: Circuit opens → orchestrator returns fallback verdict `HOLD`  
**Recovery**: After 60s, circuit tests recovery (HALF_OPEN) → 2 successes → CLOSED

### 2. OpenAI Rate Limit

**Trigger**: GPT API returns 429  
**Response**: Creative generation fails (best-effort), but strategic analysis succeeds  
**Impact**: Circuit stays CLOSED (only Claude calls tracked)

### 3. Network Timeout

**Trigger**: Orchestrator call times out (60s axios timeout)  
**Response**: Counted as failure → contributes to circuit opening  
**Recovery**: Same as scenario 1

### 4. Thundering Herd (Backend Restart)

**Trigger**: Backend restarts → all in-flight orchestrations fail  
**Response**: Circuit opens → prevents 1000s of concurrent retries  
**Impact**: First 5 calls fail → circuit opens → remaining calls fast-fail

---

## Testing

### Unit Tests

```bash
cd src/resilience
node --test circuitBreaker.test.js
```

### Integration Tests

```javascript
// Test circuit opens after threshold
for (let i = 0; i < 5; i++) {
  const result = await executeOrchestration({ campaignId: 'test' });
  // Simulate failure
}
const health = getOrchestratorHealth();
assert.equal(health.state, 'OPEN');

// Test graceful degradation
const result = await executeOrchestration({ campaignId: 'test' });
assert.equal(result.degraded, true);
assert.equal(result.strategicAnalysis.verdict, 'HOLD');
```

---

## Future Enhancements

1. **Per-workspace circuit breakers** — Isolate failures by tenant
2. **Adaptive thresholds** — Adjust based on historical error rates
3. **SSE notifications** — Push circuit state changes to connected clients
4. **Circuit dashboard** — Real-time visualization of circuit states
5. **Bulkhead pattern** — Resource isolation (e.g., separate thread pools)

---

## References

- [Phase 11 State Audit](../../docs/PHASE_11_STATE_AUDIT.md)
- [Martin Fowler: Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Netflix Hystrix](https://github.com/Netflix/Hystrix/wiki)
