# MARCOM v4.1 — UI Migration Guide
**Strangler Pattern Implementation**

> **Phase:** C — Migration Infrastructure  
> **Status:** Active  
> **Last updated:** 2026-05-18

---

## Overview

We are **not** rebuilding the frontend.

We are **building an evolutionary replacement system** that allows:
- ✅ Zero-downtime deployment
- ✅ Incremental migration (route-by-route)
- ✅ Side-by-side comparison (dev harness)
- ✅ Instant rollback (feature flags)
- ✅ Production telemetry (performance metrics)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Strangler Pattern                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  OLD FRONTEND (v1)        NEW FRONTEND (v2)             │
│  ├─ /decision             ├─ /v2/decision               │
│  ├─ /input                ├─ /v2/input                  │
│  ├─ /theater              ├─ /v2/theater                │
│  └─ /settings             └─ /v2/settings               │
│         │                        │                       │
│         └────────┬───────────────┘                       │
│                  │                                       │
│          SAME BACKEND                                    │
│    (frozen contracts from                               │
│     BACKEND-CONTRACTS.md)                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Infrastructure Components

### 1. Feature Flags ([client/src/config/features.ts](client/src/config/features.ts:1))

Controls which version (v1 or v2) is active per route.

```typescript
export const features = {
  newShell: false,
  newDecisionView: false,
  newInputFlow: false,
  newTheater: false,
  newExecutionFlow: false,
  // ...
};
```

**Dev override:**
```javascript
// Enable flag in localStorage (dev only)
localStorage.setItem('features', JSON.stringify({ newDecisionView: true }));
window.location.reload();

// Or via console:
window.__features.enable('newDecisionView');
```

---

### 2. Route Isolation ([client/src/config/routes.ts](client/src/config/routes.ts:1))

Parallel route structure for v1/v2 coexistence.

```typescript
export const routes = {
  v1: {
    decision: '/decision',
    input: '/input',
  },
  v2: {
    decision: '/v2/decision',
    input: '/v2/input',
  },
};
```

**Usage:**
```tsx
import { getActiveRoute } from '@/config/routes';

// Respects feature flags automatically
const path = await getActiveRoute('decision');
// Returns '/decision' (v1) or '/v2/decision' (v2)

<Link to={path}>Go to Decision</Link>
```

---

### 3. Comparison Harness ([client/src/components/dev/ComparisonHarness.tsx](client/src/components/dev/ComparisonHarness.tsx:1))

Side-by-side rendering of v1 and v2 for visual comparison.

```tsx
import { ComparisonHarness } from '@/components/dev/ComparisonHarness';

<ComparisonHarness
  v1={<DecisionViewV1 />}
  v2={<DecisionViewV2 />}
  label="Decision View"
/>
```

**Features:**
- ✅ Split-screen layout (adjustable 25/50/75)
- ✅ Render time tracking
- ✅ Re-render counters
- ✅ Visual diff indicators

**Enable in dev:**
```javascript
window.__features.enable('comparisonHarness');
```

---

### 4. Telemetry Layer ([client/src/lib/telemetry.ts](client/src/lib/telemetry.ts:1))

Tracks migration health metrics.

```typescript
import { track } from '@/lib/telemetry';

// Track route render time
track('route_render', {
  route: '/decision',
  version: 'v2',
  renderTime: 123,
});

// Track API errors
track('api_error', {
  endpoint: '/api/campaigns/upload-csv',
  status: 500,
  message: 'Internal server error',
});
```

**Dev tools:**
```javascript
// View all events
window.__telemetry.getLogs();

// Compare v1 vs v2 performance
window.__telemetry.compare('route_render', 'renderTime');
// → { v1: 145ms, v2: 98ms, delta: -47ms }

// Get error rate
window.__telemetry.getErrorRate('api_call');
// → 2.3%
```

---

## Migration Pattern (Step-by-Step)

### Step 1: Build v2 Route

Create the new implementation in isolation:

```
client/src/pages/v2/
  ├─ DecisionViewV2.tsx      (new implementation)
  ├─ InputFlowV2.tsx
  └─ TheaterV2.tsx
```

**Rules:**
- ✅ Use semantic components (`<DecisionTrustCluster />` not `<BigCard />`)
- ✅ Follow FSM state machine strictly
- ✅ Use design tokens ONLY (no raw colors)
- ✅ Implement all loading states (`idle`, `loading`, `success`, `error`, `stale`)
- ✅ Handle all error classifications (`auth`, `network`, `platform`, `validation`)

---

### Step 2: Add v2 Route to Router

```tsx
// App.tsx
import { DecisionViewV1 } from '@/pages/DecisionView';
import { DecisionViewV2 } from '@/pages/v2/DecisionViewV2';
import { ComparisonRoute } from '@/components/dev/ComparisonHarness';

<Routes>
  {/* v1 route (existing) */}
  <Route path="/decision" element={<DecisionViewV1 />} />

  {/* v2 route (new, isolated) */}
  <Route path="/v2/decision" element={<DecisionViewV2 />} />

  {/* Comparison route (dev harness) */}
  <Route path="/compare/decision" element={
    <ComparisonRoute
      v1={<DecisionViewV1 />}
      v2={<DecisionViewV2 />}
      label="Decision View"
    />
  } />
</Routes>
```

---

### Step 3: Test in Comparison Mode

```bash
# Enable comparison harness
localStorage.setItem('features', JSON.stringify({ comparisonHarness: true }));

# Navigate to comparison route
http://localhost:5173/compare/decision
```

**Visual checklist:**
- [ ] Layout matches (spacing, alignment)
- [ ] Colors match (semantic tokens applied)
- [ ] Interactions work (buttons, forms)
- [ ] Loading states render correctly
- [ ] Error states render correctly
- [ ] FSM transitions are smooth
- [ ] No console errors

**Performance checklist:**
```javascript
window.__telemetry.compare('route_render', 'renderTime');
// v2 should be ≤ v1 render time
```

---

### Step 4: Enable Feature Flag (Soft Launch)

```javascript
// Enable v2 for `/decision` route
localStorage.setItem('features', JSON.stringify({ newDecisionView: true }));
window.location.reload();

// Now `/decision` renders DecisionViewV2
```

**Production rollout:**
1. Deploy with flag OFF (v1 stable)
2. Enable flag for internal team (staged rollout)
3. Monitor telemetry for 24-48h
4. Enable flag for 10% of users (A/B test)
5. Monitor error rate, render time, flow completion
6. Enable flag for 100% if metrics are green

---

### Step 5: Remove v1 Code

Once v2 is stable for 2+ weeks:

```bash
# Remove v1 files
rm client/src/pages/DecisionView.tsx

# Update router (remove v1 route)
<Route path="/decision" element={<DecisionViewV2 />} />

# Remove feature flag (v2 is now default)
# features.ts: delete newDecisionView flag
```

---

## Rollback Strategy

### Instant Rollback (Feature Flag)

```javascript
// Disable v2 flag → instant rollback to v1
localStorage.setItem('features', JSON.stringify({ newDecisionView: false }));
window.location.reload();
```

**Production:**
- Update `features.ts` in repo
- Deploy (v1 becomes active again)
- No data loss, no API changes

---

### Emergency Rollback (Git)

```bash
# Revert last deployment
git revert HEAD
git push origin master

# Render auto-deploys (< 2 minutes)
```

---

## Metrics to Monitor

### Performance

| Metric | Target | Measured Via |
|--------|--------|--------------|
| Route render time | ≤ v1 baseline | `telemetry.compare('route_render', 'renderTime')` |
| First Contentful Paint (FCP) | < 1.5s | Lighthouse |
| Time to Interactive (TTI) | < 3.0s | Lighthouse |
| Bundle size (gzip) | < 700KB | Vite build output |

### Reliability

| Metric | Target | Measured Via |
|--------|--------|--------------|
| Error rate | < 2% | `telemetry.getErrorRate('api_call')` |
| Flow completion rate | > 95% | Track `flow_abandoned` events |
| Auth success rate | > 98% | Track `auth_failure` events |

### User Behavior

| Metric | Target | Measured Via |
|--------|--------|--------------|
| Bounce rate | < v1 baseline | Analytics |
| Session duration | ≥ v1 baseline | Analytics |
| Feature adoption | Track new UI patterns | Telemetry |

---

## Common Pitfalls

### ❌ DON'T: Build everything then switch

```javascript
// BAD: Big-bang migration
if (features.newUI) {
  return <CompleteRewrite />;
}
return <OldApp />;
```

**Why:** High risk, hard to debug, impossible to rollback partially.

---

### ✅ DO: Migrate route-by-route

```javascript
// GOOD: Incremental migration
<Routes>
  <Route path="/decision" element={features.newDecisionView ? <V2 /> : <V1 />} />
  <Route path="/input" element={features.newInputFlow ? <V2 /> : <V1 />} />
</Routes>
```

**Why:** Low risk, easy rollback, fast feedback.

---

### ❌ DON'T: Assume backend behavior

```javascript
// BAD: Guess API shape
const data = await api.post('/campaigns/upload-csv', { csv: file });
// What if response.decisions doesn't exist?
```

**Why:** Contract violations cause runtime errors.

---

### ✅ DO: Trust BACKEND-CONTRACTS.md

```typescript
// GOOD: Type-safe API call
import { UploadCSVResponse } from '@/types/api';

const response = await api.post<UploadCSVResponse>('/campaigns/upload-csv', formData);
if (response.success) {
  // TypeScript knows decisions exists
  setDecisions(response.decisions);
}
```

**Why:** Contracts are frozen — guaranteed to match backend.

---

### ❌ DON'T: Skip loading states

```javascript
// BAD: No loading state
const data = await fetchCampaigns();
return <CampaignList data={data} />;
```

**Why:** Users see blank screen, no feedback.

---

### ✅ DO: Implement all 5 states

```javascript
// GOOD: Full state lifecycle
const [state, setState] = useState<RequestState>('idle');

useEffect(() => {
  setState('loading');
  fetchCampaigns()
    .then((data) => { setState('success'); setData(data); })
    .catch((err) => { setState('error'); setError(err); });
}, []);

if (state === 'loading') return <Spinner />;
if (state === 'error') return <ErrorBanner error={error} />;
return <CampaignList data={data} />;
```

---

### ❌ DON'T: Use raw colors

```javascript
// BAD: Hardcoded colors
<div style={{ background: '#1a1a1a', color: '#ffffff' }}>
```

**Why:** Design system violations, accessibility issues.

---

### ✅ DO: Use semantic tokens

```javascript
// GOOD: Semantic tokens
<div style={{
  background: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)',
}}>
```

---

## Example: Migrating a Route

See [client/src/pages/v2/EXAMPLE.md](client/src/pages/v2/EXAMPLE.md) for a complete example.

---

## Help & Support

**Questions?**
- Read [BACKEND-CONTRACTS.md](BACKEND-CONTRACTS.md:1) first
- Check [CLAUDE.md](CLAUDE.md:1) for codebase rules
- Ask in #eng-frontend Slack

**Bug in migration infrastructure?**
- File issue: `[MIGRATION] <description>`
- Prefix commit: `fix(migration): <description>`

---

**End of Migration Guide v1.0**
