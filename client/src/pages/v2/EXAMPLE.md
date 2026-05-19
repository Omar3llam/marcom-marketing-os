# Example: Migrating DecisionView (v1 → v2)

This is a **complete, step-by-step example** of migrating a route using the Strangler Pattern.

---

## Step 1: Read the Contract

Before writing ANY code, read the backend contract for this route:

📄 [BACKEND-CONTRACTS.md — Lumi Feed](../../../BACKEND-CONTRACTS.md#2-lumi-feed-apilumi)

**Key takeaways:**
- Endpoint: `GET /api/lumi/feed`
- Auth: `requireAuth` (Firebase JWT)
- Response shape: `{ workspaceId, generatedAt, campaigns[] }`
- Campaign shape: `{ campaign_id, stage, alerts[] }`
- Alert shape: `{ action_id, priority, analysis, metrics, memory }`

---

## Step 2: Create Type Definitions

```typescript
// client/src/types/api.ts
export interface LumiFeedResponse {
  workspaceId: string;
  generatedAt: string;
  campaigns: Campaign[];
}

export interface Campaign {
  campaign_id: string;
  stage: 'DYING' | 'FATIGUED' | 'TESTING' | 'SCALING' | 'STABLE';
  alerts: Alert[];
}

export interface Alert {
  action_id: string;
  idempotency_key: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  analysis: {
    verdict: string;
    root_cause: string;
  };
  historical_insight: string | null;
  action_plan: {
    action: string;
    status: 'PENDING' | 'QUEUED' | 'EXECUTING' | 'EXECUTED_SUCCESS' | 'EXECUTED_FAILED';
    imageUrl: string | null;
    reference_prompt: string | null;
  };
  metrics: Metric[];
  memory: DecisionMemory[];
  creative_assets: any | null;
}

export interface Metric {
  metric: string;
  trend: 'up' | 'down' | 'flat';
  value: string;
  delta: string;
  context: string;
  status: 'danger' | 'warning' | 'neutral' | 'positive';
}

export interface DecisionMemory {
  actionType: string;
  decisionRationale: string;
  isSustainable: boolean | null;
  impactDurationHrs: number | null;
}
```

---

## Step 3: Create v2 Component (Semantic Architecture)

```tsx
// client/src/pages/v2/DecisionViewV2.tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { track } from '@/lib/telemetry';
import type { LumiFeedResponse, Campaign } from '@/types/api';

type RequestState = 'idle' | 'loading' | 'success' | 'error' | 'stale';

export function DecisionViewV2() {
  const [state, setState] = useState<RequestState>('idle');
  const [data, setData] = useState<LumiFeedResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Track render time
  useEffect(() => {
    const start = performance.now();
    return () => {
      const elapsed = performance.now() - start;
      track('route_render', {
        route: '/decision',
        version: 'v2',
        renderTime: elapsed,
      });
    };
  }, []);

  // Fetch feed
  useEffect(() => {
    let cancelled = false;

    async function fetchFeed() {
      setState('loading');
      track('api_call', { endpoint: '/api/lumi/feed', version: 'v2' });

      try {
        const response = await api.get<LumiFeedResponse>('/api/lumi/feed');
        if (cancelled) return;

        setData(response.data);
        setState('success');
        track('api_call', {
          endpoint: '/api/lumi/feed',
          version: 'v2',
          success: true,
          campaignCount: response.data.campaigns.length,
        });
      } catch (err: any) {
        if (cancelled) return;

        setError(err);
        setState('error');
        track('api_error', {
          endpoint: '/api/lumi/feed',
          version: 'v2',
          status: err.response?.status,
          message: err.message,
        });
      }
    }

    fetchFeed();

    return () => {
      cancelled = true;
    };
  }, []);

  // Render: Loading
  if (state === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg-primary)',
      }}>
        <div style={{
          padding: 'var(--spacing-lg)',
          textAlign: 'center',
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid var(--color-border-default)',
            borderTop: '4px solid var(--color-accent-blue)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto var(--spacing-md)',
          }} />
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Loading campaigns...
          </p>
        </div>
      </div>
    );
  }

  // Render: Error
  if (state === 'error') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg-primary)',
      }}>
        <div style={{
          maxWidth: '400px',
          padding: 'var(--spacing-lg)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-danger)',
          borderRadius: 'var(--radius-md)',
        }}>
          <h2 style={{
            color: 'var(--color-text-danger)',
            fontSize: 'var(--font-size-lg)',
            marginBottom: 'var(--spacing-sm)',
          }}>
            Failed to load campaigns
          </h2>
          <p style={{
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--spacing-md)',
          }}>
            {error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: 'var(--color-bg-accent-blue)',
              color: 'var(--color-text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Render: Success
  if (state === 'success' && data) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-lg)',
      }}>
        {/* Header */}
        <header style={{
          marginBottom: 'var(--spacing-xl)',
        }}>
          <h1 style={{
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            marginBottom: 'var(--spacing-xs)',
          }}>
            Campaign Feed
          </h1>
          <p style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}>
            {data.campaigns.length} campaigns · Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </header>

        {/* Campaign list */}
        {data.campaigns.length === 0 ? (
          <div style={{
            padding: 'var(--spacing-xl)',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}>
            No campaigns found. Upload a CSV or connect Meta Ads to get started.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gap: 'var(--spacing-md)',
          }}>
            {data.campaigns.map((campaign) => (
              <CampaignCard key={campaign.campaign_id} campaign={campaign} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Render: Idle (should not reach here)
  return null;
}

// ── Semantic Component: CampaignCard ─────────────────────────
function CampaignCard({ campaign }: { campaign: Campaign }) {
  const stageColors = {
    DYING: 'var(--color-status-danger)',
    FATIGUED: 'var(--color-status-warning)',
    TESTING: 'var(--color-status-neutral)',
    SCALING: 'var(--color-status-positive)',
    STABLE: 'var(--color-status-positive)',
  };

  return (
    <div style={{
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--spacing-lg)',
    }}>
      {/* Campaign header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--spacing-md)',
      }}>
        <h2 style={{
          fontSize: 'var(--font-size-lg)',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
        }}>
          {campaign.campaign_id}
        </h2>
        <span style={{
          padding: 'var(--spacing-xs) var(--spacing-sm)',
          background: stageColors[campaign.stage],
          color: 'var(--color-text-on-accent)',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 600,
          borderRadius: 'var(--radius-sm)',
        }}>
          {campaign.stage}
        </span>
      </div>

      {/* Alerts */}
      {campaign.alerts.map((alert) => (
        <div
          key={alert.action_id}
          style={{
            padding: 'var(--spacing-md)',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--spacing-sm)',
          }}
        >
          {/* Analysis */}
          <div style={{ marginBottom: 'var(--spacing-sm)' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {alert.analysis.verdict}
            </strong>
            <p style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              marginTop: 'var(--spacing-xs)',
            }}>
              {alert.analysis.root_cause}
            </p>
          </div>

          {/* Metrics */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 'var(--spacing-sm)',
            marginTop: 'var(--spacing-md)',
          }}>
            {alert.metrics.map((metric, idx) => (
              <div key={idx} style={{
                padding: 'var(--spacing-sm)',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)',
                  marginBottom: 'var(--spacing-xs)',
                }}>
                  {metric.metric}
                </div>
                <div style={{
                  fontSize: 'var(--font-size-lg)',
                  fontWeight: 600,
                  color: `var(--color-status-${metric.status})`,
                }}>
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Step 4: Add Route to Router

```tsx
// client/src/App.tsx
import { DecisionViewV1 } from '@/pages/DecisionView';
import { DecisionViewV2 } from '@/pages/v2/DecisionViewV2';
import { ComparisonRoute } from '@/components/dev/ComparisonHarness';

<Routes>
  {/* v1 route (existing) */}
  <Route path="/decision" element={<DecisionViewV1 />} />

  {/* v2 route (new, isolated) */}
  <Route path="/v2/decision" element={<DecisionViewV2 />} />

  {/* Comparison route (dev only) */}
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

## Step 5: Test in Dev

```bash
# Navigate to v2 route
http://localhost:5173/v2/decision

# Enable comparison mode
localStorage.setItem('features', JSON.stringify({ comparisonHarness: true }));
http://localhost:5173/compare/decision
```

**Check:**
- [ ] Data loads correctly
- [ ] Loading spinner appears
- [ ] Error state renders (test by disconnecting network)
- [ ] Campaigns render correctly
- [ ] Metrics display correctly
- [ ] Semantic tokens applied (no raw colors)

---

## Step 6: Enable Feature Flag

```javascript
// Enable v2 for /decision route
window.__features.enable('newDecisionView');
window.location.reload();

// Now /decision renders DecisionViewV2
```

---

## Step 7: Monitor Telemetry

```javascript
// Compare v1 vs v2 performance
window.__telemetry.compare('route_render', 'renderTime');
// → { v1: 145ms, v2: 98ms, delta: -47ms } ✅

// Check error rate
window.__telemetry.getErrorRate('api_call');
// → 0% ✅
```

---

## Step 8: Deploy

```bash
git add .
git commit -m "feat(ui): add DecisionView v2 (Strangler Pattern)"
git push origin master

# Render auto-deploys
# Flag is OFF by default → v1 still active in production
```

---

## Step 9: Rollout (Staged)

```javascript
// Week 1: Internal team only
if (user.role === 'ADMIN') {
  features.newDecisionView = true;
}

// Week 2: 10% of users (A/B test)
if (Math.random() < 0.1) {
  features.newDecisionView = true;
}

// Week 3: 100% (if metrics are green)
features.newDecisionView = true;
```

---

## Step 10: Remove v1 (After 2 Weeks)

```bash
# Remove v1 file
rm client/src/pages/DecisionView.tsx

# Update router
<Route path="/decision" element={<DecisionViewV2 />} />

# Remove feature flag
# features.ts: delete newDecisionView

git commit -m "chore(ui): remove DecisionView v1 (migration complete)"
```

---

**Migration complete!** 🎉

Repeat for next route: `/input`, `/theater`, `/execution`, etc.
