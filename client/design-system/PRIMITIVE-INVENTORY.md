# Semantic Primitive Inventory
**Sprint Date:** 2026-05-18  
**Audit Type:** Stabilization — Taxonomy Freeze Phase 1

---

## Executive Summary

**Total Primitives:** 7  
**Adopted Primitives:** 3 (43%)  
**Ready but Unused:** 3 (43%)  
**Core Infrastructure:** 1 (14%)

**Adoption Health:** 🟡 Medium (3/6 user-facing primitives in active use)

---

## Primitive Taxonomy

### 1. Core Layer
**Purpose:** Foundation rendering engine with CVA-based variant system

| Primitive | Type | Status | Exports | Usage |
|-----------|------|--------|---------|-------|
| `Text` | Core Renderer | ✅ Production | CVA variants | Internal (foundation for typography) |

**Files:**
- `client/src/components/primitives/core/Text.jsx`

**Semantic Domain:** Base text rendering with variant/intent support  
**Dependencies:** `class-variance-authority`, design tokens  
**Adopters:** Typography primitives (indirect)

---

### 2. Typography Layer
**Purpose:** Domain-specific text semantics (atomic rendering units)

| Primitive | Status | Adopters | Usage Count | Semantic Domain |
|-----------|--------|----------|-------------|-----------------|
| `DecisionTitle` | ✅ Active | 5 files | 6 imports | Decision state headers |
| `MetricValue` | ✅ Active | 4 files | 5 imports | Numeric performance data |
| `SectionLabel` | ⚪ Ready | 0 files | 0 imports | Section/category labels |
| `BodyMuted` | ⚪ Ready | 0 files | 0 imports | De-emphasized body text |
| `BodySubtle` | ⚪ Ready | 0 files | 0 imports | Subtle informational text |

**Active Primitives (3):**
```javascript
// DecisionTitle — adopted by 5 components
client/src/components/decision/ErrorView.jsx
client/src/components/decision/SuccessView.jsx
client/src/components/decision/DecisionFrame.jsx
client/src/components/commandcenter/HeroToolCard.jsx
client/src/pages/AuthPage.jsx

// MetricValue — adopted by 4 components
client/src/components/commandcenter/OutcomeHeader.jsx
client/src/components/decision/SuccessView.jsx
client/src/components/decision/InputView.jsx
client/src/pages/AuthPage.jsx

// VerdictBadge — adopted by 2 components (signals, not typography)
client/src/components/decision/SuccessView.jsx
client/src/components/decision/DecisionFrame.jsx
```

**Ready but Unused (3):**
- `SectionLabel` → Candidate for page section headers, tool cards
- `BodyMuted` → Candidate for help text, secondary descriptions
- `BodySubtle` → Candidate for metadata, timestamps, attribution

**Files:**
- `client/src/components/primitives/typography/*.jsx`

---

### 3. Signals Layer
**Purpose:** Business state visualization (composite semantic units)

| Primitive | Status | Adopters | Usage Count | Semantic Domain |
|-----------|--------|----------|-------------|-----------------|
| `VerdictBadge` | ✅ Active | 2 files | 2 imports | Decision verdict state (SCALE/HOLD/KILL) |

**Signal Registry:**
- `client/src/design-system/signals/signals.js` (centralized state→aesthetics)

**Semantic Mapping:**
```javascript
SCALE → success (expansion energy)
HOLD  → warning (caution stability)
KILL  → danger (suppression energy)
```

**Files:**
- `client/src/components/primitives/signals/VerdictBadge.jsx`
- `client/src/design-system/signals/signals.js`

**Adopters:**
```javascript
client/src/components/decision/SuccessView.jsx
client/src/components/decision/DecisionFrame.jsx
```

---

## Adoption Patterns

### High Adoption (5+ usages)
- ✅ `DecisionTitle` — 6 imports across decision flow + auth

### Medium Adoption (3-4 usages)
- ✅ `MetricValue` — 5 imports across metrics rendering

### Low Adoption (1-2 usages)
- ✅ `VerdictBadge` — 2 imports (but high semantic value)

### Zero Adoption (ready primitives)
- ⚪ `SectionLabel` — 0 imports
- ⚪ `BodyMuted` — 0 imports
- ⚪ `BodySubtle` — 0 imports

---

## Coverage Analysis

### Components Using Primitives (7 files)
```
✅ client/src/components/decision/DecisionFrame.jsx (2 primitives)
✅ client/src/components/decision/SuccessView.jsx (3 primitives)
✅ client/src/components/decision/ErrorView.jsx (1 primitive)
✅ client/src/components/decision/InputView.jsx (1 primitive)
✅ client/src/components/commandcenter/OutcomeHeader.jsx (1 primitive)
✅ client/src/components/commandcenter/HeroToolCard.jsx (1 primitive)
✅ client/src/pages/AuthPage.jsx (2 primitives)
```

### Total Component Count (estimated)
- **Decision Flow:** 7 components (4 migrated = 57%)
- **Command Center:** 5+ components (2 migrated = 40%)
- **Pages:** 10+ components (1 migrated = 10%)

**Global Adoption Rate:** ~15-20% (7/35+ components using semantic primitives)

---

## Semantic Duplicates Analysis

### Potential Overlaps

❌ **No duplicates detected** — each primitive has distinct semantic domain:

| Primitive | Semantic Intent | Visual Differentiation |
|-----------|----------------|------------------------|
| `DecisionTitle` | Decision state identification | Large, bold, primary |
| `MetricValue` | Numeric performance data | Emphasized, data-centric |
| `SectionLabel` | Section categorization | Small, uppercase, muted |
| `BodyMuted` | Secondary information | Regular size, muted color |
| `BodySubtle` | Tertiary metadata | Regular size, subtle color |

**Validation:** Clear semantic separation with no functional overlap.

---

## Migration Candidates

### High-Priority (legacy patterns in active components)

**1. Raw Tailwind Text in Decision Components**
```bash
# Target: client/src/components/decision/*.jsx
Grep pattern: className="text-(sm|base|lg|xl|2xl|3xl)"
Estimated: 15-20 instances
Migration: DecisionTitle, MetricValue, BodyMuted
```

**2. Generic Text in Command Center**
```bash
# Target: client/src/components/commandcenter/*.jsx
Grep pattern: className="text-.*"
Estimated: 10-15 instances
Migration: SectionLabel, MetricValue, BodySubtle
```

**3. Tool Pages (placeholder text)**
```bash
# Target: client/src/pages/tools/*.jsx
Grep pattern: className="text-"
Estimated: 8-12 instances (already partially semantic)
Migration: SectionLabel (labels), BodyMuted (descriptions)
```

### Medium-Priority (less critical paths)

**4. Auth/Landing Pages**
```bash
# Partially migrated, low touch frequency
# Wait for user-facing redesign before full migration
```

---

## Taxonomy Health

### Strengths ✅
- Clear atomic/composite separation (Text → Typography → Signals)
- No semantic duplicates or overlaps
- Centralized signal registry prevents divergence
- Strong adoption in critical decision flow components

### Risks ⚠️
- 43% of primitives unused (risk of scope creep if more added before adoption)
- Low global adoption rate (15-20%) — most components still use raw Tailwind
- No automated migration tooling yet (manual refactoring required)

### Recommendations 🎯
1. **Freeze taxonomy** — no new primitives until unused ones adopted
2. **Migration sprint** — focus on decision flow components (highest ROI)
3. **Codemod development** — automate legacy→semantic for scale
4. **Metric tracking** — monitor adoption rate weekly

---

## Next Phase Actions

**Phase 1 Complete:** ✅ Primitive inventory documented  
**Phase 2:** Measure precise adoption with grep-based coverage audit  
**Phase 3:** Identify semantic duplicates (NONE FOUND)  
**Phase 4:** Create taxonomy freeze + migration plan

---

## Appendix: Primitive API Reference

### DecisionTitle
```jsx
<DecisionTitle>Decision state header</DecisionTitle>
// → text-2xl font-bold text-text-primary
```

### MetricValue
```jsx
<MetricValue>$42,847</MetricValue>
// → text-3xl font-extrabold text-text-primary tabular-nums
```

### VerdictBadge
```jsx
<VerdictBadge verdict="SCALE" />
// → SCALE badge with success visual energy
```

### SectionLabel (unused)
```jsx
<SectionLabel>SECTION NAME</SectionLabel>
// → text-xs uppercase tracking-wider text-text-subtle
```

### BodyMuted (unused)
```jsx
<BodyMuted>Secondary information</BodyMuted>
// → text-sm text-text-muted
```

### BodySubtle (unused)
```jsx
<BodySubtle>Metadata or attribution</BodySubtle>
// → text-sm text-text-subtle
```
