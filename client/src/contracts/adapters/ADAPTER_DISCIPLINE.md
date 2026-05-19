# Adapter Discipline — Preventing God Transformers

**Purpose**: Enforce architectural boundaries to prevent adapters from becoming unmaintainable "god transformers".

**Problem**: Without discipline, adapters inflate over time:
```txt
❌ BAD: Adapter does everything
API → Adapter(parsing + normalization + enrichment + business logic + analytics + presentation mapping) → Component
```

**Solution**: Strict layer separation:
```txt
✅ GOOD: Clean pipeline
API → Validation → Normalization → Domain → Presentation → Component
```

---

## The Four-Layer Discipline

### Layer 1: Validation (Adapter Responsibility)

**What it does:**
- Parse raw API response
- Validate against Zod schema
- Check contract version compatibility
- Track drift telemetry
- Return `Result<T>` (Success | Failure)

**What it NEVER does:**
- ❌ Business logic
- ❌ Computed fields
- ❌ UI formatting
- ❌ Analytics calculation
- ❌ Enrichment from other sources

**Example:**
```ts
// ✅ GOOD: Adapter validates + returns Result
export function parseLumiFeed(payload: unknown): Result<LumiFeedResponse> {
  const versionCheck = checkVersionCompatibility(payload.schemaVersion);
  if (!versionCheck.isSupported) {
    return failure(new ParsingError({ ... }));
  }

  const result = LumiFeedResponseSchema.safeParse(payload);
  if (!result.success) {
    return failure(new ParsingError({ ... }));
  }

  const normalized = normalizeLumiFeed(result.data);
  return success(normalized);
}
```

---

### Layer 2: Normalization (Adapter Helper Functions)

**What it does:**
- Apply defaults (e.g., `generatedAt || new Date()`)
- Sort collections (e.g., campaigns by priority)
- Filter empty data (e.g., campaigns with no alerts)
- Convert snake_case → camelCase (if needed)

**What it NEVER does:**
- ❌ Fetch additional data
- ❌ Calculate derived metrics
- ❌ Apply business rules
- ❌ Format for presentation

**Example:**
```ts
// ✅ GOOD: Normalization function
function normalizeLumiFeed(data: LumiFeedResponse): LumiFeedResponse {
  const generatedAt = data.generatedAt || new Date().toISOString();
  
  const sortedCampaigns = [...data.campaigns]
    .sort((a, b) => stagePriority[a.stage] - stagePriority[b.stage])
    .filter((c) => c.alerts.length > 0);

  return { ...data, generatedAt, campaigns: sortedCampaigns };
}
```

---

### Layer 3: Domain (Hook/ViewModel)

**What it does:**
- Fetch validated data from adapter
- Handle Result pattern (success/failure)
- Compute derived state (e.g., `totalAlerts = campaigns.reduce(...)`)
- Manage loading/error states
- Trigger side effects (telemetry, cache updates)

**What it NEVER does:**
- ❌ Raw API calls (use adapter)
- ❌ Schema validation (adapter's job)
- ❌ Presentation formatting (component's job)

**Example:**
```ts
// ✅ GOOD: Hook consumes adapter + adds domain logic
export function useDecisionFeed() {
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    api.get('/api/lumi/feed')
      .then(res => {
        const result = parseLumiFeed(res.data);
        if (!result.success) {
          trackContractDrift(result.error);
          setState({ status: 'error', error: result.error });
          return;
        }

        // Compute domain-level derived state
        const totalAlerts = result.data.campaigns.reduce(
          (sum, c) => sum + c.alerts.length, 0
        );

        setState({ status: 'success', data: result.data, totalAlerts });
      });
  }, []);

  return state;
}
```

---

### Layer 4: Presentation (Component)

**What it does:**
- Format data for UI (e.g., `$45.20`, `2 days ago`)
- Handle user interactions
- Render loading/error/success states
- Apply design system tokens

**What it NEVER does:**
- ❌ Validation
- ❌ Normalization
- ❌ Business logic
- ❌ API calls

**Example:**
```tsx
// ✅ GOOD: Component formats for presentation only
export function DecisionTrustCluster({ campaign, alert }) {
  return (
    <Panel>
      <h2>{campaign.campaign_name || campaign.campaign_id}</h2>
      <p>{alert.analysis.verdict}</p>
      <MetricGrid>
        {alert.metrics.map(m => (
          <MetricCard key={m.metric}>
            <span className="value">{m.value}</span> {/* Already formatted */}
            <span className="delta">{m.delta}</span>
          </MetricCard>
        ))}
      </MetricGrid>
    </Panel>
  );
}
```

---

## Forbidden Patterns

### ❌ Pattern 1: God Transformer Adapter

```ts
// ❌ BAD: Adapter does EVERYTHING
export function parseLumiFeed(payload: unknown) {
  const validated = LumiFeedResponseSchema.parse(payload);
  
  // ❌ Business logic in adapter
  const highPriorityAlerts = validated.campaigns
    .flatMap(c => c.alerts)
    .filter(a => a.priority === 'HIGH' && calculateRisk(a) > 0.7);
  
  // ❌ Enrichment in adapter
  const enrichedCampaigns = await enrichWithAdSpend(validated.campaigns);
  
  // ❌ Presentation formatting in adapter
  const formatted = enrichedCampaigns.map(c => ({
    ...c,
    displayName: `${c.campaign_name} (${c.alerts.length} alerts)`,
    lastUpdated: formatRelativeTime(c.updatedAt),
  }));
  
  // ❌ Analytics calculation in adapter
  const averageROAS = calculateAverageROAS(formatted);
  
  return { campaigns: formatted, highPriorityAlerts, averageROAS };
}
```

**Why this fails:**
- Impossible to test in isolation
- Tight coupling between layers
- Cannot reuse validation without business logic
- Cannot change formatting without revalidating
- Adapter becomes 500+ lines of spaghetti

---

### ❌ Pattern 2: Adapter Calls Other APIs

```ts
// ❌ BAD: Adapter makes side-effect API calls
export async function parseLumiFeed(payload: unknown) {
  const validated = LumiFeedResponseSchema.parse(payload);
  
  // ❌ Adapter should NOT make API calls
  const userPreferences = await api.get('/api/user/preferences');
  const enrichedCampaigns = validated.campaigns.map(c => ({
    ...c,
    isStarred: userPreferences.starredCampaigns.includes(c.campaign_id),
  }));
  
  return { ...validated, campaigns: enrichedCampaigns };
}
```

**Why this fails:**
- Parsing becomes async (breaks Result pattern)
- Network dependency in validation layer
- Impossible to parse without API access
- Breaks during offline development
- Cannot mock easily in tests

**Fix:** Move enrichment to domain hook.

---

### ❌ Pattern 3: Presentation Logic in Adapter

```ts
// ❌ BAD: Adapter formats for UI
export function parseLumiFeed(payload: unknown) {
  const validated = LumiFeedResponseSchema.parse(payload);
  
  // ❌ UI formatting belongs in component
  const campaigns = validated.campaigns.map(c => ({
    ...c,
    displayStatus: c.alerts.length > 0 ? '🔴 Needs attention' : '✅ Healthy',
    formattedDate: new Date(c.updatedAt).toLocaleDateString('en-US'),
  }));
  
  return { ...validated, campaigns };
}
```

**Why this fails:**
- Locale hardcoded in adapter
- Emoji logic coupled to validation
- Cannot change presentation without adapter change
- Breaks SSR/hydration (date formatting)

**Fix:** Move formatting to component or presentation util.

---

## Enforcing Discipline

### 1. Code Review Checklist

When reviewing adapter changes, reject if:
- [ ] Adapter makes API calls (except the one it's parsing)
- [ ] Adapter contains business logic (`if (risk > threshold)`)
- [ ] Adapter calculates analytics (`averageROAS`, `totalSpend`)
- [ ] Adapter formats for UI (`$45.20`, `2 days ago`, emojis)
- [ ] Adapter enriches from external sources
- [ ] Adapter exceeds 150 lines (sign of inflation)

---

### 2. File Size Budget

| Adapter File | Max Lines |
|-------------|-----------|
| `*.adapter.ts` | 150 |
| `*Normalize.ts` | 100 |

If exceeding budget:
1. Extract normalization to separate file
2. Move business logic to hook/service
3. Split into multiple adapters (e.g., `parseCampaign`, `parseAlert`)

---

### 3. Lint Rules (Future)

Automated enforcement via ESLint custom rules:

```js
// Proposed rules
'no-api-calls-in-adapters': 'error',
'no-business-logic-in-adapters': 'error',
'no-ui-formatting-in-adapters': 'error',
```

---

### 4. Architecture Tests

Unit tests that enforce layer boundaries:

```ts
describe('Adapter Discipline', () => {
  it('should not make API calls', () => {
    const mockFetch = vi.spyOn(global, 'fetch');
    parseLumiFeed(mockPayload);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should not contain presentation formatting', () => {
    const result = parseLumiFeed(mockPayload);
    // Verify no $, emoji, or relative time strings
    expect(JSON.stringify(result.data)).not.toMatch(/\$\d+\.\d+/);
    expect(JSON.stringify(result.data)).not.toMatch(/[🔴✅]/);
  });

  it('should complete synchronously', () => {
    const result = parseLumiFeed(mockPayload);
    expect(result).not.toBeInstanceOf(Promise);
  });
});
```

---

## Migration Guide: Deflating Existing God Transformers

If you inherit a god transformer adapter:

### Step 1: Audit Current Responsibilities

List everything the adapter does:
- ✅ Parsing
- ✅ Validation
- ✅ Normalization
- ❌ Risk calculation (business logic)
- ❌ User preference enrichment (API call)
- ❌ Currency formatting (presentation)

### Step 2: Extract Business Logic → Hook

Move risk calculation to domain hook:

```ts
// adapters/lumiFeed.adapter.ts
export function parseLumiFeed(payload: unknown): Result<LumiFeedResponse> {
  // Keep only validation + normalization
  return success(normalized);
}

// hooks/useDecisionFeed.ts
export function useDecisionFeed() {
  const result = parseLumiFeed(rawData);
  if (!result.success) return { error: result.error };

  // Move business logic here
  const highRiskAlerts = result.data.campaigns
    .flatMap(c => c.alerts)
    .filter(a => calculateRisk(a) > 0.7);

  return { data: result.data, highRiskAlerts };
}
```

### Step 3: Extract Presentation → Component

Move formatting to component:

```tsx
// Before: Adapter formatted currency
<span>{alert.formattedBudget}</span> // ❌ Came from adapter

// After: Component formats currency
<span>{formatCurrency(alert.budget)}</span> // ✅ Component util
```

### Step 4: Extract Enrichment → Separate Hook

Move API enrichment to dedicated hook:

```ts
// hooks/useCampaignEnrichment.ts
export function useCampaignEnrichment(campaigns) {
  const [enriched, setEnriched] = useState(campaigns);

  useEffect(() => {
    api.get('/api/user/preferences').then(prefs => {
      setEnriched(campaigns.map(c => ({
        ...c,
        isStarred: prefs.starredCampaigns.includes(c.campaign_id),
      })));
    });
  }, [campaigns]);

  return enriched;
}
```

---

## Summary: The Contract

**Adapters are firewalls, not factories.**

Their job:
1. ✅ Validate payloads against schema
2. ✅ Normalize data structure (sort, filter, defaults)
3. ✅ Track drift telemetry
4. ✅ Return Result<T>

Their **forbidden** territory:
1. ❌ Business logic
2. ❌ API calls (enrichment)
3. ❌ Presentation formatting
4. ❌ Analytics calculation
5. ❌ Async operations

When in doubt, ask:
> "Could I unit test this adapter with zero mocks except the raw payload?"

If the answer is no, you've crossed a boundary.

---

**Enforced by:** Code review + file size budget + architecture tests  
**Monitored by:** PR comments flagging inflation patterns  
**Escalated to:** Architecture review if adapter exceeds 200 lines
