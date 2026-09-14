# Semantic Primitive Taxonomy Freeze

> **HISTORICAL DOCUMENT — NOT CURRENT DESIGN AUTHORITY.** Superseded by `design-governance/` (authority map: `design-governance/README.md` §2, §4). Kept as evidence; unchanged apart from this notice. *(Phase 1.5 Governance Synchronization, 2026-09-14)*
**Effective Date:** 2026-05-18  
**Status:** 🔒 **FROZEN** — No new primitives without governance approval  
**Authority:** Design System Architecture Sprint 1

---

## Constitutional Declaration

This document establishes the **frozen semantic primitive taxonomy** for MARCOM v4.1.

**Purpose:** Prevent **primitive inflation** and **semantic theater** by institutionalizing:
- What primitives exist (the approved set)
- When new primitives can be added (governance rules)
- How to use existing primitives (migration guidelines)

**Enforcement:** All new primitive proposals require architecture review + 2/3 approval.

---

## The Frozen Set (7 Primitives)

### Core Layer (1)
| Primitive | Status | Purpose | Never Delete |
|-----------|--------|---------|--------------|
| `Text` | 🔒 Frozen | CVA-based rendering foundation | ✅ Core infrastructure |

### Typography Layer (5)
| Primitive | Status | Purpose | Adoption | May Evolve |
|-----------|--------|---------|----------|------------|
| `DecisionTitle` | 🔒 Frozen | Decision state headers | High (6 imports) | Props only |
| `MetricValue` | 🔒 Frozen | Numeric performance rendering | High (5 imports) | Props only |
| `SectionLabel` | 🔒 Frozen | Section/category labels | Zero | Props only |
| `BodyMuted` | 🔒 Frozen | Secondary information | Zero | Props only |
| `BodySubtle` | 🔒 Frozen | Tertiary metadata | Zero | Props only |

### Signals Layer (1)
| Primitive | Status | Purpose | Adoption | May Evolve |
|-----------|--------|---------|----------|------------|
| `VerdictBadge` | 🔒 Frozen | Business verdict state (SCALE/HOLD/KILL) | Medium (2 imports) | Props + variants |

---

## Freeze Rules

### Rule 1: No New Primitives Until 80% Adoption

**Current Adoption:** 4% (13 semantic imports / 305 raw text instances)  
**Threshold:** 80% (240/305 instances migrated)  
**Status:** 🔴 **76% below threshold** — New primitives BLOCKED

**Rationale:**  
Creating new primitives before adopting existing ones leads to **semantic entropy**:
```
❌ Forbidden Pattern (Primitive Inflation)
<HeroTitle />    ← Unused
<PageTitle />    ← Unused
<CardTitle />    ← Unused
<InsightTitle /> ← Unused
→ Result: 10 "title" primitives, none standardized
```

**Allowed:**  
✅ Complete Wave 1 migrations (Settings, LandingPage, GrowthStrategyBoard)  
✅ Document/evangelize existing unused primitives (BodyMuted, SectionLabel)  
✅ Add props/variants to existing primitives  

**Blocked:**  
❌ New typography primitives (PageTitle, CardTitle, etc.)  
❌ New util wrappers (TextWithIcon, ResponsiveText, etc.)  
❌ Duplicate semantics with different names

---

### Rule 2: New Primitive Governance Process

**If a new primitive is genuinely needed (after 80% adoption):**

#### Step 1: Proposal (RFC)
Submit design system RFC with:
- **Semantic Domain**: What "why" does this answer that others don't?
- **Token Mapping**: Which design tokens does it use? (must be distinct)
- **Visual Mockups**: Show it vs. existing primitives
- **Usage Estimates**: How many components would adopt it?
- **Duplicate Check**: Prove it's not semantically redundant

#### Step 2: Duplicate Analysis
Answer:
- Does this overlap with any existing primitive? (use SEMANTIC-DUPLICATE-ANALYSIS.md methodology)
- Could this be a variant/prop of an existing primitive instead?
- What happens if we DON'T add this? (often nothing)

#### Step 3: Approval Vote
- Requires **2/3 architecture team approval**
- Must demonstrate:
  - ✅ Distinct semantic domain
  - ✅ No visual/functional overlap
  - ✅ Estimated adoption >20 components
  - ✅ Cannot be solved with existing primitives + props

#### Step 4: Sunset Clause
- All new primitives have **90-day adoption tracking**
- If <10 imports after 90 days → **primitive is REMOVED**
- Prevents "zombie primitives" (created but never used)

---

### Rule 3: Prefer Variants Over New Primitives

**Before creating `<LargeDecisionTitle />`:**

**Ask:** Can this be `<DecisionTitle size="lg" />`?

```jsx
// ❌ Bad: New primitive for size variation
<SmallDecisionTitle>...</SmallDecisionTitle>
<DecisionTitle>...</DecisionTitle>
<LargeDecisionTitle>...</LargeDecisionTitle>

// ✅ Good: Variant prop on existing primitive
<DecisionTitle size="sm">...</DecisionTitle>
<DecisionTitle size="base">...</DecisionTitle>  // default
<DecisionTitle size="lg">...</DecisionTitle>
```

**Guidance:**  
- Size variations → `size` prop
- Color variations → `intent` prop (via CVA)
- Weight variations → `weight` prop
- **New primitive** → Only when semantic domain changes

---

### Rule 4: Deletion Protocol

**When can primitives be deleted?**

#### Sunset Conditions (all must be true):
1. ✅ Zero imports across codebase (verified by grep)
2. ✅ Semantic intent fully covered by another primitive
3. ✅ 30-day deprecation notice given
4. ✅ Codemod provided for migration (if any uses existed)

#### Deletion Checklist:
```bash
# 1. Verify zero imports
grep -rn "import.*PrimitiveName" client/src --include="*.jsx"
# → Must return zero results

# 2. Check barrel export
# Remove from client/src/components/primitives/index.js

# 3. Delete primitive file
rm client/src/components/primitives/*/PrimitiveName.jsx

# 4. Update documentation
# Remove from PRIMITIVE-INVENTORY.md, MIGRATION-MAP.md

# 5. Commit with reason
git commit -m "feat(design-system): remove unused PrimitiveName

Zero imports verified. Semantic intent covered by ExistingPrimitive.
30-day deprecation period completed."
```

---

## Migration Guidelines

### For Developers: "Which Primitive Should I Use?"

Use this decision tree:

```
START: I need to render text semantically

Q1: Is this a decision state header?
  YES → <DecisionTitle>
  NO  → Q2

Q2: Is this a numeric metric/KPI?
  YES → <MetricValue>
  NO  → Q3

Q3: Is this a section/category label?
  YES → <SectionLabel>
  NO  → Q4

Q4: Is this secondary (de-emphasized) info?
  YES → <BodyMuted>
  NO  → Q5

Q5: Is this tertiary metadata (timestamps, attribution)?
  YES → <BodySubtle>
  NO  → Q6

Q6: Is this a business state signal (SCALE/HOLD/KILL)?
  YES → <VerdictBadge>
  NO  → Q7

Q7: None of the above?
  → STOP: Use <Text variant="..." /> or propose new primitive via RFC
```

### For Designers: "Do I Need a New Primitive?"

**90% of the time:** ❌ No. Use existing primitive with props/variants.

**Ask yourself:**
1. Can I achieve this with an existing primitive + props? (usually yes)
2. Does this represent a NEW semantic domain? (usually no)
3. Will this be used in 20+ places? (usually no)

**Red Flags (primitive NOT needed):**
- "This is just a bigger/smaller version of X" → Use `size` prop
- "This is just a different color of X" → Use `intent` prop
- "This is just for one specific page" → Use inline styling or `Text` with `className`

**Green Flags (primitive MAY be needed):**
- Answers a unique "why" (new semantic domain)
- Appears in 20+ distinct usage contexts
- Cannot be expressed as variant/prop of existing primitive
- Maps to distinct design system tokens

---

## Current Taxonomy Status

### Adoption Health: 🔴 4% (Phase 1 — Stabilization)

| Phase | Adoption Target | Status | ETA |
|-------|----------------|--------|-----|
| Phase 1: Stabilization | 4% → 20% | 🟡 In Progress | Week 1 (Wave 3 completion) |
| Phase 2: Growth | 20% → 50% | ⚪ Pending | Week 2-3 (Wave 1 migration) |
| Phase 3: Maturity | 50% → 80% | ⚪ Pending | Week 4-5 (Wave 2 + automation) |
| Phase 4: Enforcement | 80% → 95% | ⚪ Pending | Week 6+ (ESLint rules) |

**Freeze Lift Condition:** 80% adoption (240/305 instances migrated)

---

## Taxonomy Evolution Roadmap

### Allowed Evolution (Without Governance)

✅ **Props/Variants on Existing Primitives**
```jsx
// Example: Adding size variants to DecisionTitle
<DecisionTitle size="sm" />   // New prop, same primitive
<DecisionTitle size="base" />
<DecisionTitle size="lg" />
```

✅ **CVA Intent Variants**
```jsx
// Example: Adding intent variants to Text
<Text intent="primary" />    // New variant, existing primitive
<Text intent="secondary" />
<Text intent="success" />
```

✅ **Documentation/Examples**
- Add usage examples to MIGRATION-MAP.md
- Create Storybook stories for unused primitives
- Write migration guides

### Requires Governance Approval

❌ **New Primitives** (any new component in `primitives/`)  
❌ **Layer Changes** (moving primitive between core/typography/signals)  
❌ **Semantic Redefinition** (changing the "why" of existing primitive)  
❌ **Deprecation** (marking primitive as obsolete without deletion)

---

## Enforcement Mechanisms

### 1. Manual Review (Current)
- All PRs touching `client/src/components/primitives/` require architecture review
- New primitive files auto-flagged in CI

### 2. Automated Enforcement (Phase 4)

#### ESLint Rule: `no-new-primitives-before-adoption`
```javascript
// Blocks new primitive files if adoption <80%
// Location: client/design-system/lint/no-new-primitives.js

module.exports = {
  create(context) {
    const filename = context.getFilename();
    if (filename.includes('/primitives/') && !existsInInventory(filename)) {
      const adoptionRate = calculateAdoptionRate();
      if (adoptionRate < 0.80) {
        context.report({
          loc: { line: 1, column: 1 },
          message: `New primitive blocked: adoption at ${adoptionRate * 100}% (need 80%). ` +
                   `See TAXONOMY-FREEZE.md for governance process.`
        });
      }
    }
  }
};
```

#### ESLint Rule: `prefer-semantic-primitives`
```javascript
// Warns on raw Tailwind text-* utilities
// Suggests semantic primitive alternatives

// Example:
<div className="text-2xl font-bold text-gray-900">Title</div>
//             ^^^^^^^^ ESLint warning: Prefer <DecisionTitle> for semantic consistency
```

---

## Appendix A: Primitive Catalog (Frozen Set)

### Core Layer

#### `Text`
**File:** `client/src/components/primitives/core/Text.jsx`  
**Purpose:** CVA-based rendering foundation  
**API:**
```jsx
<Text variant="body | label | title" intent="primary | secondary | muted">
  {children}
</Text>
```
**Status:** 🔒 Core infrastructure (never delete)  
**Evolution:** May add new variants/intents (does not count as "new primitive")

---

### Typography Layer

#### `DecisionTitle`
**File:** `client/src/components/primitives/typography/DecisionTitle.jsx`  
**Semantic Domain:** Decision state identification  
**Visual:** text-2xl font-bold text-text-primary  
**Adoption:** ✅ High (6 imports)  
**API:**
```jsx
<DecisionTitle>{children}</DecisionTitle>
```
**Future Props:** `size` variant (sm | base | lg)

---

#### `MetricValue`
**File:** `client/src/components/primitives/typography/MetricValue.jsx`  
**Semantic Domain:** Numeric performance rendering  
**Visual:** text-3xl font-extrabold text-text-primary tabular-nums  
**Adoption:** ✅ High (5 imports)  
**API:**
```jsx
<MetricValue>{children}</MetricValue>
```
**Future Props:** `format` (currency | percentage | number)

---

#### `SectionLabel`
**File:** `client/src/components/primitives/typography/SectionLabel.jsx`  
**Semantic Domain:** Section/category labels  
**Visual:** text-xs uppercase tracking-wider text-text-subtle  
**Adoption:** ⚪ Zero  
**API:**
```jsx
<SectionLabel>{children}</SectionLabel>
```
**Migration Priority:** P1 (highest demand — 40-50 estimated uses)

---

#### `BodyMuted`
**File:** `client/src/components/primitives/typography/BodyMuted.jsx`  
**Semantic Domain:** Secondary information (help text, descriptions)  
**Visual:** text-sm text-text-muted  
**Adoption:** ⚪ Zero  
**API:**
```jsx
<BodyMuted>{children}</BodyMuted>
```
**Migration Priority:** P1 (highest demand — 80-100 estimated uses)

---

#### `BodySubtle`
**File:** `client/src/components/primitives/typography/BodySubtle.jsx`  
**Semantic Domain:** Tertiary metadata (timestamps, attribution)  
**Visual:** text-sm text-text-subtle  
**Adoption:** ⚪ Zero  
**API:**
```jsx
<BodySubtle>{children}</BodySubtle>
```
**Migration Priority:** P2 (high demand — 40-50 estimated uses)

---

### Signals Layer

#### `VerdictBadge`
**File:** `client/src/components/primitives/signals/VerdictBadge.jsx`  
**Semantic Domain:** Business verdict state visualization  
**Visual:** Badge with verdict-specific color (SCALE=success, HOLD=warning, KILL=danger)  
**Registry:** `client/src/design-system/signals/signals.js`  
**Adoption:** ✅ Medium (2 imports, high semantic value)  
**API:**
```jsx
<VerdictBadge verdict="SCALE" | "HOLD" | "KILL" />
```
**Future Expansion:** Additional business states (PAUSE, TEST, OPTIMIZE)

---

## Appendix B: Forbidden Patterns

### ❌ Pattern 1: Styled Wrapper Inflation
```jsx
// DON'T create wrappers for minor style changes
export const BigTitle = ({ children }) => (
  <DecisionTitle className="text-4xl">{children}</DecisionTitle>
);

// DO add size prop to existing primitive
<DecisionTitle size="lg">{children}</DecisionTitle>
```

### ❌ Pattern 2: Page-Specific Primitives
```jsx
// DON'T create primitives for single-use cases
export const SettingsPageTitle = ...;  // Only used in Settings.jsx

// DO use existing primitive with optional className
<DecisionTitle className="mb-8">{children}</DecisionTitle>
```

### ❌ Pattern 3: Premature Abstraction
```jsx
// DON'T create primitive for 2-3 uses
// Rule: <20 estimated uses → not a primitive, just inline it

// DO wait until pattern emerges across 20+ components
```

---

## Appendix C: Governance Contact

**Architecture Team:**  
- Design System Lead: [TBD]  
- Frontend Architect: [TBD]

**RFC Submission:**  
- File: `design-system/rfcs/YYYY-MM-DD-primitive-name.md`  
- Template: `design-system/rfcs/TEMPLATE.md`

**Freeze Override Authority:**  
- Requires unanimous architecture team approval for emergency additions

---

**Status:** 🔒 **FROZEN as of 2026-05-18**  
**Next Review:** 2026-06-01 (or when 80% adoption reached)

