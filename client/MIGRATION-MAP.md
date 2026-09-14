# MARCOM Design System — Legacy → Semantic Migration Map

> **HISTORICAL DOCUMENT — NOT CURRENT DESIGN AUTHORITY.** Superseded by `design-governance/` (authority map: `design-governance/README.md` §2, §4). Kept as evidence; unchanged apart from this notice. *(Phase 1.5 Governance Synchronization, 2026-09-14)*

**Purpose:** Human-readable contract for automated migration (codemods, AST transforms, AI-assisted refactors).

**Status:** Active governance — enforced by ESLint `marcom-ds/no-generic-tailwind` rule.

**Last updated:** 2026-05-18 (post-VerdictBadge migration)

---

## Philosophy

This map documents the **semantic intent** behind utility classes, not just their replacement.

| Old Pattern | New Pattern | Reason |
|-------------|-------------|--------|
| `bg-gray-950` | `bg-surface-dark` | **Surface semantics** — dark background surfaces |
| `text-xl` | `<DecisionTitle>` | **Typography role** — not size, but purpose |
| `text-green-600` | `text-signal-scale` | **Signal semantics** — state, not color |

---

## Typography Migration

### Atomic Replacements

| Legacy Utility | Semantic Primitive | CSS Class | Use Case |
|----------------|-------------------|-----------|----------|
| `text-xl` | `<DecisionTitle>` | `.decision-title` | Headlines, section titles, decision names |
| `text-2xl`, `text-3xl` | `<MetricValue>` | `.metric-display` | Large numbers, ROAS, CPA, scores |
| `text-sm uppercase tracking-wide` | `<SectionLabel>` | `.section-label` | Card headers, group labels |
| `text-gray-400`, `text-sm` | `<BodyMuted>` | `.body-muted` | Secondary body text, helper text |
| `text-gray-500`, `text-xs` | `<BodySubtle>` | `.body-subtle` | Tertiary text, disclaimers, footnotes |

### API Examples

```jsx
// ❌ Before: CSS governance
<h1 className="font-display font-bold text-xl text-lumi-text">
  Campaign Performance
</h1>

// ✅ After: API governance
<DecisionTitle as="h1" className="text-lumi-text">
  Campaign Performance
</DecisionTitle>
```

```jsx
// ❌ Before
<div className="font-display font-bold text-2xl text-lumi-text tabular-nums">
  {confidence}%
</div>

// ✅ After
<MetricValue as="div" className="text-lumi-text tabular-nums">
  {confidence}%
</MetricValue>
```

**Why primitives over utilities?**
- Semantic intent explicit in component name
- Polymorphic `as` prop enables correct HTML structure
- Refactor-proof: change token → updates all primitives
- Autocomplete-driven DX: discover semantic options, not 1000 utilities

---

## State & Signal Migration

### Composite Replacements

| Legacy Pattern | Semantic Primitive | Signals Registry | Use Case |
|----------------|-------------------|------------------|----------|
| `bg-green-500 text-green-600 border-green-*` | `<VerdictBadge verdict="SCALE" />` | `SIGNALS.SCALE` | Verdict capsules |
| `bg-red-500 text-red-600 border-red-*` | `<VerdictBadge verdict="KILL" />` | `SIGNALS.KILL` | Kill/decline states |
| `bg-yellow-500 text-yellow-600 border-yellow-*` | `<VerdictBadge verdict="HOLD" />` | `SIGNALS.HOLD` | Hold/warning states |

### Signals Registry

Location: `client/src/design-system/signals/signals.js`

```js
export const SIGNALS = {
  SCALE: {
    surface: 'bg-signal-scale-bg',
    text:    'text-signal-scale',
    border:  'border-signal-scale/30',
    glow:    'shadow-scale-glow',
  },
  // ... KILL, HOLD, OPTIMIZE, WARNING, SUCCESS, DANGER
};
```

**Why signals registry?**
- **Single source of truth** for state → token mapping
- **Decouples business logic** (SCALE, KILL) from design (green, red)
- **Enables bulk updates:** change `SIGNALS.SCALE.text` → updates all scale badges
- **Type-safe** (future): TypeScript autocomplete for valid verdicts

### API Example

```jsx
// ❌ Before: Hardcoded state styling
<div className="inline-flex items-center gap-2 rounded-2xl border px-6 py-3 font-display font-bold text-xl text-signal-scale bg-signal-scale-bg border-signal-scale/30 shadow-scale-glow">
  SCALE
</div>

// ✅ After: State primitive
<VerdictBadge verdict="SCALE" />
```

**Why composite primitives?**
- Verdict badges encode **STATE**, not just typography
- Bundle: color, surface, border, glow, typography as **semantic unit**
- Developer thinks in **domain language** (SCALE, KILL), not visual attributes

---

## Surface & Layout Migration

| Legacy Utility | Semantic Token | CSS Class | Use Case |
|----------------|----------------|-----------|----------|
| `bg-gray-950` | `bg-surface-dark` | N/A | Loading screens, dark mode backgrounds |
| `bg-gray-900` | `bg-surface-card` | N/A | Card surfaces, elevated panels |
| `text-gray-400` | `text-dark-soft` | N/A | Muted text on dark surfaces |
| `text-gray-500` | `text-dark-subtle` | N/A | Tertiary text on dark surfaces |

```jsx
// ❌ Before
<div className="bg-gray-950 text-gray-400">
  Loading workspace…
</div>

// ✅ After
<div className="bg-surface-dark text-dark-soft">
  Loading workspace…
</div>
```

---

## Codemod Patterns (Future)

### Pattern 1: Atomic Typography

```js
// AST transform: text-xl → <DecisionTitle>
{
  find: 'h1[className*="text-xl"]',
  replace: (node) => {
    const className = node.className.replace(/text-xl/, '');
    return `<DecisionTitle as="h1" className="${className}">${node.children}</DecisionTitle>`;
  },
}
```

### Pattern 2: Composite State Components

```js
// AST transform: inline verdict badge → <VerdictBadge>
{
  find: 'div[className*="text-xl"][className*="bg-signal-"]',
  replace: (node) => {
    const verdict = extractVerdictFromClassName(node.className);
    return `<VerdictBadge verdict="${verdict}">${node.children}</VerdictBadge>`;
  },
}
```

---

## Migration Status

| Category | Total Violations | Migrated | Remaining |
|----------|------------------|----------|-----------|
| **Typography (atomic)** | 13 | 11 | 2 |
| **State (composite)** | 2 | 2 | 0 |
| **Surfaces** | 4 | 4 | 0 |
| **Raw hex colors** | 1 | 0 | 1 |
| **Dead files deleted** | 2 | 2 | 0 |
| **TOTAL** | 22 | 19 | 3 |

**Completion:** 86% (19/22)

### Remaining Work (8 violations in lazy-loaded pages)

1. [CampaignAnalysis.jsx](src/pages/CampaignAnalysis.jsx) — 2 violations (text-2xl, text-3xl)
2. [GrowthStrategyBoard.jsx](src/pages/GrowthStrategyBoard.jsx) — 2 violations (text-2xl)
3. [LandingPage.jsx](src/pages/LandingPage.jsx) — 2 violations (text-3xl)
4. [OnboardingPage.jsx](src/pages/OnboardingPage.jsx) — 2 violations (raw hex, text-2xl)

**Strategy:** Batch migration in Sprint 2 after taxonomy freeze.

---

## Exempted Files

These files are **intentionally** exempt from lint enforcement:

| File | Reason |
|------|--------|
| `ErrorBoundary.jsx` | Dark mode error screen — gray palette is design decision |
| `VerdictBadge.jsx` | Composite state primitive — hardcoded utilities are implementation detail |

**Exemption criteria:**
- Primitive implementation files (encapsulate utilities internally)
- Intentional design decisions with documented rationale

---

## Taxonomy Freeze (Post-Sprint 1)

**Current primitives (STABLE):**
- `<DecisionTitle>` — Headlines, section titles
- `<MetricValue>` — Large numbers, metrics
- `<SectionLabel>` — Card headers, labels
- `<BodyMuted>` — Secondary body text
- `<BodySubtle>` — Tertiary text
- `<VerdictBadge>` — State capsules (SCALE, KILL, HOLD, etc.)

**Do NOT add new primitives** until:
1. Existing 8 violations are migrated
2. Usage patterns stabilize across codebase
3. Codemod automation is implemented

**Why freeze?**
- Prevents **taxonomy creep** (death of design systems)
- Forces **semantic clarity** before expanding
- Enables **codemod confidence** (stable targets)

---

## Next Phase: CVA Integration

After taxonomy freeze, introduce **variant system** via `class-variance-authority`:

```jsx
// Future: Variant-driven primitives
const decisionTitle = cva('decision-title', {
  variants: {
    hierarchy: {
      primary:   'text-dark-base',
      secondary: 'text-dark-soft',
    },
    size: {
      default: 'text-xl',
      large:   'text-2xl',
    },
  },
});

<DecisionTitle hierarchy="primary" size="large">
  Campaign Analysis
</DecisionTitle>
```

**Blocked on:** Taxonomy stability + Sprint 1 completion.

---

## Key Learnings

1. **Semantic intent > visual appearance** — "MetricValue" not "TextXL"
2. **API governance > CSS governance** — Components enforce semantics, not classes
3. **Composite primitives for state** — VerdictBadge bundles typography + color + surface
4. **Signals registry decouples logic** — SCALE verdict ≠ green color
5. **Freeze taxonomy early** — Quality > quantity in primitive design

---

**Next sprint:** Complete remaining 8 violations → 100% semantic coverage.
