# Assembly Architecture 🏗️

> **HISTORICAL DOCUMENT — NOT CURRENT DESIGN AUTHORITY.** Superseded by `design-governance/` (authority map: `design-governance/README.md` §2, §4). Kept as evidence; unchanged apart from this notice. *(Phase 1.5 Governance Synchronization, 2026-09-14)*

**Status:** Active  
**Date:** 2026-05-18  
**Phase:** Extraction Phase (1 assembly live)

---

## What Are Assemblies?

**Assemblies are composed units of primitives that carry domain-specific meaning.**

```
Primitives (atoms) → Assemblies (molecules) → Pages (organisms)
```

### Example:

**Primitives:**
```jsx
<VerdictBadge verdict="scale" />
<DecisionTitle>Scale this campaign by 40%</DecisionTitle>
<ConfidenceIndicator level={0.87} />
<RiskSignal severity="medium" />
```

**Assembly:**
```jsx
<DecisionTrustCluster
  verdict="scale"
  title="Scale this campaign by 40%"
  confidence={87}
  riskLevel="medium"
/>
```

---

## Why Assemblies?

### Without Assemblies:
- ❌ Same 4-component pattern repeated in 5 places
- ❌ Risk mapping logic duplicated
- ❌ Layout changes require updating every call site
- ❌ No single source of truth for "decision trust UI"

### With Assemblies:
- ✅ Single component with semantic name
- ✅ Logic encapsulated (risk mapping, confidence normalization)
- ✅ Layout changes in one place
- ✅ "DecisionTrustCluster" matches business vocabulary

---

## ⚠️ CRITICAL WARNING: Molecule Explosion Risk

**After your first successful assembly, your brain will start seeing assemblies EVERYWHERE.**

This is **the most dangerous phase** of design system evolution.

### The Temptation:
```jsx
// ❌ BAD: UI-native assemblies (fake semantics)
<HeaderGroup />
<ContentBlock />
<InfoWrapper />
<FlexColumn />
<CardGroup />
```

These feel productive but create:
- **Over-abstraction:** 10 layers to understand 1 div
- **Fake semantics:** "InfoWrapper" doesn't mean anything in your business
- **Unreadable trees:** Assemblies using assemblies using assemblies

### The Discipline:
```jsx
// ✅ GOOD: Business-native assemblies
<DecisionTrustCluster />
<StrategicMomentumPanel />
<ExecutionRiskBanner />
```

These have:
- **Real semantics:** Names exist in business vocabulary
- **Domain meaning:** Stakeholders understand what they are
- **Clear boundaries:** Compose primitives, not other assemblies

---

## Assembly Creation Gate

**Same rules as primitives** (see `primitives/PRIMITIVE-FREEZE.md`), PLUS business-native test:

1. **Repetition:** Used in 2+ places (ideally 3+)
2. **Semantic Independence:** Carries domain meaning, not just layout
3. **Complexity Reduction:** Reduces cognitive load
4. **Not Just Styling:** Encapsulates behavior + meaning + style
5. **Business-Native Test (NEW):** 🔴 **MANDATORY**
   - Would a product manager recognize this name?
   - Does it appear in user research or business requirements?
   - Can you explain it without mentioning UI or layout?

---

## Current Assemblies

### 1. DecisionTrustCluster ✅

**Purpose:** Complete trust signal for AI decisions

**Composition:**
- VerdictBadge (verdict state)
- DecisionTitle (decision headline)
- ConfidenceIndicator (AI confidence)
- RiskSignal (risk assessment)

**Used in:**
- `DecisionFrame.jsx` (line 89)
- `SuccessView.jsx` (line 70)

**API:**
```jsx
<DecisionTrustCluster
  verdict="scale" | "pause" | "kill"
  title="Decision headline"
  confidence={0-100}  // auto-normalized
  riskLevel="low" | "medium" | "high"
  showConfidenceLabel={true}
  showRiskIcon={true}
/>
```

**Encapsulated logic:**
- Risk level → severity mapping (low/medium/high → low/moderate/critical)
- Confidence normalization (0-100 → 0-1)
- Layout pattern (flex + responsive)

---

## Assembly vs. Primitive

| Question | Primitive | Assembly |
|---|---|---|
| Composed of other components? | No (or 1-2 max) | Yes (3+) |
| Domain-specific? | Can be generic | **Must be domain-specific** |
| Stable API? | Yes | **Yes** |
| Used in multiple places? | Ideally 3+ | **2+ minimum** |
| Encapsulates logic? | Minimal | **Often yes** |

**Examples:**

| Component | Type | Why |
|---|---|---|
| `<VerdictBadge>` | Primitive | Single element, generic pattern |
| `<DecisionTitle>` | Primitive | Typography primitive, no composition |
| `<DecisionTrustCluster>` | Assembly | Composes 4 primitives, domain-specific |
| `<InputField>` | Primitive* | Composes 2-3, but **input grammar**, not domain assembly |

\* InputField is a "grammar primitive" — it defines the INPUT layer vocabulary, not a domain concept.

---

## When NOT to Create an Assembly

### ❌ Layout Helpers (UI-native)
```jsx
// BAD: Generic UI terms
<FlexRow gap={3}>...</FlexRow>
<HeaderGroup />
<ContentBlock />
<StackedSection />

// GOOD: Use Tailwind directly
<div className="flex gap-3">...</div>
```

**Why bad:** "FlexRow" is a CSS concept, not a business concept.

### ❌ Page-Specific One-Offs
```jsx
// BAD: Only used once in OnboardingPage
<WelcomeHero />

// GOOD: Keep inline or extract to page-level component
function OnboardingPage() {
  return <WelcomeHeroSection />  // co-located
}
```

**Why bad:** No repetition = no assembly value.

### ❌ Styling Abstractions (fake semantics)
```jsx
// BAD: Wrapper with no business meaning
<CardContainer>...</CardContainer>
<InfoWrapper>...</InfoWrapper>
<PaddedBox>...</PaddedBox>

// GOOD: Use design tokens directly
<div className="rounded-xl bg-lumi-elevated p-4">...</div>
```

**Why bad:** "CardContainer" describes appearance, not purpose.

### ❌ Generic Grouping (lazy naming)
```jsx
// BAD: Vague business meaning
<MetricsGroup />
<DataSection />
<StatsPanel />

// GOOD: Specific business semantics
<CampaignPerformanceMetrics />
<AudienceTargetingProfile />
<ROASComparisonPanel />
```

**Why bad:** "MetricsGroup" could mean anything. "CampaignPerformanceMetrics" is precise.

---

## Assembly Extraction Workflow

### 1. Identify Candidate
- Scan codebase for repeating primitive groups
- Check: Used 2+ times? Domain meaning? Stable API?
- Document in `ASSEMBLY-CANDIDATES.md`

### 2. Validate Need
- Does it pass the 5-gate rule (including business-native test)?
- Is it already handled by a primitive?
- Will it reduce complexity or just add a layer?
- **Business-native test:** Would a PM recognize this name?

### 3. Extract Assembly
```bash
# Create file
touch src/components/assemblies/MyAssembly.jsx

# Write component with:
# - Clear domain-specific name
# - Encapsulated logic
# - Stable, semantic API
# - JSDoc with types

# Export from barrel
echo "export { MyAssembly } from './MyAssembly';" >> assemblies/index.js
```

### 4. Migrate Call Sites
- Replace primitive groups with assembly
- Remove duplicated logic (mapping, normalization)
- Verify no regression (visual + behavior)

### 5. Document
- Update this file
- Add to component inventory
- Note any encapsulated logic

---

## The Business-Native Test 🎯

**MANDATORY before extraction. If any test fails → NOT an assembly.**

### 1. Recognition Test
> "Would a product manager recognize this name in a requirements doc?"

**Examples:**
- ✅ `<DecisionTrustCluster>` → "trust signals for decisions" appears in product specs
- ❌ `<HeaderGroup>` → generic UI jargon, not business vocabulary

### 2. Domain Vocabulary Test
> "Does this name exist in user research, business docs, or stakeholder vocabulary?"

**Examples:**
- ✅ `<ExecutionRiskBanner>` → "execution risk" appears in roadmap discussions
- ❌ `<InfoWrapper>` → developer vocabulary, not business vocabulary

### 3. Explanation Test
> "Can you explain this component without mentioning UI or layout?"

**Examples:**
- ✅ `<StrategicMomentumPanel>` → "Shows campaign momentum metrics that inform strategic decisions" (business explanation)
- ❌ `<ContentBlock>` → "A block that... contains content" (circular, UI-focused)

### Why DecisionTrustCluster Passes All Tests

✅ **Recognition:** Product managers say "trust signals" in requirement meetings  
✅ **Domain vocabulary:** "Trust cluster" appears in UX research notes  
✅ **Explanation:** "The complete set of trust indicators that help users evaluate AI recommendations"  
✅ **No UI words:** Explanation doesn't mention "div", "flex", "wrapper", "container"

---

## Testing Assemblies

Assemblies should have:
- **Visual tests:** Storybook stories for all variants
- **Unit tests:** Prop validation, edge cases, logic encapsulation
- **Integration tests:** Used correctly in pages

Example:
```jsx
// DecisionTrustCluster.test.jsx
describe('DecisionTrustCluster', () => {
  it('normalizes confidence from 0-100 to 0-1', () => {
    render(<DecisionTrustCluster confidence={87} ... />);
    // Assert ConfidenceIndicator receives 0.87
  });

  it('maps risk levels to severity', () => {
    render(<DecisionTrustCluster riskLevel="high" ... />);
    // Assert RiskSignal receives "critical"
  });
});
```

---

## Future Assemblies (Candidates)

**From `ASSEMBLY-CANDIDATES.md`:**

| Assembly | Priority | Reason |
|---|---|---|
| Financial Impact Banner | 🟡 WATCH | Only 1 use, wait for 2nd |
| Reason List | 🟡 DEFER | Layout pattern, not semantic |

**Red flags for new assemblies:**
- Only 1 use so far
- API changes per call site (not stable)
- No encapsulated logic (pure layout)
- Could be solved with Tailwind utilities

---

## Architecture Philosophy

> **Primitives answer: "What does this element DO?"**  
> (e.g., "This shows a confidence level")
> 
> **Assemblies answer: "What does this MEAN in our domain?"**  
> (e.g., "This is the complete trust signal for a decision")
> 
> **Pages answer: "What business problem does this solve?"**  
> (e.g., "This helps users decide whether to scale a campaign")

---

## Metrics

**Current state:**
- Primitives: 14
- Assemblies: 1
- Assembly extraction rate: 1 per sprint (healthy pace)

**Health indicators:**
- ✅ Assemblies < 10 (we're at 1)
- ✅ Each assembly used 2+ places
- ✅ No "assembly sprawl" yet

**Warning signs to watch:**
- 🚨 Assemblies > 15 (molecule explosion)
- 🚨 Assemblies used only once (premature extraction)
- 🚨 Nested assemblies (Assembly A uses Assembly B)
- 🚨 Generic names (`<DataSection>`, `<InfoGroup>`)
- 🚨 UI-native names (`<FlexRow>`, `<CardWrapper>`)
- 🚨 Names ending in `-Container`, `-Wrapper`, `-Group`, `-Block`

**Red flag naming patterns:**
```jsx
❌ <ThingGroup />      // lazy grouping
❌ <ThingWrapper />    // styling abstraction
❌ <ThingContainer />  // layout helper
❌ <ThingBlock />      // generic UI term
❌ <ThingSection />    // page structure, not domain

✅ <ThingTrustCluster />      // specific business concept
✅ <ThingPerformanceMetrics /> // domain-specific measurement
✅ <ThingExecutionRisk />      // business process element
```

---

## Next Steps

1. ✅ DecisionTrustCluster extracted and deployed
2. ⏸️ Monitor for 2nd Financial Impact Banner use
3. ⏸️ Monitor for 3rd Reason List use in different context
4. 📝 Add Storybook stories for DecisionTrustCluster
5. 🧪 Write unit tests for DecisionTrustCluster logic

---

## Related Docs

- `primitives/PRIMITIVE-FREEZE.md` - Why we froze primitive creation
- `ASSEMBLY-CANDIDATES.md` - Current candidates under evaluation
- `MARCOM-DESIGN-BIBLE.md` - Overall design system philosophy
