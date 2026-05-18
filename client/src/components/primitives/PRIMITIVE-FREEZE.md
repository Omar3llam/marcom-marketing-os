# Primitive Creation Freeze 🧊

**Status:** Active  
**Date:** 2026-05-18  
**Reason:** Prevent Semantic Nesting Fatigue

---

## Why Freeze?

We've reached a healthy primitive vocabulary:

- **Typography Grammar:** DecisionTitle, MetricValue, SectionLabel, BodyMuted, BodySubtle
- **Signal Grammar:** VerdictBadge, ConfidenceIndicator, RiskSignal, UrgencyBadge, RecommendationStrength
- **Input Grammar:** InputSection, InputLabel, InputHint, InputField

**Any more primitives risk:**
- Semantic nesting fatigue (meaning spread across too many layers)
- Primitive soup (abstractions without clear purpose)
- Cognitive overhead (developers spend time choosing between 10 similar primitives)

---

## Primitive Creation Gate

**Before creating a new primitive, it MUST pass all 4 criteria:**

### 1. Repetition Test
- ✅ Used in **3+ places** across the codebase
- ❌ Only needed in 1-2 components

### 2. Semantic Independence Test
- ✅ Carries **standalone meaning** (e.g., "RiskSignal" has clear business semantics)
- ❌ Just wraps styling (e.g., "BlueButton", "LargeText")

### 3. Complexity Reduction Test
- ✅ **Reduces cognitive load** (fewer decisions for developers)
- ❌ Adds another layer to remember

### 4. Not-Just-Styling Test
- ✅ Encapsulates **behavior + meaning + style**
- ❌ Could be achieved with utility classes

---

## What to Do Instead: Assembly Architecture

**Don't create more primitives.**  
**Compose existing primitives into semantic assemblies.**

### Example: Decision Trust Cluster

Instead of:
```jsx
// Repeated in 5 places
<div>
  <VerdictBadge />
  <ConfidenceIndicator />
  <RiskSignal />
  <UrgencyBadge />
</div>
```

Extract assembly:
```jsx
<DecisionTrustCluster 
  verdict="scale"
  confidence={0.87}
  risk="medium"
  urgency={3}
/>
```

**This is the next evolution:**
```
Primitives → Assemblies → Pages
```

---

## Current Primitive Inventory

### Typography (5 primitives)
| Primitive | Purpose | Used In |
|---|---|---|
| DecisionTitle | Page/section titles with decision context | DecisionFrame, SuccessView |
| MetricValue | Numeric/monetary values | DecisionFrame, SuccessView |
| SectionLabel | Small uppercase section headers | InputView, DecisionFrame |
| BodyMuted | Secondary text | DecisionFrame, InputView |
| BodySubtle | Tertiary text | InputView, SuccessView |

### Signals (5 primitives)
| Primitive | Purpose | Used In |
|---|---|---|
| VerdictBadge | Scale/pause/kill decision state | DecisionFrame, SuccessView |
| ConfidenceIndicator | AI confidence visualization | DecisionFrame |
| RiskSignal | Risk level indicator | DecisionFrame |
| UrgencyBadge | Time-sensitivity signal | DecisionFrame |
| RecommendationStrength | Multi-level strength indicator | DecisionFrame |

### Input (4 primitives)
| Primitive | Purpose | Used In |
|---|---|---|
| InputSection | Semantic field grouping | InputView |
| InputLabel | Intent-aware labels | InputView |
| InputHint | Cognitive guidance hints | InputView |
| InputField | Complete field pattern | InputView |

**Total: 14 primitives**

---

## When Can We Unfreeze?

**Only after:**
1. Assembly architecture is established (2-3 assemblies extracted)
2. Clear boundaries exist between primitive/assembly/page
3. Team has internalized the 4-gate rule
4. We've refactored at least one "premature primitive" back into utilities

---

## Red Flags (Don't Create These)

❌ `<PrimaryButton>` - just styling  
❌ `<CardWrapper>` - layout, not semantics  
❌ `<BoldText>` - styling abstraction  
❌ `<FlexContainer>` - CSS helper  
❌ `<GreenBadge>` - color, not meaning

---

## Green Lights (These Would Pass)

✅ `<ExecutionTimeline>` - business semantics + behavior  
✅ `<ROASComparison>` - domain concept + visualization  
✅ `<AudienceProfile>` - structured data + presentation

But even these should be **assemblies**, not primitives, if they compose existing primitives.

---

## Enforcement

- **Pre-commit hook:** Block new files in `primitives/` without approval
- **PR review:** Any primitive addition requires Architecture Review
- **Lint rule:** (future) Detect primitive-like patterns outside `primitives/`

---

## Philosophy

> **Primitives are vocabulary.**  
> Too few = repetitive code.  
> Too many = semantic fatigue.  
> 
> **We're at the sweet spot. Protect it.**

---

## Next Evolution: Assembly Layer

See: `ASSEMBLY-ARCHITECTURE.md` (coming next)
