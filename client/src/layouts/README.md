# Layouts — Semantic Decision Components

**Phase A: Layout System**  
**Layer:** Layouts (business logic aware)

---

## Philosophy

Layouts are **semantic components** built on primitives:

- ✅ **Architecture-first naming** — Named by business role
- ✅ **Type-safe props** — Use types from Phase B
- ✅ **FSM-aware** — Accept FSM state via props
- ✅ **Pure presentation** — No API calls (delegate to parent)
- ✅ **Design tokens only** — No raw colors or spacing

---

## Components

### DecisionTrustCluster

**Role:** Decision feed primary unit  
**Replaces:** `<BigCard />` or `<CampaignDecisionCard />`

```tsx
<DecisionTrustCluster
  campaign={campaign}
  alert={alert}
  onExecute={() => dispatch({ type: 'CONFIRM_EXECUTION' })}
  isExecuting={state.isLocked}
/>
```

**Props:**
- `campaign`: Campaign (from Phase B types)
- `alert`: Alert (from Phase B types)
- `onExecute`: Callback (FSM transition)
- `onDismiss`: Optional dismiss callback
- `isExecuting`: FSM state (boolean)

---

### MetricSignalGrid

**Role:** Trust signal visualization  
**Replaces:** `<MetricsDisplay />` or `<StatsGrid />`

```tsx
<MetricSignalGrid metrics={alert.metrics} />
```

**Props:**
- `metrics`: Metric[] (from Phase B types)

**Features:**
- Color-coded by status (danger, warning, neutral, positive)
- Trend indicators (↑ ↓ →)
- Delta + context display

---

### AlertActionPlan

**Role:** FSM execution trigger  
**Replaces:** `<ActionCard />` or `<RecommendedAction />`

```tsx
<AlertActionPlan
  actionPlan={alert.action_plan}
  onExecute={() => dispatch({ type: 'CONFIRM_EXECUTION' })}
  isExecuting={state.isLocked}
/>
```

**Props:**
- `actionPlan`: AlertActionPlan (from Phase B types)
- `onExecute`: Callback (FSM transition)
- `isExecuting`: FSM state (boolean)

**Features:**
- Status badge (PENDING, QUEUED, EXECUTING, SUCCESS, FAILED)
- Creative brief display (if present)
- Execute button (only for PENDING status)

---

### HistoricalInsight

**Role:** Trust signal (what worked before)  
**Replaces:** `<MemoryDisplay />` or `<LearningCard />`

```tsx
<HistoricalInsight
  insight={alert.historical_insight}
  memory={alert.memory}
/>
```

**Props:**
- `insight`: string (from Phase B types)
- `memory`: DecisionMemory[] (from Phase B types)

**Features:**
- Color-coded memory items (sustainable = green, failed = red)
- Impact duration display

---

### PriorityBadge

**Role:** Visual priority indicator  
**Replaces:** `<Badge color={...}>{priority}</Badge>`

```tsx
<PriorityBadge priority={alert.priority} />
```

**Props:**
- `priority`: 'HIGH' | 'MEDIUM' | 'LOW' (from Phase B types)

---

### StageBadge

**Role:** Campaign health indicator  
**Replaces:** `<StatusBadge>{stage}</StatusBadge>`

```tsx
<StageBadge stage={campaign.stage} />
```

**Props:**
- `stage`: CampaignStage (from Phase B types)

**Features:**
- Icon + label (🔻 DYING, ⚠️ FATIGUED, etc.)
- Color-coded by health

---

## Composition Example

```tsx
import { Panel, Stack } from '@/primitives';
import {
  DecisionTrustCluster,
  MetricSignalGrid,
  AlertActionPlan,
  HistoricalInsight,
} from '@/layouts';
import type { Campaign, Alert } from '@/types';

function CampaignFeed({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <Stack gap="lg">
      {campaigns.map((campaign) =>
        campaign.alerts.map((alert) => (
          <DecisionTrustCluster
            key={alert.action_id}
            campaign={campaign}
            alert={alert}
            onExecute={() => {
              // FSM transition: SUCCESS → CONFIRM_EXECUTION
              dispatch({ type: 'CONFIRM_EXECUTION' });
            }}
            isExecuting={state.view === 'API_EXECUTION'}
          />
        ))
      )}
    </Stack>
  );
}
```

---

## FSM Integration

All layout components are **FSM-aware** via props:

```tsx
// Example: DecisionTrustCluster
<DecisionTrustCluster
  campaign={campaign}
  alert={alert}
  onExecute={() => {
    // Trigger FSM transition
    dispatch({ type: 'CONFIRM_EXECUTION' });
  }}
  isExecuting={
    // FSM state → button disabled when locked
    state.view === 'API_EXECUTION' ||
    state.view === 'EXECUTION_QUEUED' ||
    state.view === 'EXECUTING'
  }
/>
```

**Flow:**
1. Component renders based on FSM state (`state.view`)
2. User clicks "Execute" → `onExecute()` callback
3. Parent dispatches FSM action: `{ type: 'CONFIRM_EXECUTION' }`
4. FSM transitions: `SUCCESS → CONFIRM_EXECUTION → API_EXECUTION`
5. Component re-renders with `isExecuting={true}` (button disabled)
6. SSE updates status → FSM transitions to `EXECUTED_SUCCESS` or `EXECUTED_FAILED`

---

## Type Safety

All components use types from Phase B:

```tsx
import type {
  Campaign,
  Alert,
  Metric,
  DecisionMemory,
  AlertActionPlan,
  CampaignStage,
} from '@/types';

// TypeScript validates props at compile time
<DecisionTrustCluster
  campaign={campaign}  // Type: Campaign
  alert={alert}        // Type: Alert
/>

// Autocomplete for nested properties
alert.metrics[0].status  // Type: 'danger' | 'warning' | 'neutral' | 'positive'
```

---

## Rules

### ✅ DO

- Use semantic names (DecisionTrustCluster, not BigCard)
- Accept FSM state via props (`isExecuting`)
- Use types from Phase B
- Delegate API calls to parent (via callbacks)
- Use design tokens exclusively

### ❌ DON'T

- Make API calls from layout components
- Manage FSM state internally
- Use raw colors or spacing values
- Name by visual appearance
- Hardcode business logic

---

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import { DecisionTrustCluster } from '@/layouts';
import { mockCampaign, mockAlert } from '@/tests/fixtures/api-fixtures';

test('renders campaign decision', () => {
  render(
    <DecisionTrustCluster
      campaign={mockCampaign}
      alert={mockAlert}
      onExecute={vi.fn()}
      isExecuting={false}
    />
  );

  expect(screen.getByText(mockCampaign.campaign_id)).toBeInTheDocument();
  expect(screen.getByText('Execute Action')).toBeInTheDocument();
});

test('disables execute button when executing', () => {
  render(
    <DecisionTrustCluster
      campaign={mockCampaign}
      alert={mockAlert}
      onExecute={vi.fn()}
      isExecuting={true}
    />
  );

  expect(screen.getByText('Executing...')).toBeDisabled();
});
```

---

**Previous:** See [primitives/README.md](../primitives/README.md) for base layout components.
