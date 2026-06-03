# AI Provider Routing Strategy

## Overview

MARCOM uses an intelligent AI gateway that routes tasks to different providers based on:
- **Cost optimization** (GPT-4o-mini vs Claude Sonnet)
- **Task type** (Content vs Analysis)
- **Performance analytics** (approval rates, CTR, ROAS)
- **A/B testing** (10% control group)

---

## Current Routing (Default)

| Task | Provider | Model | Cost |
|------|----------|-------|------|
| **Hooks** | **OpenAI** | **GPT-4o-mini** | **$** |
| **Copy** | **OpenAI** | **GPT-4o-mini** | **$** |
| **Captions** | **OpenAI** | **GPT-4o-mini** | **$** |
| Strategy | Claude | Sonnet 4.5 | $$$ |
| Audience | Claude | Sonnet 4.5 | $$$ |
| Analysis | Claude | Sonnet 4.5 | $$$ |
| **Visual Prompts** | **OpenAI** | **GPT-4o-mini** | **$** |

---

## Recommended Routing (Cost Optimized)

| Task | Status | Provider | Savings |
|------|--------|----------|---------|
| Hooks | ✅ Optimized | OpenAI GPT-4o-mini | ~70% |
| Copy | ✅ Optimized | OpenAI GPT-4o-mini | ~70% |
| Captions | ✅ Optimized | OpenAI GPT-4o-mini | ~70% |
| Strategy | ✅ Keep Claude | Claude Sonnet | — |
| Audience | ✅ Keep Claude | Claude Sonnet | — |
| Analysis | ✅ Keep Claude | Claude Sonnet | — |
| Visual Prompts | ✅ Optimized | OpenAI GPT-4o-mini | ~70% |

### Cost Impact

**Before:**
- 100 content requests → Claude Sonnet ($$$)
- 20 analysis requests → Claude Sonnet ($$$)
- **Total:** 120 requests at $$$

**After:**
- 100 content requests → OpenAI GPT-4o-mini ($)
- 20 analysis requests → Claude Sonnet ($$$)
- **Total:** ~70% cost reduction

---

## Environment Variables

### Enable Cost Optimization

```bash
# .env

# Enable intelligent routing (uses performance analytics)
ENABLE_INTELLIGENT_ROUTING=true

# Enable active routing (switches providers based on performance)
ENABLE_ACTIVE_ROUTING=true

# Enable cost optimization (balance cost vs quality)
ENABLE_COST_OPTIMIZATION=true

# Cost-quality balance (0.0 = pure quality, 1.0 = pure cost)
# 0.5 = balanced (recommended)
COST_WEIGHT=0.5

# Maximum cost per approved artifact (USD)
# Prevents expensive providers if cost exceeds threshold
MAX_COST_PER_APPROVAL=0.10

# A/B test control group percentage (default: 10%)
AB_TEST_CONTROL_PERCENTAGE=10

# OpenAI model override (default: GPT-4o-mini)
# Options: gpt-4o-mini, gpt-4o, o1
OPENAI_MODEL=gpt-4o-mini
```

---

## Task-to-Provider Mapping

### Content Tasks (Cheap: OpenAI GPT-4o-mini)

✅ **Routed to OpenAI GPT-4o-mini:**
- Hooks (ad hooks, CTAs)
- Copy (full ad copy, landing pages)
- Captions (social media, ad descriptions)
- Visual prompts (DALL·E, Midjourney)

⏳ **Future content tasks:**
- Email copy
- Carousel content

### Analysis Tasks (Expensive: Claude Sonnet)

✅ **Keep with Claude:**
- Campaign analysis (ROAS, budget decisions)
- Multi-campaign diagnosis
- Strategic recommendations
- Funnel analysis
- Scale/Hold/Kill decisions
- Audience hypotheses
- Angle strategy

---

## Implementation Roadmap

### Phase 1: Enable Cost Optimization (Immediate)

**Action:** Set environment variables

```bash
ENABLE_INTELLIGENT_ROUTING=true
ENABLE_COST_OPTIMIZATION=true
COST_WEIGHT=0.5
```

**Impact:**
- Existing OpenAI routes (captions, visual prompts) will use cost optimization
- No code changes required

### Phase 2: Add OpenAI Content Methods ✅ COMPLETE

**Status:** ✅ Implemented on 2026-06-03

**Files updated:**
- ✅ `src/services/ai-gateway/providers/openaiProvider.js` — Added `generateHooks()` and `generateCopy()` methods
- ✅ `src/services/ai-gateway/providerRegistry.js` — Updated routing to use OpenAI for hooks and copy

**Methods added:**
```javascript
export async function generateHooks(input, decisionContext) { ... }
export async function generateCopy(input, decisionContext) { ... }
```

**Routing updated:**
```javascript
[CAPABILITY.GENERATE_HOOKS]: {
  provider: PROVIDER.OPENAI,  // Changed from CLAUDE
  method: openaiProvider.generateHooks,
},
[CAPABILITY.GENERATE_COPY]: {
  provider: PROVIDER.OPENAI,  // Changed from CLAUDE
  method: openaiProvider.generateCopy,
},
```

**Impact:**
- ✅ 70% cost reduction on content generation
- ✅ All content tasks now use GPT-4o-mini ($0.15/1M vs Claude $3.00/1M)
- ✅ Estimated savings: $500-1000/month (depends on volume)

### Phase 3: Performance-Based Auto-Switching (Future)

**Action:** Let analytics decide provider based on real performance

```bash
ENABLE_REAL_PERFORMANCE=true
```

**Impact:**
- System auto-switches to best-performing provider
- Optimizes for approval rate, CTR, ROAS (not just cost)
- Continuous improvement via A/B testing

---

## Cost Comparison

### Current Pricing (as of 2026)

| Provider | Model | Input | Output | Use Case |
|----------|-------|-------|--------|----------|
| OpenAI | GPT-4o-mini | $0.15/1M | $0.60/1M | ✅ Content |
| OpenAI | GPT-4o | $5.00/1M | $15.00/1M | Visual prompts |
| Anthropic | Claude Sonnet 4.5 | $3.00/1M | $15.00/1M | ✅ Analysis |
| Anthropic | Claude Opus 4 | $15.00/1M | $75.00/1M | (Not used) |

### Example: 1000 Content Requests

**Scenario:** 1000 hook generations (avg 500 input + 200 output tokens)

**Current (Claude Sonnet):**
- Input: 500K tokens = $1.50
- Output: 200K tokens = $3.00
- **Total: $4.50**

**Optimized (GPT-4o-mini):**
- Input: 500K tokens = $0.075
- Output: 200K tokens = $0.12
- **Total: $0.195**

**Savings: $4.30 (95% reduction!)** 🎯

---

## Dashboard Metrics

Monitor routing decisions:

```bash
GET /api/analytics/ai-routing-stats
```

**Response:**
```json
{
  "intelligentRoutingEnabled": true,
  "activeRoutingEnabled": true,
  "costOptimizationEnabled": true,
  "totalRequests": 1247,
  "routingDecisions": {
    "static": 124,
    "performance-based": 998,
    "ab-test-control": 125
  },
  "providerUsage": {
    "CLAUDE": 247,
    "OPENAI": 1000
  },
  "costSavings": {
    "estimated": "$127.50",
    "percentage": 68
  }
}
```

---

## Settings UI (Future)

Planned UI in `/app/settings/ai-providers`:

```
┌─────────────────────────────────────┐
│ AI Provider Configuration           │
├─────────────────────────────────────┤
│                                     │
│ Content Generation                  │
│ ◉ OpenAI GPT-4o-mini (Recommended) │
│ ○ OpenAI GPT-4o                    │
│ ○ Claude Sonnet                    │
│                                     │
│ Campaign Analysis                   │
│ ◉ Claude Sonnet (Recommended)      │
│ ○ OpenAI GPT-4o                    │
│                                     │
│ Strategy & Planning                 │
│ ◉ Claude Sonnet (Recommended)      │
│ ○ OpenAI o1                        │
│                                     │
│ Cost Optimization                   │
│ ☑ Enable intelligent routing       │
│ ☑ Enable cost optimization          │
│ Cost-Quality Balance: [====|====]   │
│                      (Balanced)     │
│                                     │
│ [Save Configuration]                │
└─────────────────────────────────────┘
```

---

## Monitoring

### Check routing decisions

```javascript
import { getRoutingStats } from './services/ai-gateway/intelligentRouter.js';

const stats = getRoutingStats();
console.log(stats);
// {
//   intelligentRoutingEnabled: true,
//   activeRoutingEnabled: true,
//   costOptimizationEnabled: true,
//   maxCostPerApproval: 0.10,
//   ...
// }
```

### Force specific provider (for testing)

```javascript
import { execute, CAPABILITY, PROVIDER } from './services/ai-gateway/index.js';

// Force OpenAI for testing
const result = await execute(CAPABILITY.GENERATE_HOOKS, input, {
  forceProvider: PROVIDER.OPENAI,
});
```

---

## Next Steps

1. ✅ **COMPLETE:** Set environment variables for cost optimization
2. ✅ **COMPLETE:** Implement OpenAI content methods (hooks, copy)
3. ⏳ **Future:** Add Settings UI for provider configuration
4. ⏳ **Future:** Add DeepSeek/Gemini as additional providers
5. ⏳ **Future:** Implement email copy and carousel content methods

---

## References

- Provider implementations: `src/services/ai-gateway/providers/`
- Routing logic: `src/services/ai-gateway/intelligentRouter.js`
- Registry: `src/services/ai-gateway/providerRegistry.js`
- Cost tracking: `src/services/ai-gateway/providerCosts.js`
