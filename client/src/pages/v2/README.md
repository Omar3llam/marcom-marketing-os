# v2 Pages — Strangler Pattern Migration

**Strategy:** Gradual UI replacement using semantic components (Phase A) + type-safe contracts (Phase B).

---

## Structure

```
client/src/pages/v2/
├── DecisionViewV2.tsx      — Decision feed (Sprint 1: COMPLETE ✅)
├── InputFlowV2.tsx         — CSV/Meta input (Sprint 2)
├── TheaterV2.tsx           — AI analysis visualization (Sprint 2)
├── ExecutionViewV2.tsx     — Execution confirmation (Sprint 3)
└── README.md               — This file
```

---

## DecisionViewV2 (Sprint 1: COMPLETE ✅)

**Replaces:** [DecisionFeed.jsx](../DecisionFeed.jsx) (v1 FSM orchestrator)

**Scope:**
- ✅ Shell + FSM wiring
- ✅ Trust layer (DecisionTrustCluster from Phase A)
- ✅ Loading/error states (5-state lifecycle)
- ✅ Telemetry tracking (render time, API calls, errors)

**Architecture:**
```tsx
import { Shell, Stack } from '@/primitives';
import { DecisionTrustCluster } from '@/layouts';
import type { LumiFeedResponse, Campaign, Alert } from '@/types';

<Shell mode="full">
  <Stack gap="xl">
    {campaigns.map(c => c.alerts.map(alert => (
      <DecisionTrustCluster
        campaign={c}
        alert={alert}
        onExecute={() => handleExecute(alert, c)}
        isExecuting={executingActions.has(alert.action_id)}
      />
    )))}
  </Stack>
</Shell>
```

**Features:**
- FSM-driven execution (state managed via `executingActions` Set)
- Cognitive selectors: `extractTrustTier()`, `extractExecutionState()`, `extractConfidenceTier()`, `extractUrgencyTier()`
- Error classification: auth, network, platform, validation, parsing
- Empty state handling
- Real-time execution tracking (SSE integration ready for Sprint 2)

---

## Routes

### v2 Route (isolated)
```
/app/v2/decision → DecisionViewV2
```

**Enable in dev:**
```javascript
window.__features.enable('newDecisionView');
window.location.reload();
```

### Comparison Route (dev harness)
```
/app/compare/decision → ComparisonHarness (v1 vs v2)
```

**Enable in dev:**
```javascript
window.__features.enable('comparisonHarness');
window.location.reload();
// Then navigate to /app/compare/decision
```

---

## Sprint 2 Scope

**InputFlowV2:**
- CSV upload with BOM removal + EGP handling
- Meta Ads connect via OAuth
- Live validation with error recovery
- Progress indicators

**TheaterV2:**
- AI analysis visualization (dual-agent display)
- Progressive reveal (step-by-step breakdown)
- Confidence narrative (why this decision?)
- Memory recall display (what worked before?)

---

## Sprint 3 Scope

**ExecutionViewV2:**
- Execution confirmation modal
- Resource impact preview (budget, reach, frequency)
- Execution guardrails (4-layer guards from execution.js)
- SSE execution stream (real-time status updates)
- Rollback preview

**Signals Layer:**
- MomentumPulse (campaign velocity indicators)
- OpportunityWindow (timing-sensitive actions)
- UrgencyTimeline (decay curves for pending decisions)

---

## Migration Checklist

- [x] Build v2 route in isolation
- [x] Add to App.jsx routing
- [x] Add comparison harness route
- [ ] Test in dev mode (`/app/v2/decision`)
- [ ] Test in comparison mode (`/app/compare/decision`)
- [ ] Enable telemetry tracking
- [ ] Monitor render time (target: ≤ v1 baseline)
- [ ] Monitor error rate (target: < 2%)
- [ ] Enable feature flag for internal team
- [ ] A/B test with 10% of users
- [ ] Enable for 100% if metrics green
- [ ] Remove v1 code after 2 weeks

---

## Testing

```bash
# Navigate to v2 route
http://localhost:5173/app/v2/decision

# Enable comparison mode
localStorage.setItem('features', JSON.stringify({ comparisonHarness: true }));
http://localhost:5173/app/compare/decision

# Check telemetry
window.__telemetry.getLogs();
window.__telemetry.compare('route_render', 'renderTime');
// → { v1: 145ms, v2: 98ms, delta: -47ms } ✅
```

---

## Help

**Questions?**
- Read [MIGRATION.md](../../../MIGRATION.md) for full migration guide
- Read [EXAMPLE.md](./EXAMPLE.md) for complete example
- Check [BACKEND-CONTRACTS.md](../../../BACKEND-CONTRACTS.md) for API contracts

**Bug in v2?**
- File issue: `[V2] <component> — <description>`
- Prefix commit: `fix(v2): <description>`

---

**Sprint 1 Complete ✅**  
**Next:** Sprint 2 (InputFlowV2 + TheaterV2)
