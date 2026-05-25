# PR #37 — Review Intelligence Layer

**Status:** ✅ Complete  
**Date:** 2026-05-25  
**Branch:** feat/pr26-executor-ai-integration

---

## Overview

Added approval decision analytics to enable provider performance tracking, feedback pattern detection, and artifact risk scoring. This transforms the approval workflow from simple workflow control into an intelligence feedback loop.

## Problem Solved

Before PR #37:
- ❌ Users could approve/reject/regenerate artifacts
- ❌ No visibility into which providers perform better
- ❌ No insight into common failure patterns
- ❌ No data-driven provider routing
- ❌ No system learning from approval patterns

After PR #37:
- ✅ Every approval decision captured for analytics
- ✅ Provider performance comparison (Claude vs GPT vs Higgsfield)
- ✅ Feedback pattern detection (which issues are most common)
- ✅ Artifact risk scoring (which capabilities need most regen)
- ✅ Foundation for intelligent provider routing

---

## Architecture

### Data Model

**ApprovalDecision** (new table):
```prisma
model ApprovalDecision {
  id          String   @id
  approvalId  String   @unique
  artifactId  String
  executionId String
  workspaceId String

  // Decision data
  decision        String   // APPROVED | REJECTED | REGENERATE | etc.
  feedback        String?
  feedbackType    String?  // hook_angle, tone, cta, etc.
  severity        String?  // LOW | MEDIUM | HIGH
  preserveAspects String[]

  // Provider attribution
  provider   String?  // claude, openai, higgsfield
  capability String?  // GENERATE_HOOKS, etc.
  model      String?  // claude-opus-4, gpt-4, etc.

  // Reviewer tracking
  reviewerId String
  reviewedAt DateTime @default(now())
}
```

**Indexes for analytics queries:**
- `workspaceId + reviewedAt` — timeline queries
- `provider + decision` — provider performance
- `capability + decision` — artifact type performance
- `feedbackType` — feedback patterns
- `severity` — severity distribution

---

## Changes

### Database

**Files:**
- `prisma/schema.prisma` — ApprovalDecision model added
- `prisma/migrations/20260525000000_add_approval_decision_analytics/migration.sql` — table creation

**Relations:**
- `ApprovalDecision → ArtifactApproval` (1:1)
- `ApprovalDecision → Artifact` (N:1)
- `ApprovalDecision → ExecutionRequest` (N:1)
- `ApprovalDecision → Workspace` (N:1)

### Backend

**Decision Capture** (`src/routes/execution/resume.js`):
- Added `_captureDecisionAnalytics()` helper
- Extracts provider/capability/model from artifact
- Creates ApprovalDecision record after each decision
- Non-blocking (logs errors, doesn't fail resume)

**Analytics Endpoints** (`src/routes/analytics/approvals.js`):
1. `GET /api/analytics/approvals/summary`
   - Overall metrics: total decisions, approval rate, rejection rate
   - Severity distribution
   - Date range filtering

2. `GET /api/analytics/approvals/by-provider`
   - Provider performance comparison
   - Approval/rejection/regeneration rates per provider
   - Model attribution

3. `GET /api/analytics/approvals/by-capability`
   - Artifact type performance
   - Risk scoring (weighted: rejection=3pts, regenerate=2pts, revision=1pt)
   - Identifies high-risk capabilities

4. `GET /api/analytics/approvals/feedback-patterns`
   - Most common feedback types
   - Severity distribution per feedback type
   - Common preserve aspects
   - Sorted by frequency

**Route Registration** (`src/server.js`):
- Mounted at `/api/analytics`
- Protected by `requireAuth` + `apiLimiter`
- Workspace-scoped via `req.workspaceId`

### Tests

**File:** `src/routes/analytics/approvals.test.js`

**Coverage:**
- ✅ Summary endpoint (10 tests)
- ✅ Provider performance endpoint
- ✅ Capability performance endpoint
- ✅ Feedback patterns endpoint
- ✅ Date range filtering
- ✅ Empty result handling
- ✅ Error handling

**Results:** 10/10 passing

---

## API Reference

### GET /api/analytics/approvals/summary

**Query Params:**
- `startDate` (optional) — ISO date string, default: 30 days ago
- `endDate` (optional) — ISO date string, default: now

**Response:**
```json
{
  "total": 47,
  "dateRange": { "startDate": "...", "endDate": "..." },
  "decisions": {
    "approved": 32,
    "rejected": 5,
    "regenerate": 8,
    "requestRevision": 2,
    "escalate": 0
  },
  "rates": {
    "approvalRate": 68.09,
    "rejectionRate": 10.64,
    "regenerationRate": 17.02
  },
  "severity": {
    "high": 12,
    "medium": 18,
    "low": 17
  }
}
```

### GET /api/analytics/approvals/by-provider

**Response:**
```json
{
  "dateRange": { "startDate": "...", "endDate": "..." },
  "providers": {
    "claude": {
      "total": 28,
      "decisions": { "approved": 23, "rejected": 2, "regenerate": 3 },
      "approvalRate": 82.14,
      "rejectionRate": 7.14,
      "regenerationRate": 10.71,
      "models": ["claude-opus-4", "claude-sonnet-3-5"]
    },
    "openai": {
      "total": 19,
      "decisions": { "approved": 9, "rejected": 3, "regenerate": 5 },
      "approvalRate": 47.37,
      "rejectionRate": 15.79,
      "regenerationRate": 26.32,
      "models": ["gpt-4", "gpt-4-turbo"]
    }
  }
}
```

### GET /api/analytics/approvals/by-capability

**Response:**
```json
{
  "dateRange": { "startDate": "...", "endDate": "..." },
  "capabilities": {
    "GENERATE_HOOKS": {
      "total": 15,
      "decisions": { "approved": 12, "rejected": 1, "regenerate": 2 },
      "approvalRate": 80.0,
      "regenerationRate": 13.33,
      "riskScore": 0.33
    },
    "GENERATE_VISUAL_BRIEF": {
      "total": 12,
      "decisions": { "approved": 6, "rejected": 3, "regenerate": 3 },
      "approvalRate": 50.0,
      "regenerationRate": 25.0,
      "riskScore": 1.25
    }
  }
}
```

### GET /api/analytics/approvals/feedback-patterns

**Response:**
```json
{
  "dateRange": { "startDate": "...", "endDate": "..." },
  "total": 23,
  "patterns": {
    "hook_angle": {
      "count": 8,
      "severity": { "high": 3, "medium": 4, "low": 1 },
      "decisions": { "regenerate": 6, "requestRevision": 2 },
      "commonPreserveAspects": [
        { "aspect": "brand_voice", "count": 5 },
        { "aspect": "tone", "count": 3 }
      ]
    },
    "weak_cta": {
      "count": 5,
      "severity": { "high": 2, "medium": 2, "low": 1 },
      "decisions": { "regenerate": 4, "requestRevision": 1 },
      "commonPreserveAspects": [
        { "aspect": "hook", "count": 3 }
      ]
    }
  }
}
```

---

## Use Cases

### 1. Provider Routing

**Before PR #37:**
```javascript
// Random provider selection
const provider = Math.random() > 0.5 ? 'claude' : 'openai';
```

**After PR #37:**
```javascript
// Data-driven provider routing
const analytics = await fetch('/api/analytics/approvals/by-provider');
const claudeRate = analytics.providers.claude.approvalRate;
const gptRate = analytics.providers.openai.approvalRate;

// Route to higher-performing provider for this capability
const provider = claudeRate > gptRate ? 'claude' : 'openai';
```

### 2. Risk Flagging

**Before PR #37:**
```javascript
// No visibility into artifact risk
await generateVisualBrief(campaignId);
```

**After PR #37:**
```javascript
const analytics = await fetch('/api/analytics/approvals/by-capability');
const visualBriefRisk = analytics.capabilities.GENERATE_VISUAL_BRIEF.riskScore;

if (visualBriefRisk > 1.5) {
  // Flag high-risk generation, add review step
  await sendReviewNotification('Visual briefs need extra review');
}
```

### 3. Prompt Engineering

**Before PR #37:**
```
// Generic prompt, no learning
Generate a hook for this campaign.
```

**After PR #37:**
```javascript
const analytics = await fetch('/api/analytics/approvals/feedback-patterns');
const commonIssues = analytics.patterns;

// Common issue: weak_cta appears 15 times
// → Strengthen CTA guidance in base prompt

Generate a hook for this campaign.
CRITICAL: End with a strong, specific call-to-action.
Common failure pattern: vague CTAs like "Learn More" perform poorly.
Use benefit-driven CTAs like "Get 40% Off Today Only".
```

---

## Next Steps (Future PRs)

**PR #38 — Provider Performance Scoring**
- Auto-route capabilities to best-performing provider
- A/B test provider assignments
- Track cost vs quality tradeoffs

**PR #39 — Selective Prompt Mutation Engine**
- Auto-strengthen prompts based on feedback patterns
- Version prompts, A/B test improvements
- Measure prompt performance over time

**PR #40 — Approval Analytics Dashboard (Frontend)**
- Visual charts for provider performance
- Feedback pattern timeline
- Risk scoring heatmap by capability

---

## Impact

### Engineering
- ✅ Every approval decision captured durably
- ✅ No performance impact (analytics capture is async)
- ✅ Workspace-scoped authorization
- ✅ 10/10 tests passing

### Product
- ✅ Data-driven provider routing foundation
- ✅ Feedback loop for system learning
- ✅ Risk visibility for high-failure capabilities
- ✅ Foundation for autonomous optimization

### Business
- ✅ Reduce approval-rejection cycles via smarter routing
- ✅ Improve artifact quality via feedback-driven prompts
- ✅ Lower costs via cost-quality attribution
- ✅ Enable enterprise-grade optimization

---

## Files Changed

**Backend:**
- `prisma/schema.prisma` — ApprovalDecision model
- `prisma/migrations/20260525000000_add_approval_decision_analytics/migration.sql` — migration
- `src/routes/execution/resume.js` — decision capture logic
- `src/routes/analytics/index.js` — analytics router (new)
- `src/routes/analytics/approvals.js` — analytics endpoints (new)
- `src/routes/analytics/approvals.test.js` — tests (new)
- `src/server.js` — route registration

**Total:** 7 files changed, ~700 lines added

---

## Testing

**Run tests:**
```bash
npx vitest run src/routes/analytics/approvals.test.js
```

**Expected:**
```
✓ src/routes/analytics/approvals.test.js (10)
  ✓ Analytics — Approval Decision Routes (PR #37)
    ✓ GET /api/analytics/approvals/summary
    ✓ GET /api/analytics/approvals/by-provider
    ✓ GET /api/analytics/approvals/by-capability
    ✓ GET /api/analytics/approvals/feedback-patterns
    ✓ Error handling
```

**Result:** 10/10 passing ✅

---

## Migration Notes

**Before deploying:**
```bash
npx prisma migrate deploy  # Apply migration to production DB
npx prisma generate        # Regenerate Prisma client
```

**After deploying:**
- Analytics endpoints immediately available at `/api/analytics/approvals/*`
- Decision capture starts logging data on next approval submission
- No breaking changes to existing approval workflow

---

## Conclusion

PR #37 transforms MARCOM's approval workflow from a simple gate into an **intelligence feedback loop**. Every decision is now captured, analyzed, and available for system learning.

This enables:
- **Provider routing** based on performance data
- **Prompt engineering** guided by failure patterns
- **Risk scoring** to flag problematic capabilities
- **Cost optimization** via provider attribution

The approval system is no longer just workflow control — it's the **learning engine** for the entire platform.

---

**Next:** PR #38 — Provider Performance Scoring (auto-routing based on analytics)
