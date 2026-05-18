# Assembly Candidates 🔍

**Status:** Analysis Phase  
**Date:** 2026-05-18

---

## Identified Patterns

### 1. Decision Trust Cluster ⭐ **PRIORITY**

**Composition:**
```jsx
<VerdictBadge verdict={data.verdict} />
<div className="flex-1">
  <DecisionTitle as="h1">{data.title}</DecisionTitle>
  <div className="mt-2 flex items-center gap-3">
    <ConfidenceIndicator level={data.confidence / 100} showLabel />
    <RiskSignal severity={mapRiskLevelToSeverity(data.riskLevel)} showIcon />
  </div>
</div>
```

**Found in:**
- `DecisionFrame.jsx` (line 90-96)
- `SuccessView.jsx` (line 74-80)

**Semantic meaning:**  
The complete trust signal for an AI decision - verdict + confidence + risk + title.

**Repetition:** ✅ 2 places (identical structure)  
**Semantic independence:** ✅ "Decision Trust" is a clear business concept  
**Complexity reduction:** ✅ Reduces 4 components + layout to 1  
**Not just styling:** ✅ Encapsulates behavior (mapping, props, layout logic)

**Proposed API:**
```jsx
<DecisionTrustCluster
  verdict="scale"
  title="Scale this campaign by 40%"
  confidence={0.87}
  riskLevel="medium"
/>
```

**Benefits:**
- DRY: Changes to trust visualization happen in one place
- Semantic: Component name matches business domain
- Testable: Single component to test trust display logic
- Extensible: Can add urgency badge later without touching call sites

---

### 2. Cognitive Intake Unit (MAYBE - needs more evidence)

**Composition:**
```jsx
<InputField
  label="..."
  labelIntent="objective|constraint|context"
  hint="..."
  hintType="guidance|confidence|time|quality"
>
  <input/select/textarea />
</InputField>
```

**Found in:**
- `InputView.jsx` (used 7 times across 3 modes)

**Analysis:**
- ✅ Repetition: 7 uses
- ✅ Semantic: "Intake field with cognitive guidance"
- ⚠️ Already an assembly? InputField is already composing primitives
- ❓ Would a higher-level assembly add value?

**Verdict:** **SKIP for now.**  
InputField is already the right level. Don't create `<CognitiveIntakeUnit>` unless we find 3+ places needing the SAME field configuration.

---

### 3. Financial Impact Banner (WEAK - only 1 use so far)

**Composition:**
```jsx
<div className={cn(
  'rounded-r-xl bg-lumi-elevated p-4 flex items-start gap-3',
  'border-l-4',
  isLoss ? 'border-l-signal-kill' : 'border-l-signal-scale',
)}>
  {isLoss
    ? <TrendingDown className="w-5 h-5 text-signal-kill" />
    : <DollarSign className="w-5 h-5 text-signal-scale" />}
  <Text variant="data" intent="primary">
    {data.financialImpact}
  </Text>
</div>
```

**Found in:**
- `DecisionFrame.jsx` (line 102-114)

**Analysis:**
- ❌ Repetition: Only 1 use (needs 3+)
- ✅ Semantic: "Financial impact visualization"
- ⚠️ Might repeat when we build budget/ROI pages

**Verdict:** **WATCH.** If this pattern repeats 2+ more times, extract it. For now, leave inline.

---

### 4. Reason List (WEAK - specialized)

**Composition:**
```jsx
<ol className="space-y-2 border-l-2 border-lumi-accent/30 pl-3">
  {items.map((item, i) => (
    <li key={i} className="flex items-start gap-3">
      <span className="font-mono bg-lumi-elevated px-2 py-0.5 rounded">
        {String(i + 1).padStart(2, '0')}
      </span>
      <span>{item}</span>
    </li>
  ))}
</ol>
```

**Found in:**
- `DecisionFrame.jsx` (whyBreakdown)
- `SuccessView.jsx` (whyBreakdown)

**Analysis:**
- ⚠️ Repetition: 2 uses, but highly contextual
- ⚠️ This is closer to a "layout pattern" than a semantic assembly
- ✅ Could be `<ReasonList items={...} />`

**Verdict:** **DEFER.** If we need numbered lists in 3+ places with different contexts (not just whyBreakdown), extract. For now, this is "DecisionFrame-specific layout."

---

## Extraction Priority

| Assembly | Priority | Reason |
|---|---|---|
| **DecisionTrustCluster** | 🔴 HIGH | Used 2x, will be used in all decision UIs, clear semantic value |
| Cognitive Intake Unit | 🟢 LOW | Already have InputField, no need for another layer |
| Financial Impact Banner | 🟡 WATCH | Only 1 use, wait for repetition |
| Reason List | 🟡 DEFER | Layout pattern, not semantic assembly |

---

## Next Steps

1. ✅ Extract `DecisionTrustCluster` to `assemblies/`
2. ⏸️ Monitor Financial Impact Banner for 2nd use
3. ⏸️ Monitor Reason List for 3rd use in different context
4. 📝 Document assembly architecture rules

---

## Assembly Architecture Rules (DRAFT)

An **assembly** is:
- A composition of 3+ primitives
- Repeated in 2+ places (ideally 3+)
- Carries **domain-specific meaning** (not just layout)
- Has a stable API (props don't change per call site)

An assembly is NOT:
- A single primitive with custom props
- A layout helper (`<FlexRow>`, `<Stack>`)
- A page-specific component used once
- A wrapper that just adds margin/padding

---

## Why DecisionTrustCluster Passes

✅ **Domain semantics:** "Trust cluster" is a real concept in decision UX  
✅ **Stable API:** Same props (verdict, title, confidence, risk) everywhere  
✅ **Repetition:** Used 2x now, will be used in every decision UI we build  
✅ **Complexity reduction:** 4 components + layout + mapping → 1 call  
✅ **Not just styling:** Encapsulates business logic (risk mapping)

---

## Philosophy

> **Primitives are atoms.**  
> **Assemblies are molecules.**  
> **Pages are organisms.**
> 
> Don't skip the molecule layer.

---

Next: `ASSEMBLY-ARCHITECTURE.md`
