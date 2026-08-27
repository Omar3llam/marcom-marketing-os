# Adaptive Reinforcement Engine — PR #42

Transform LUMI from passive performance tracking into an adaptive autonomous optimization system.

## Overview

The Reinforcement Engine enables LUMI to:
- **Learn from outcomes**: Track real performance data (approval rates, CTR, ROAS, cost efficiency)
- **Adapt over time**: Apply recency weighting so recent performance matters more
- **Optimize routing**: Automatically shift traffic to higher-performing providers
- **Allocate budgets**: Recommend budget redistribution based on performance
- **Ensure safety**: Prevent oscillation and rapid provider flipping

## Architecture

```
src/services/reinforcement-engine/
├── index.js              # Public API (orchestrator)
├── scoringEngine.js      # Recency-weighted scoring
├── memoryManager.js      # ReinforcementSnapshot CRUD
├── budgetAllocator.js    # Traffic redistribution logic
├── README.md             # This file
├── *.test.js             # Full test coverage
```

## Core Concepts

### 1. Recency Decay

Recent performance weighs more than historical performance.

**Decay Function:**
```
decayFactor(daysAgo) = exp(-λ × daysAgo)
where λ = 0.023 (half-life ≈ 30 days)
```

**Examples:**
- 0 days ago: 1.0 (full weight)
- 30 days ago: 0.5 (half weight)
- 60 days ago: 0.25 (quarter weight)

### 2. Multi-Metric Scoring

Composite score based on multiple metrics:

| Metric | Weight | Source |
|--------|--------|--------|
| Approval Rate | 35% | `approval_decisions` table |
| CTR (Click-Through Rate) | 25% | `provider_performance_metrics` table |
| ROAS (Return on Ad Spend) | 25% | `provider_performance_metrics` table |
| Cost Efficiency | 15% | Inverse of cost per approval |

### 3. Confidence Tracking

Confidence increases logarithmically with sample size:

```
confidence = log10(N + 1) / log10(101)
```

- N < 10: confidence = 0.0 (insufficient data)
- N = 10: confidence ≈ 0.52
- N = 100: confidence = 1.0
- N ≥ 100: confidence = 1.0 (capped)

### 4. Capability-Specific Learning

Learning is scoped to `(provider, capability)` pairs.

**Example:**
- `claude` + `GENERATE_HOOKS` → score 85
- `claude` + `GENERATE_CAPTIONS` → score 62
- `openai` + `GENERATE_HOOKS` → score 78

Each pair is scored independently.

### 5. Safety Constraints

| Constraint | Value | Purpose |
|------------|-------|---------|
| `MAX_WEIGHT_CHANGE_PER_DAY` | 15% | Prevent rapid oscillation |
| `MIN_PROVIDER_WEIGHT` | 5% | Never zero out a provider |
| `MAX_PROVIDER_WEIGHT` | 70% | Prevent single-provider dominance |
| `MIN_SAMPLE_SIZE` | 10 | Require minimum data points |
| `CONFIDENCE_THRESHOLD` | 0.6 | Only act on confident scores |
| `REALLOCATION_CONFIDENCE_THRESHOLD` | 0.7 | Higher bar for redistribution |

## Usage

### Update Provider Scores

Run this periodically (e.g., daily via cron) to recalculate scores:

```javascript
import { updateProviderScores } from './services/reinforcement-engine/index.js';

// Update scores for a capability
const results = await updateProviderScores('GENERATE_HOOKS', {
  workspaceId: 'ws-123', // optional: scope to workspace
  windowStart: new Date('2026-01-01'), // optional: default 90 days ago
  windowEnd: new Date(), // optional: default now
});

// Results: [{ provider, score, confidence, snapshot }]
console.log(`Updated ${results.length} providers`);
```

### Get Recommendations

Get traffic redistribution recommendations:

```javascript
import { getRecommendations } from './services/reinforcement-engine/index.js';

const currentWeights = {
  'claude': 0.6,
  'openai': 0.4,
};

const recommendations = await getRecommendations('GENERATE_HOOKS', currentWeights, {
  workspaceId: 'ws-123', // optional
  maxWeightChange: 0.15, // optional: default 15%
  minProviderWeight: 0.05, // optional: default 5%
  confidenceThreshold: 0.7, // optional: default 0.7
});

// Results: [{ provider, currentWeight, recommendedWeight, scoreChange, rationale }]
for (const rec of recommendations) {
  console.log(`${rec.provider}: ${rec.currentWeight} → ${rec.recommendedWeight} (${rec.rationale})`);
}
```

### Apply Recommendations

Apply weight changes to the routing system:

```javascript
import { applyWeightRecommendations } from './services/reinforcement-engine/index.js';

const result = await applyWeightRecommendations('GENERATE_HOOKS', recommendations, {
  updateWeightsCallback: async (capability, newWeights) => {
    // Your code to update routing weights
    await routingSystem.updateWeights(capability, newWeights);
  },
});

console.log(`Applied ${result.applied} changes, skipped ${result.skipped}`);
```

### Get Budget Allocation

Calculate budget allocation based on performance scores:

```javascript
import { getBudgetAllocation } from './services/reinforcement-engine/index.js';

const totalBudget = 10000; // $10,000 USD
const providerCosts = {
  'claude': 0.05, // $0.05 per request
  'openai': 0.08, // $0.08 per request
};

const allocation = await getBudgetAllocation(totalBudget, 'GENERATE_HOOKS', providerCosts, {
  workspaceId: 'ws-123', // optional
});

// Results: { provider: { budget, estimatedRequests } }
console.log(`Claude: $${allocation.claude.budget} (${allocation.claude.estimatedRequests} requests)`);
console.log(`OpenAI: $${allocation.openai.budget} (${allocation.openai.estimatedRequests} requests)`);
```

### Check Performance Trends

Analyze score trends over time:

```javascript
import { getPerformanceTrend } from './services/reinforcement-engine/index.js';

const trend = await getPerformanceTrend('claude', 'GENERATE_HOOKS', {
  lookbackDays: 30, // optional: default 30
});

// Results: { trend: 'improving' | 'declining' | 'stable', change: number, snapshots: number }
console.log(`Claude GENERATE_HOOKS: ${trend.trend} (${trend.change > 0 ? '+' : ''}${trend.change})`);
```

### Detect Oscillation

Check for routing oscillation (rapid provider flipping):

```javascript
import { checkOscillation } from './services/reinforcement-engine/index.js';

const recentRecommendations = [
  // Array of recent recommendation sets
];

const oscillating = checkOscillation(recentRecommendations, {
  lookbackCount: 5, // optional: default 5
  reversalThreshold: 0.2, // optional: default 0.2
});

if (oscillating) {
  console.warn('Routing oscillation detected! Consider increasing confidence threshold.');
}
```

## Events

The engine emits events for monitoring and alerting:

```javascript
import { reinforcementEvents } from './services/reinforcement-engine/index.js';

reinforcementEvents.on('PROVIDER_WEIGHT_UPDATED', (event) => {
  console.log(`Provider ${event.provider} weight changed: ${event.oldWeight} → ${event.newWeight}`);
});

reinforcementEvents.on('BUDGET_REALLOCATED', (event) => {
  console.log(`Budget reallocated for ${event.capability}: ${JSON.stringify(event.allocation)}`);
});

reinforcementEvents.on('PERFORMANCE_DECAY_APPLIED', (event) => {
  console.log(`Score updated for ${event.provider}: ${event.score} (confidence: ${event.confidence})`);
});

reinforcementEvents.on('ROUTING_STRATEGY_CHANGED', (event) => {
  console.log(`Routing strategy changed for ${event.capability}: ${event.changes} significant changes`);
});
```

## Database Schema

### ReinforcementSnapshot

Append-only table tracking provider scores over time.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT | Primary key (cuid) |
| `workspaceId` | UUID | Workspace scope (optional) |
| `provider` | TEXT | Provider name (e.g., 'claude', 'openai') |
| `capability` | TEXT | Capability name (e.g., 'GENERATE_HOOKS') |
| `score` | FLOAT | Composite score (0-100) |
| `confidence` | FLOAT | Confidence level (0.0-1.0) |
| `sampleSize` | INTEGER | Number of data points in snapshot |
| `windowStart` | TIMESTAMP | Performance window start |
| `windowEnd` | TIMESTAMP | Performance window end |
| `createdAt` | TIMESTAMP | Snapshot timestamp (immutable) |

**Indexes:**
- `(provider, capability, createdAt DESC)` — Query history
- `(workspaceId, createdAt DESC)` — Workspace-scoped queries
- `(windowStart, windowEnd)` — Time-range queries

**Foreign Keys:**
- `workspaceId` → `workspaces.id` (CASCADE)

## Testing

Full test coverage included:

These suites are DB-backed. `npm test` (fast mode) SKIPS them when no migrated
database is configured, so use full mode — see "Verification" in CLAUDE.md for
the database setup.

```bash
# Run all tests in this directory, with database semantics required
npm run test:full -- src/services/reinforcement-engine/

# Run a specific test file
npm run test:full -- src/services/reinforcement-engine/scoringEngine.test.js
```

**Test Coverage:**
- ✅ Deterministic scoring (same inputs → same outputs)
- ✅ Recency decay function
- ✅ Confidence calculation
- ✅ Multi-metric composite scoring
- ✅ Traffic redistribution recommendations
- ✅ Budget allocation
- ✅ Oscillation detection
- ✅ Safety constraint enforcement
- ✅ Append-only memory operations

## Integration with Existing Systems

### With Intelligent Router

```javascript
// intelligentRouter.js
import { getLatestSnapshotsForCapability } from './services/reinforcement-engine/index.js';

export async function routeCapability(capability, options = {}) {
  // Existing logic...

  if (options.useReinforcementLearning) {
    // Get latest scores from reinforcement engine
    const snapshots = await getLatestSnapshotsForCapability(capability, {
      workspaceId: options.workspaceId,
    });

    if (snapshots.length > 0) {
      // Use snapshots to influence routing decision
      const bestProvider = snapshots.sort((a, b) => b.score - a.score)[0];
      
      if (bestProvider.confidence >= 0.7) {
        return bestProvider.provider;
      }
    }
  }

  // Fallback to existing routing logic...
}
```

### With Cron Jobs

```javascript
// scripts/update-reinforcement-scores.js
import { updateProviderScores } from './services/reinforcement-engine/index.js';

const CAPABILITIES = [
  'GENERATE_HOOKS',
  'GENERATE_CAPTIONS',
  'GENERATE_AD_COPY',
  // ... more capabilities
];

async function updateAllScores() {
  for (const capability of CAPABILITIES) {
    try {
      const results = await updateProviderScores(capability);
      console.log(`Updated ${capability}: ${results.length} providers`);
    } catch (error) {
      console.error(`Failed to update ${capability}:`, error);
    }
  }
}

// Run daily
updateAllScores();
```

## Deployment Checklist

Before deploying PR #42:

- [ ] Prisma migration applied (`20260527000000_add_reinforcement_snapshots`)
- [ ] `npx prisma generate` run (regenerate client)
- [ ] Tests passing (`npm run test:full -- src/services/reinforcement-engine/`)
- [ ] Architecture check clean (`npm run arch-check`)
- [ ] Environment variables set (if needed)
- [ ] Cron job configured for score updates
- [ ] Monitoring/alerting configured for events
- [ ] Documentation updated (this README)

## Environment Variables

No new environment variables required (optional feature flags may be added later).

## Monitoring

Key metrics to monitor:

- **Score updates per day**: Should match cron frequency
- **Recommendation application rate**: % of recommendations applied vs skipped
- **Oscillation events**: Should be rare (< 1% of capabilities)
- **Confidence levels**: Average confidence should increase over time
- **Sample sizes**: Monitor data availability per (provider, capability) pair

## Troubleshooting

### "No snapshots found"

**Cause:** `updateProviderScores()` hasn't been run yet, or no data exists for the capability.

**Fix:** Run score updates manually or wait for cron job to execute.

### "Insufficient sample size"

**Cause:** Less than 10 data points available for a provider + capability pair.

**Fix:** Wait for more data to accumulate, or lower `MIN_SAMPLE_SIZE` (not recommended for production).

### "Confidence below threshold"

**Cause:** Sample size is too small for confident scoring.

**Fix:** Wait for more data, or adjust `confidenceThreshold` parameter (with caution).

### "Oscillation detected"

**Cause:** Provider weights are flipping rapidly (e.g., A→B→A→B).

**Fix:** 
1. Increase `REALLOCATION_CONFIDENCE_THRESHOLD` (require more confidence for changes)
2. Decrease `MAX_WEIGHT_CHANGE_PER_DAY` (slow down adjustments)
3. Increase `reversalThreshold` in oscillation detection

### "Budget allocation doesn't sum to totalBudget"

**Cause:** Rounding errors in budget calculation.

**Fix:** This is expected due to integer rounding of `estimatedRequests`. The difference should be < $1.

## Future Enhancements

Potential improvements (not in scope for PR #42):

- [ ] Multi-armed bandit exploration (Thompson Sampling)
- [ ] Contextual features (time of day, campaign type, etc.)
- [ ] A/B test framework integration
- [ ] Real-time score updates (streaming vs batch)
- [ ] Dashboard UI for score visualization
- [ ] Anomaly detection (sudden score drops)
- [ ] Provider cost prediction (ML model)
- [ ] Cross-capability learning (transfer learning)

## References

- **PR #38**: Provider Performance Scoring (foundation)
- **PR #39**: Active Routing (A/B testing)
- **PR #40**: Cost Optimization (cost-quality tradeoffs)
- **PR #41**: Outcome Attribution (real CTR/ROAS data)
- **PR #42**: Adaptive Reinforcement Engine (this PR)

## License

Internal MARCOM v4.1 codebase. See project root LICENSE.
