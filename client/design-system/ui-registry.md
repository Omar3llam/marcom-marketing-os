# MARCOM UI Component Registry

> **HISTORICAL DOCUMENT — NOT CURRENT DESIGN AUTHORITY.** Superseded by `design-governance/` (authority map: `design-governance/README.md` §2, §4). Kept as evidence; unchanged apart from this notice. *(Phase 1.5 Governance Synchronization, 2026-09-14)*
**Version 1.1 — Consult before creating any new component**

> Law: Before creating a new component, check this registry.
> If a similar component exists, extend it. Don't create a duplicate.
> If you create a new component, add it here in the same PR.

---

## UI Primitives

> Note: UI primitives currently live in `/primitives.jsx` (window-global
> exports for the demo prototype). They have not yet been migrated to
> `client/src/components/ui/`.

| Component | Type | Purpose | Key Props |
|---|---|---|---|
| `VerdictPill` | component | KILL/HOLD/SCALE verdict badge | `verdict: string` |
| `PriorityPill` | component | HIGH/MEDIUM/LOW priority badge | `priority: string` |
| `StagePill` | component | Campaign stage badge | `stage: string` |
| `InlineBar` | component | Horizontal progress/value bar | `value, max, label` |
| `GlowDot` | component | Status indicator dot with glow | `color, size` |
| `LumiLoader` | component | AI analysis loading orb | `label, size` |
| `SectionLabel` | component | Uppercase section heading label | `children` |
| `MetricRow` | component | Label + value metric row | `label, value` |
| `Card` | component | Surface container with border/shadow | `children, className` |
| `Skeleton` | component | Loading skeleton placeholder | `className` |
| `useIsMobile` | hook | Responsive breakpoint detection | — |

---

## Decision Components (client/src/components/decision/)

| Component | File | Purpose | FSM State |
|---|---|---|---|
| `InputView` | InputView.jsx | CSV upload + mode select | `INPUT` |
| `TheatreView` | TheatreView.jsx | AI analysis progress | `THEATRE` |
| `SuccessView` | SuccessView.jsx | Verdict display | `SUCCESS` |
| `DecisionFrame` | DecisionFrame.jsx | Confirm + Execute wrapper | `SUCCESS` (nested) |
| `ErrorView` | ErrorView.jsx | Error state display | N/A (inline) |

---

## Layout Components (client/src/components/layout/)

| Component | File | Purpose |
|---|---|---|
| `MainLayout` | MainLayout.jsx | Sidebar + content shell |
| `Sidebar` | Sidebar.jsx | Navigation + workspace identity |
| `ContextBar` | ContextBar.jsx | Bottom context status bar |

---

## Page Components (design-system-figma/marcom-ai/project/)

| Component | File | FSM State |
| --- | --- | --- |
| `HomePage` | home.jsx | `HOME` |
| `CampaignsPage` | campaigns-page.jsx | `CAMPAIGNS` |
| `ContentLab` | content-lab.jsx | `CONTENT` |
| `GrowthPage` | growth-calendar.jsx | `GROWTH` |
| `CalendarPage` | growth-calendar.jsx | `CALENDAR` |
| `ExecutionView` | execution-view.jsx | `EXECUTION` |

---

## Decision Rules for New Components

### Before creating a new primitive

**InlineBar variants:**

- Use `InlineBar` for: simple value/max ratios (budget utilization, progress, metrics)
- ❌ Do NOT create: `ProgressBar`, `MetricBar`, `ConfidenceLine`, `ValueBar` — extend InlineBar instead

**Pill variants:**

- `VerdictPill` for: KILL/HOLD/SCALE/TEST verdict badges
- `PriorityPill` for: HIGH/MEDIUM/LOW priority badges
- `StagePill` for: DYING/FATIGUED/TESTING/STABLE/SCALING campaign stages
- ❌ Do NOT create: `AlertBadge`, `StatusTag`, `VerdictChip`, `SignalPill` — use existing pills

**Loading states:**

- `LumiLoader` for: AI analysis in progress (THEATRE state)
- `Skeleton` for: data loading placeholders (empty states)
- ❌ Do NOT create: `AISpinner`, `ThinkingLoader`, `ProcessingIcon`, `IntelLoader`

**Layout:**

- `MainLayout` is the ONLY full-page shell
- `Sidebar` is the ONLY left navigation component
- ❌ Do NOT create: `NavBar`, `TopBar`, `Header` — use existing layout

---

## Adding a New Component — Required Steps

1. **Check this registry.** If similar exists → extend it. Don't duplicate.
2. **Choose the right directory:**
   - `client/src/components/ui/` → stateless primitives (no API calls, no hooks)
   - `client/src/components/decision/` → FSM-aware views (props only, no direct API)
   - `client/src/components/layout/` → shell components (only if MainLayout insufficient)
3. **Keep primitives stateless:** No API calls. No useEffect. Props in, JSX out.
4. **Add to this registry** in the same PR (document what you built).
5. **Document states** in `component-states.md` (empty, loading, active, error, etc.).
6. **Ensure ESLint passes:** `npm run lint` (token discipline).
7. **File size limit:** UI primitives ≤ 150 lines, decision components ≤ 300 lines.

---

## Anti-Patterns (Blocked by Registry)

These components should NEVER be created:

| Forbidden Name | Reason | Use Instead |
|---|---|---|
| `InlineBar2` | Duplicate of InlineBar | Extend InlineBar with props |
| `ConfidenceLine` | Duplicate of InlineBar | Use InlineBar with label prop |
| `MetricProgress` | Duplicate of InlineBar | Use InlineBar |
| `AlertBadge` | Duplicate of pill variants | Use VerdictPill or PriorityPill |
| `StatusTag` | Duplicate of pill variants | Use StagePill |
| `VerdictChip` | Duplicate of pill variants | Use VerdictPill |
| `AISpinner` | Duplicate of LumiLoader | Use LumiLoader |
| `ThinkingLoader` | Duplicate of LumiLoader | Use LumiLoader |
| `NavBar` | Conflicts with Sidebar | Extend Sidebar |
| `TopBar` | Conflicts with layout | Use ContextBar or extend Sidebar |

---

## Component Count Summary

- UI Primitives: 10 components + 1 hook (1 file — `primitives.jsx`, pending migration)
- Decision Components: 5 components (5 files)
- Layout Components: 3 components (3 files)
- Page Components: 6 components (5 files — GrowthPage and CalendarPage share `growth-calendar.jsx`)
- **Total: 24 components + 1 hook across 14 files**

Last updated: 2026-06-04
