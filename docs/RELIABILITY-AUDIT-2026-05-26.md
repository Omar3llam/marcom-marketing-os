# Campaign Analysis Pipeline — Reliability Audit
**Date**: 2026-05-26  
**Scope**: Phase A — End-to-End Pipeline Trace + Failure Point Identification  
**Auditor**: Claude Code (Sonnet 4.5)  
**Status**: 🔴 CRITICAL ISSUES FOUND

---

## Executive Summary

The campaign analysis pipeline is **architecturally sound but operationally fragile**. The core flow works, but lacks operational guarantees that prevent silent partial success — the most dangerous failure mode in production systems.

**Critical Finding**: A CSV upload can report "success" while silently dropping data, creating orphaned state, or leaving the dashboard inconsistent. This erodes user trust and makes debugging impossible.

**Risk Category**: PRODUCTION STABILITY  
**Impact**: HIGH — silent data loss, inconsistent UI state, duplicate actions, workspace isolation violations  
**Urgency**: HIGH — affects every CSV upload and dashboard load

---

## Pipeline Architecture

### Mode 1: Analyze (AI-powered)
```
CSV Upload (multipart/form-data)
  ↓
Multer Parse + Validation
  ↓
parseMetaAdsCsv() → campaigns[]
  ↓
Promise.allSettled(analyzeCampaignData()) → decisions[]
  ↓
Promise.allSettled(campaignState.upsert()) → CampaignState rows
  ↓
action.createMany() → Action rows
  ↓
Response: { success: true, decisions, stats, errors }
```

### Mode 2: DB Write (default)
```
CSV Upload (multipart/form-data)
  ↓
Multer Parse + Validation
  ↓
parseMetaAdsCsv() → campaigns[]
  ↓
Promise.allSettled(campaignState.upsert()) → CampaignState rows
  ↓
action.createMany() → Action rows
  ↓
Response: { uploaded, processed, alerts_created }
```

### Dashboard Feed
```
GET /api/lumi/feed
  ↓
3 Parallel Queries (NO TRANSACTION):
  - campaignState.findMany()
  - action.findMany()
  - decisionMemory.findMany()
  ↓
Transform + Group by Campaign
  ↓
Response: { campaigns[], workspaceId, generatedAt }
```

---

## Critical Issues (Severity: 🔴 HIGH)

### 1. Silent Partial Success in Analyze Mode
**File**: `src/routes/campaigns/upload.js:162-175`  
**Severity**: 🔴 CRITICAL  
**Impact**: Data loss + misleading UI

**The Bug**:
- AI analysis runs in `Promise.allSettled()` (line 63-77) — correct
- DB persistence runs in `Promise.allSettled()` (line 99-109) — correct
- **BUT**: Response always returns `success: true` even if:
  - AI analysis failed for 50% of campaigns
  - DB upserts failed for 30% of campaigns
  - Action creation failed entirely

**Why This Is Dangerous**:
```javascript
// Line 162-175
return res.json({
  success: true,  // ❌ Always true, even if persistence failed
  mode: 'analyze',
  decisions,      // ✅ Contains AI results
  errors,         // ⚠️  Contains AI failures, but NOT DB failures
  stats: {
    analyzed: decisions.length,    // ✅ Correct
    persisted: processed,           // ⚠️  May be < analyzed
    alerts_created: alertsCreated,  // ⚠️  May be 0 if batch insert failed
  },
});
```

**Frontend Impact** (`CsvUploader.jsx:81-92`):
```javascript
if (mode === 'analyze') {
  const analyzed = res.data.stats?.analyzed || res.data.decisions?.length || 0;
  toast.success(
    `Analyzed ${analyzed} campaign${analyzed === 1 ? '' : 's'} · ${res.data.decisions?.length || 0} decision${res.data.decisions?.length === 1 ? '' : 's'} generated`,
    { description: 'AI analysis complete — rendering intelligence layer' },
  );
}
```
User sees "Analyzed 10 campaigns" but only 6 were persisted. Dashboard shows 6. User is confused.

**Reproduction**:
1. Upload CSV with 10 campaigns
2. AI analysis succeeds for all 10 → `decisions.length = 10`
3. DB upsert fails for 4 campaigns (transient DB error)
4. Response: `{ success: true, stats: { analyzed: 10, persisted: 6 } }`
5. Toast shows "Analyzed 10 campaigns"
6. Dashboard shows 6 campaigns
7. User: "Where are my other 4 campaigns?"

---

### 2. Transaction Boundary Violations
**File**: `src/routes/campaigns/upload.js:99-151`  
**Severity**: 🔴 CRITICAL  
**Impact**: Orphaned state, duplicate actions, inconsistent DB

**The Bug**:
```javascript
// Line 99-109: Upsert campaigns (NO TRANSACTION)
const upsertResults = await Promise.allSettled(
  campaignsToSave.map(({ campaign: c, decision }) => {
    return prisma.campaignState.upsert({ ... });
  }),
);

// Line 112-146: Build action data from upserts

// Line 149-151: Batch insert actions (SEPARATE QUERY, NO TRANSACTION)
if (actionData.length > 0) {
  await prisma.action.createMany({ data: actionData });
}
```

**What Can Go Wrong**:
1. `campaignState.upsert()` succeeds for 10 campaigns
2. `action.createMany()` fails (DB timeout, constraint violation)
3. **Result**: 10 orphaned `CampaignState` rows with NO actions
4. Dashboard shows 0 campaigns (because feed filters `campaigns.filter(c => c.alerts.length > 0)` on line 224)
5. User sees empty dashboard despite successful CSV parsing

**Why This Happens**:
- No `prisma.$transaction()` wrapping the upsert + createMany
- If ANY operation fails, state is inconsistent
- No rollback mechanism

**Correct Pattern**:
```javascript
await prisma.$transaction(async (tx) => {
  const campaigns = await Promise.all(
    campaignsToSave.map(c => tx.campaignState.upsert({ ... }))
  );
  await tx.action.createMany({ data: actionData });
});
```

---

### 3. Workspace Isolation Violation
**File**: `src/routes/campaigns/upload.js:103-106`  
**Severity**: 🔴 CRITICAL  
**Impact**: Data corruption, cross-workspace leakage

**The Bug**:
```javascript
// Line 103-106
return prisma.campaignState.upsert({
  where:  { campaignId: c.campaignId },  // ❌ NO WORKSPACE IN WHERE CLAUSE
  update: { stage, healthScore, lastAnalysis: new Date() },
  create: { campaignId: c.campaignId, workspaceId, stage, healthScore, lastAnalysis: new Date() },
});
```

**Why This Is Dangerous**:
- Prisma schema: `@@unique([campaignId, workspaceId])` (composite key)
- But `where` clause only checks `campaignId`
- **Result**: If Workspace A and Workspace B upload CSVs with the same campaign ID (e.g., `meta__summer_promo`), they **OVERWRITE each other's data**

**Reproduction**:
1. Workspace A uploads CSV → creates `CampaignState { campaignId: "meta__summer_promo", workspaceId: "ws-a", stage: "SCALING" }`
2. Workspace B uploads CSV with same campaign → upsert finds existing row by `campaignId` alone
3. **Prisma UPDATE query hits Workspace A's row** instead of creating a new one
4. Workspace A's data is corrupted

**Root Cause**:
- Upsert `where` clause must match the `@@unique` constraint
- Current: `where: { campaignId }`
- Correct: `where: { campaignId_workspaceId: { campaignId, workspaceId } }`

**Impact**: CRITICAL — this is a data corruption bug that violates multi-tenancy guarantees.

---

### 4. Non-Idempotent Action Creation
**File**: `src/routes/campaigns/upload.js:119`  
**Severity**: 🔴 HIGH  
**Impact**: Duplicate actions on retry, dashboard pollution

**The Bug**:
```javascript
// Line 119
idempotencyKey: `meta:${cs.campaignId}:${Date.now()}:${randomUUID().slice(0, 8)}`,
```

**Why This Fails Idempotency**:
- `Date.now()` changes every millisecond
- `randomUUID()` changes every call
- **Result**: If user clicks "Upload" twice (network timeout, impatient click), same campaign gets 2+ Action rows

**Reproduction**:
1. User uploads CSV
2. Network is slow → user clicks "Upload" again
3. First request completes → creates Action with `idempotencyKey: "meta:campaign1:1716700000000:abc123"`
4. Second request completes → creates Action with `idempotencyKey: "meta:campaign1:1716700001000:def456"`
5. Dashboard shows 2 duplicate alerts for same campaign

**Correct Pattern**:
```javascript
// Deterministic key based on campaign + date range + workspace
idempotencyKey: `meta:${cs.campaignId}:${workspaceId}:${csvUploadDate}`,
```

---

### 5. Feed Consistency Race Condition
**File**: `src/routes/lumi/feed.js:141-156`  
**Severity**: 🔴 MEDIUM  
**Impact**: Stale dashboard data, user confusion

**The Bug**:
```javascript
// Line 141-156 — NO TRANSACTION ISOLATION
const [campaignStates, pendingActions, recentMemory] = await Promise.all([
  prisma.campaignState.findMany({ where: { workspaceId: wsId } }),
  prisma.action.findMany({ where: { workspaceId: wsId, status: { in: ['PENDING', 'QUEUED'] } } }),
  prisma.decisionMemory.findMany({ where: { workspaceId: wsId } }),
]);
```

**What Can Go Wrong**:
1. User uploads CSV → starts writing to DB
2. Dashboard calls `/api/lumi/feed` DURING the upload
3. First query fetches `campaignStates` (returns 5 old campaigns)
4. **CSV upload completes** → creates 3 new campaigns + 3 new actions
5. Second query fetches `pendingActions` (returns 3 NEW actions)
6. **Result**: Feed shows 3 actions with NO corresponding campaigns

**Why This Happens**:
- Three separate queries → no snapshot isolation
- If DB writes happen between queries, you get partial state
- No `READ UNCOMMITTED` or `SERIALIZABLE` isolation level

**Frontend Impact** (`IntelligenceContext.jsx:50-65`):
```javascript
const refresh = useCallback(async (signal) => {
  const [feedData, memData] = await Promise.all([
    fetchCampaigns(signal),  // ← Can race with ongoing upload
    fetchMemory(signal),
  ]);
});
```

**Correct Pattern**:
```javascript
const feed = await prisma.$transaction(async (tx) => {
  const campaignStates = await tx.campaignState.findMany({ ... });
  const pendingActions = await tx.action.findMany({ ... });
  const recentMemory = await tx.decisionMemory.findMany({ ... });
  return { campaignStates, pendingActions, recentMemory };
}, { isolationLevel: 'ReadCommitted' });
```

---

## High-Priority Issues (Severity: 🟠 MEDIUM)

### 6. Metrics Extraction Can Fail Silently
**File**: `src/routes/lumi/feed.js:259-287`  
**Severity**: 🟠 MEDIUM  
**Impact**: Dashboard shows $0 spend, empty metrics

**The Bug**:
```javascript
// Line 281-284 — Extracts dashboard stats from Action.payload.metrics
rows.push({ metric: 'Spend', value: fmtUsd(m.spend), ... });
rows.push({ metric: 'Impressions', value: fmtNum(m.impressions), ... });
```

If `Action.payload.metrics` is malformed or missing:
- `m.spend` → `undefined` → `fmtUsd(undefined)` → `"$0.00"`
- Dashboard summary shows `$0` total spend despite real campaigns existing

**Why This Happens**:
- No validation that required metrics exist before creating Action
- Parser can return campaigns with `spend: 0` if CSV headers are malformed
- `signalsFromMetrics()` blindly formats `undefined` as `$0`

**Fix**: Add validation before Action creation:
```javascript
if (!c.spend || c.spend === 0) {
  errors.push({ campaign: c.campaignName, error: 'Missing or zero spend — may indicate CSV format mismatch' });
  continue; // Skip this campaign
}
```

---

### 7. Parser Returns Empty Without Clear Error
**File**: `src/services/metaAdsParser.js:46-52`  
**Severity**: 🟠 LOW  
**Impact**: User confusion, poor error messages

**The Bug**:
```javascript
// Line 46-52
if (!records || records.length === 0) {
  return {
    campaigns: [],
    errors:    ['CSV is empty or could not be parsed'],  // ← Generic
    stats:     { total_rows: 0, skipped: 0, valid: 0 },
  };
}
```

**Issue**: Parser can also return `{ campaigns: [], errors: null }` if:
- CSV has rows but all are skipped (line 84-91: empty Campaign name)
- No explicit error logged

**User sees**: "No valid campaigns found in CSV" (upload.js:59)  
**User needs**: "All rows were skipped — check that 'Campaign name' column is populated"

---

## Medium-Priority Issues (Severity: 🟡 LOW)

### 8. No Retry Mechanism for Transient Failures
**File**: `src/routes/campaigns/upload.js:63-91`  
**Severity**: 🟡 LOW  
**Impact**: User must re-upload entire CSV if 1 campaign fails

**The Issue**:
- `Promise.allSettled()` captures failures correctly
- But no retry for transient errors (AI rate limit, DB timeout)
- User must re-upload entire CSV

**Enhancement**: Add dead-letter queue for failed campaigns
```javascript
if (result.status === 'rejected') {
  await prisma.failedCampaign.create({
    data: { workspaceId, campaignId: parsed[idx].campaignId, error: result.reason.message, retryCount: 0 }
  });
}
```

---

### 9. Dashboard Name Fallback Can Miss Data
**File**: `src/routes/lumi/feed.js:178`  
**Severity**: 🟡 LOW  
**Impact**: Dashboard shows campaign IDs instead of names

**The Bug**:
```javascript
// Line 178
ensure({ ...cs, campaignName: pendingActions.find(a => a.campaignId === cs.campaignId)?.payload?.campaignName });
```

If `CampaignState` exists but Action doesn't (orphaned state), feed shows:
- `campaign_id: "meta__summer_promo__broad_lookalike"` (ugly slug)
- Instead of: `campaign_id: "Summer Promo — Broad Lookalike"` (human name)

**Fix**: Store `campaignName` directly in `CampaignState` schema

---

## Verification Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Workspace isolation enforced in `where` clauses | ❌ FAIL | Issue #3 — composite key violation |
| Transaction boundaries wrap related writes | ❌ FAIL | Issue #2 — no `$transaction()` |
| Idempotency keys are deterministic | ❌ FAIL | Issue #4 — `Date.now()` + `randomUUID()` |
| Feed queries use snapshot isolation | ❌ FAIL | Issue #5 — parallel queries race |
| Success responses only return when data is persisted | ❌ FAIL | Issue #1 — `success: true` on partial failure |
| Metrics validation before Action creation | ❌ FAIL | Issue #6 — no spend validation |
| Error messages are actionable | ⚠️  PARTIAL | Issue #7 — generic parser errors |
| Retry mechanism for transient failures | ❌ MISSING | Issue #8 — no dead-letter queue |

---

## Hardening Recommendations (Phase B)

### Immediate (Ship-Blocking)
1. **Fix workspace isolation** — change `where: { campaignId }` to `where: { campaignId_workspaceId: { campaignId, workspaceId } }`
2. **Add transaction wrapper** — wrap upsert + createMany in `prisma.$transaction()`
3. **Fix idempotency keys** — remove `Date.now()` and `randomUUID()`, use deterministic keys
4. **Add metrics validation** — reject campaigns with `spend: 0` or missing required fields

### High Priority (Next Sprint)
5. **Add feed snapshot isolation** — wrap feed queries in transaction with `isolationLevel: 'ReadCommitted'`
6. **Fix success response semantics** — return `success: false` if any persistence fails
7. **Add dead-letter queue** — persist failed campaigns for manual retry
8. **Store campaignName in CampaignState** — avoid Action.payload lookups

### Medium Priority (Tech Debt)
9. **Better parser error messages** — distinguish "empty CSV" from "all rows skipped"
10. **Add ingestion telemetry** — track parse time, AI latency, DB write latency
11. **Add upload status tracking** — show per-campaign success/failure in UI

---

## Operational Visibility Gaps (Phase C)

### Missing Observability
- No per-campaign upload status (user sees "10 uploaded" but not which 4 failed)
- No ingestion metrics (can't measure AI latency, DB write latency)
- No failed row diagnostics (errors array is opaque)
- No processing telemetry (can't debug slow uploads)

### Recommended Additions
1. **Upload summary endpoint**: `GET /api/campaigns/upload-status/:uploadId` returns per-campaign status
2. **Ingestion metrics**: Emit `emitExecutionMetric()` for parse time, AI time, DB time
3. **Failed row table**: `FailedCampaign` model with retry count, error message, raw CSV row
4. **Dashboard diagnostics**: Show "10 campaigns uploaded, 8 succeeded, 2 failed (view details)"

---

## Risk Summary

| Risk | Likelihood | Impact | Severity |
|------|-----------|--------|----------|
| Silent data loss on partial failure | HIGH | HIGH | 🔴 CRITICAL |
| Workspace isolation violation | MEDIUM | CRITICAL | 🔴 CRITICAL |
| Duplicate actions on retry | HIGH | MEDIUM | 🔴 HIGH |
| Transaction boundary failure orphans state | MEDIUM | HIGH | 🔴 HIGH |
| Feed race condition shows stale data | MEDIUM | MEDIUM | 🟠 MEDIUM |
| Missing metrics break dashboard | LOW | MEDIUM | 🟠 MEDIUM |

---

## Conclusion

The campaign analysis pipeline is **architecturally sound but lacks operational guarantees**. The issues are **fixable with targeted hardening** — no rebuild required.

**Most Dangerous Pattern**: "Silent partial success" — the system looks successful externally while internal state is incomplete.

**Recommended Next Step**: Phase B hardening pass targeting Issues #1-4 (ship-blocking severity). Estimated scope: 3-4 files, < 200 lines changed.
