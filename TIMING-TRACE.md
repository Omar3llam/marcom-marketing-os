# Campaign Analysis Performance Timing Trace

## Purpose
This document tracks the timing logs added to validate that batch analysis is parallel (not sequential) and that the feed refresh flow works end-to-end.

## Timing Log Points

### 1. Upload Service (`src/services/campaignUploadService.js`)

**Line ~141:** Analysis start
```javascript
logger.info({ campaignCount: campaignsForAnalysis.length }, '[campaigns/upload] Starting batch analysis');
```

**Line ~148:** Analysis complete
```javascript
logger.info({
  campaignCount: campaignsForAnalysis.length,
  durationMs: analysisMs,
  avgMsPerCampaign: Math.round(analysisMs / campaignsForAnalysis.length)
}, '[campaigns/upload] Batch analysis complete');
```

**Line ~188:** Persistence start
```javascript
logger.info({ recordCount: campaignsToSave.length }, '[campaigns/upload] Starting DB persistence');
```

**Line ~253:** Persistence complete
```javascript
logger.info({
  recordCount: processed,
  actionsCount: alertsCreated,
  durationMs: persistMs
}, '[campaigns/upload] DB persistence complete');
```

### 2. Orchestrator (`src/agents/orchestrator.js`)

**Line ~401:** Batch function entry
```javascript
logger.info({ campaignCount: campaigns.length }, '[orchestrator] analyzeCampaignsBatch started');
```

**Line ~438:** API call complete
```javascript
logger.info({
  campaignCount: campaigns.length,
  apiDurationMs: apiCallMs,
  avgMsPerCampaign: Math.round(apiCallMs / campaigns.length)
}, '[orchestrator] Claude API call complete');
```

**Line ~470:** Batch function success
```javascript
logger.info({ campaignCount: campaigns.length, decisionsCount: parsed.decisions.length }, '[orchestrator] analyzeCampaignsBatch: success');
```

## Expected Performance Profile

### Batch Analysis (13 campaigns)
- **Expected:** Single API call, ~3-4s total
- **NOT:** 13 sequential calls × 1.5s = ~20s
- **Verification:** `avgMsPerCampaign` should be ~250-300ms (not 1500ms)

### Database Persistence
- **Expected:** Transaction with Promise.allSettled, <500ms
- **Verification:** `durationMs` for persistence should be sub-second

## How to Read Logs

Upload a CSV with 13 campaigns and watch for:

```bash
# Expected log sequence:
[campaigns/upload] Starting batch analysis { campaignCount: 13 }
[orchestrator] analyzeCampaignsBatch started { campaignCount: 13 }
[orchestrator] Claude API call complete { campaignCount: 13, apiDurationMs: 3200, avgMsPerCampaign: 246 }
[orchestrator] analyzeCampaignsBatch: success { campaignCount: 13, decisionsCount: 13 }
[campaigns/upload] Batch analysis complete { campaignCount: 13, durationMs: 3250, avgMsPerCampaign: 250 }
[campaigns/upload] Starting DB persistence { recordCount: 13 }
[campaigns/upload] DB persistence complete { recordCount: 13, actionsCount: 13, durationMs: 420 }
```

**Red flags:**
- `avgMsPerCampaign > 1000` → sequential calls happening
- `durationMs > 10000` → API timeout or performance issue
- Missing logs → function not being called

## Frontend Refresh Flow

After upload completes:
1. `CsvUploader.jsx:127` calls `refresh()`
2. `useIntelligenceData.js:41` fetches `/api/lumi/feed`
3. Feed endpoint queries `campaignState` with `workspaceId`
4. UI updates with new campaigns

Verify in browser DevTools Network tab:
- `/api/campaigns/upload/analyze` → 200 OK
- `/api/lumi/feed` → 200 OK (triggered immediately after)
- New campaigns appear in table without page refresh
