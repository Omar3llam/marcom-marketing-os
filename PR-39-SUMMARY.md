# PR #39 — Active Provider Routing with A/B Testing

**Status:** ✅ Complete  
**Date:** 2026-05-25  
**Branch:** feat/pr26-executor-ai-integration  
**Builds on:** PR #38 (Provider Performance Scoring)

---

## Overview

Activates intelligent provider routing by actually switching to analytics-recommended providers when they outperform the static registry. Includes A/B testing infrastructure (10% control group) to measure the impact of routing decisions and ensure safe rollout.

This transforms provider routing from **observation-only** (PR #38) to **active optimization** with controlled experimentation.

## Problem Solved

**Before PR #39:**
- ❌ Routing was observation-only — analytics logged recommendations but didn't act on them
- ❌ No way to measure impact of intelligent routing vs static assignments
- ❌ Couldn't prove that analytics-driven routing improves outcomes
- ❌ No safe rollout mechanism for provider switching

**After PR #39:**
- ✅ Automatically route to best-performing provider (when active routing enabled)
- ✅ A/B test with 10% control group for impact measurement
- ✅ Deterministic bucketing ensures consistent user experience
- ✅ Graceful fallback when analytics provider doesn't support capability
- ✅ Feature flags for safe, gradual rollout

---

## Architecture

### Components

**1. Provider-Capability Method Lookup** (`providerRegistry.js`)
- New `PROVIDER_METHOD_MAP` — maps (provider, capability) → method
- `getMethodForProvider(provider, capability)` — lookup method for any provider
- Enables switching to analytics-recommended provider even when different from static registry
- Returns `null` when provider doesn't support capability (triggers fallback)

**2. A/B Testing Utility** (`intelligentRouter.js`)
- `isInControlGroup(identifier, controlPercentage)` — deterministic bucketing
- Uses SHA-256 hash of identifier (requestId or workspaceId) for consistency
- Default 10% control group (configurable via `AB_TEST_CONTROL_PERCENTAGE`)
- Ensures same identifier always gets same group assignment

**3. Active Routing Logic** (`intelligentRouter.js`)
- **Step 1:** If intelligent routing disabled → static registry
- **Step 2:** Query analytics for best-performing provider
- **Step 3:** If analytics agrees with static → use static (no change)
- **Step 4:** If analytics differs:
  - **Control group (10%):** Use static registry for comparison baseline
  - **Treatment group (90%):** Switch to analytics-recommended provider
- **Step 5:** If analytics provider doesn't support capability → fallback to static

**4. Routing Decision Metadata**
- `strategy`: `'performance-based-active'` | `'ab-test-control'` | `'static'` | etc.
- `abTestGroup`: `'control'` | `'treatment'` (when applicable)
- `staticProvider`: Original static registry provider (for comparison)
- `analyticsRecommendation`: Provider suggested by analytics
- `performanceData`: Approval rate, risk score, confidence from PR #38

---

## Feature Flags

Three new environment variables control behavior:

```bash
# PR #38 flag — enables querying analytics
ENABLE_INTELLIGENT_ROUTING=false

# PR #39 flag — enables active provider switching
ENABLE_ACTIVE_ROUTING=false

# A/B test control group percentage (0-100)
AB_TEST_CONTROL_PERCENTAGE=10
```

**Rollout Strategy:**
1. **Phase 1 (PR #38):** `ENABLE_INTELLIGENT_ROUTING=true`, `ENABLE_ACTIVE_ROUTING=false`  
   → Observation mode — log analytics recommendations without acting
2. **Phase 2 (PR #39):** `ENABLE_ACTIVE_ROUTING=true` for one workspace  
   → Pilot active routing with A/B test on single workspace
3. **Phase 3:** Roll out to all workspaces after validating metrics
4. **Phase 4:** Adjust `AB_TEST_CONTROL_PERCENTAGE` based on confidence

---

## Examples

### Example 1: Control Group (Static Registry)

```javascript
const result = await routeCapability('GENERATE_CAPTIONS', {
  workspaceId: 'ws-123',
  requestId: 'req-abc',  // Hashes to control group
  enableIntelligentRouting: true,
  enableActiveRouting: true,
});

// Result:
{
  provider: 'OPENAI',  // Static registry provider
  method: openaiProvider.generateCaptions,
  routingDecision: {
    strategy: 'ab-test-control',
    abTestGroup: 'control',
    analyticsRecommendation: 'CLAUDE',  // Analytics suggested Claude
    performanceData: {
      provider: 'CLAUDE',
      approvalRate: 92,
      riskScore: 0.2,
      total: 30,
      confidence: 0.98,
    },
  },
}
```

### Example 2: Treatment Group (Analytics Provider)

```javascript
const result = await routeCapability('GENERATE_CAPTIONS', {
  workspaceId: 'ws-123',
  requestId: 'req-xyz',  // Hashes to treatment group
  enableIntelligentRouting: true,
  enableActiveRouting: true,
});

// Result:
{
  provider: 'CLAUDE',  // Analytics-recommended provider
  method: claudeProvider.generateCaptions,
  routingDecision: {
    strategy: 'performance-based-active',
    abTestGroup: 'treatment',
    staticProvider: 'OPENAI',  // Would have used OpenAI (static)
    performanceData: {
      provider: 'CLAUDE',
      approvalRate: 92,
      riskScore: 0.2,
      total: 30,
      confidence: 0.98,
    },
  },
}
```

### Example 3: Fallback (Unsupported Capability)

```javascript
const result = await routeCapability('GENERATE_VIDEO_PROMPT', {
  enableIntelligentRouting: true,
  enableActiveRouting: true,
});

// Analytics suggests Claude, but Claude doesn't support video prompts
// Result:
{
  provider: 'HIGGSFIELD',  // Fallback to static registry
  method: higgsfieldProvider.generateVideoPrompt,
  routingDecision: {
    strategy: 'static',
    fallback: true,
    reason: 'Analytics recommended CLAUDE but it doesn't support GENERATE_VIDEO_PROMPT',
    analyticsRecommendation: 'CLAUDE',
  },
}
```

---

## Testing

### New Tests (18 added)

**Active Routing Tests:**
- ✅ Use static provider when active routing disabled (observation mode)
- ✅ Route to analytics provider when enabled (treatment group)
- ✅ Use static provider for control group in A/B test
- ✅ Fallback to static when analytics provider doesn't support capability
- ✅ Use workspaceId for A/B bucketing when requestId not provided

**A/B Testing Utility Tests:**
- ✅ Deterministic bucketing (same identifier → same group)
- ✅ Different identifiers → different results
- ✅ Respect control percentage boundaries (0% = never, 100% = always)
- ✅ Statistical distribution matches control percentage (10% ±3%)

**Updated Tests:**
- ✅ getRoutingStats includes new flags (activeRoutingEnabled, abTestControlPercentage)
- ✅ Environment variable detection for all three flags

**Test Results:**
- **Total:** 93/93 tests passing
- **New:** 18 tests for PR #39
- **Files:** 6 test files in ai-gateway
- **Duration:** ~13s

---

## Files Changed

```
.env.example                                    +6 lines
src/services/ai-gateway/providerRegistry.js     +61 lines
src/services/ai-gateway/intelligentRouter.js    +153 lines (refactored)
src/services/ai-gateway/intelligentRouter.test.js +139 lines
```

**Key Changes:**
- `providerRegistry.js`: Added `PROVIDER_METHOD_MAP` and `getMethodForProvider()`
- `intelligentRouter.js`: Added `isInControlGroup()` and active routing logic
- `intelligentRouter.test.js`: Added 18 new tests for PR #39
- `.env.example`: Documented new environment variables

---

## Metrics to Track

Once active routing is enabled in production, monitor:

**A/B Test Metrics:**
- Approval rate: Control group vs Treatment group
- Regeneration rate: Control vs Treatment
- Average decision latency: Control vs Treatment
- Cost per approved artifact: Control vs Treatment

**Routing Metrics:**
- % requests in control vs treatment
- % requests using analytics provider vs static
- Fallback rate (analytics provider unsupported)
- Performance query failure rate

**Provider Metrics (by capability):**
- Which providers are being selected by analytics
- Approval rate delta when switching providers
- Cost delta when switching providers

**Query Template:**

```sql
-- Compare approval rates: Control vs Treatment
SELECT
  rd.ab_test_group,
  COUNT(*) as total_requests,
  COUNT(*) FILTER (WHERE ad.decision = 'APPROVED') as approved,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ad.decision = 'APPROVED') / COUNT(*), 2) as approval_rate_pct
FROM routing_decisions rd
LEFT JOIN approval_decisions ad ON rd.artifact_id = ad.artifact_id
WHERE rd.created_at > NOW() - INTERVAL '7 days'
  AND rd.strategy IN ('ab-test-control', 'performance-based-active')
GROUP BY rd.ab_test_group;
```

---

## Migration Path from PR #38

**PR #38 State:**
- Intelligent routing enabled (`ENABLE_INTELLIGENT_ROUTING=true`)
- Active routing **disabled** (observation mode)
- Logs analytics recommendations without acting

**PR #39 Upgrade:**
1. Merge PR #39 code
2. Keep `ENABLE_ACTIVE_ROUTING=false` initially (no behavior change)
3. Monitor logs for analytics recommendations
4. When confident, enable for ONE workspace: add to workspace settings
5. Monitor A/B test metrics for 7 days
6. If metrics improve, roll out globally
7. If metrics worsen, disable and analyze performance data quality

---

## Safety Mechanisms

**1. Double Feature Flag**
- Must enable BOTH `ENABLE_INTELLIGENT_ROUTING` and `ENABLE_ACTIVE_ROUTING`
- Can observe analytics before activating

**2. A/B Testing**
- 10% control group always uses static registry
- Provides comparison baseline for validation

**3. Capability Support Check**
- If analytics provider doesn't support capability, fall back to static
- No broken executions due to provider mismatch

**4. Deterministic Bucketing**
- Same identifier always gets same group
- Consistent user experience, no group-switching mid-session

**5. Observable Routing Decisions**
- Every routing decision includes full metadata
- Can audit why provider was selected
- Can measure impact of routing strategy

---

## Next Steps (Future PRs)

**PR #40 — Cost-Quality Optimization**
- Add provider cost data to metadata
- Calculate cost-per-approval metric
- Auto-route based on cost-quality ratio
- Budget constraints (e.g., "max $500/month on hooks")

**PR #41 — Workspace-Scoped Routing Overrides**
- Allow workspace admins to force specific providers
- Override analytics for compliance or quality requirements
- Example: "Always use Claude for medical content" (regulatory)

**PR #42 — Multi-Armed Bandit Optimization**
- Replace static A/B test with adaptive allocation
- Automatically increase traffic to better-performing provider
- Explore-exploit tradeoff for continuous learning

**PR #43 — Provider Performance Dashboard**
- Visual charts for provider comparison
- Approval rate timeline per capability
- Cost-quality tradeoff visualization
- Manual provider override UI

---

## Impact

### Engineering
- ✅ Active provider routing with safe rollout (A/B test)
- ✅ Deterministic bucketing for consistent UX
- ✅ Graceful fallback when provider unsupported
- ✅ 93/93 tests passing (18 new tests)
- ✅ Full routing decision observability

### Product
- ✅ System learns from user feedback and auto-optimizes
- ✅ Continuous improvement without manual intervention
- ✅ Data-driven provider selection (not static assumptions)
- ✅ Workspace-specific routing (via analytics filtering)
- ✅ Measurable impact via A/B testing

### Business
- ✅ Reduce regeneration cycles via better provider matching
- ✅ Lower AI costs via cost-quality optimization (future PR #40)
- ✅ Improve artifact quality via continuous learning
- ✅ Prove ROI of intelligent routing with A/B test data

---

## Deployment Checklist

Before enabling active routing in production:

- [ ] Verify analytics data exists for target capabilities
- [ ] Confirm performance scorer returns valid recommendations
- [ ] Set `ENABLE_INTELLIGENT_ROUTING=true` (observation mode)
- [ ] Monitor logs for 48 hours — check analytics recommendations
- [ ] Verify no excessive fallbacks or errors
- [ ] Set `ENABLE_ACTIVE_ROUTING=true` for pilot workspace
- [ ] Monitor A/B test metrics for 7 days
- [ ] Compare approval rates: control vs treatment
- [ ] Validate cost impact (if cost data available)
- [ ] If metrics positive, roll out to all workspaces
- [ ] If metrics negative, disable and analyze root cause

---

**Next:** PR #40 — Cost-Quality Optimization (add cost tracking to routing decisions)
