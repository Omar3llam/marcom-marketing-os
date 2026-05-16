# MARCOM UI Component Registry
**Version 1.0 — Consult before creating any new component**

> Law: Before creating a new component, check this registry.
> If a similar component exists, extend it. Don't create a duplicate.
> If you create a new component, add it here in the same PR.

---

## UI Primitives (client/src/components/ui/)

| Component | File | Purpose | Key Props |
|---|---|---|---|
| `VerdictPill` | DecisionPill.jsx | KILL/HOLD/SCALE verdict badge | `verdict: string` |
| `PriorityPill` | DecisionPill.jsx | HIGH/MEDIUM/LOW priority badge | `priority: string` |
| `StagePill` | DecisionPill.jsx | Campaign stage badge | `stage: string` |
| `InlineBar` | InlineBar.jsx | Horizontal progress/value bar | `value, max, label` |
| `LumiLoader` | LumiLoader.jsx | AI analysis loading orb | `label, size` |
| `Skeleton` | Skeleton.jsx | Loading skeleton placeholder | `className` |
| `ErrorBoundary` | ErrorBoundary.jsx | React error boundary wrapper | `children` |

---

## Decision Components (client/src/components/decision/)

| Component | File | Purpose | FSM State |
|---|---|---|---|
| `CommandCenter` | CommandCenter.jsx | War room home view | `COMMAND_CENTER` |
| `InputView` | InputView.jsx | CSV upload + mode select | `INPUT_VALIDATION` |
| `TheatreView` | TheatreView.jsx | AI analysis progress | `THEATER` |
| `SuccessView` | SuccessView.jsx | Verdict display | `SUCCESS` |
| `DecisionFrame` | DecisionFrame.jsx | Confirm + Execute wrapper | `CONFIRM/EXECUTION` |
| `ErrorView` | ErrorView.jsx | Error state display | `ERROR` |
| `DecisionBreadcrumb` | DecisionBreadcrumb.jsx | FSM navigation breadcrumb | All non-HOME |
| `MemoryPanel` | MemoryPanel.jsx | AI memory context panel | N/A (overlay) |

---

## Layout Components (client/src/components/layout/)

| Component | File | Purpose |
|---|---|---|
| `MainLayout` | MainLayout.jsx | Sidebar + content shell |
| `Sidebar` | Sidebar.jsx | Navigation + workspace identity |
| `ContextBar` | ContextBar.jsx | Bottom context status bar |

---

## Upload Components (client/src/components/upload/)

| Component | File | Purpose |
|---|---|---|
| `CsvUploader` | CsvUploader.jsx | Drag-drop CSV upload with progress |

---

## Decision Rules for New Components

### Before creating a new primitive:

**InlineBar variants:**
- Use `InlineBar` for: simple value/max ratios (budget utilization, progress, metrics)
- ❌ Do NOT create: `ProgressBar`, `MetricBar`, `ConfidenceLine`, `ValueBar` — extend InlineBar instead

**DecisionPill variants:**
- `VerdictPill` for: KILL/HOLD/SCALE/TEST verdict badges
- `PriorityPill` for: HIGH/MEDIUM/LOW priority badges
- `StagePill` for: DYING/FATIGUED/TESTING/STABLE/SCALING campaign stages
- ❌ Do NOT create: `AlertBadge`, `StatusTag`, `VerdictChip`, `SignalPill` — use existing pills

**Loading states:**
- `LumiLoader` for: AI analysis in progress (THEATER state)
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
   - `client/src/components/upload/` → file upload components
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
| `AlertBadge` | Duplicate of DecisionPill | Use VerdictPill or PriorityPill |
| `StatusTag` | Duplicate of DecisionPill | Use StagePill |
| `VerdictChip` | Duplicate of DecisionPill | Use VerdictPill |
| `AISpinner` | Duplicate of LumiLoader | Use LumiLoader |
| `ThinkingLoader` | Duplicate of LumiLoader | Use LumiLoader |
| `NavBar` | Conflicts with Sidebar | Extend Sidebar |
| `TopBar` | Conflicts with layout | Use ContextBar or extend Sidebar |

---

## Component Count Summary

- UI Primitives: 7 components (5 files — DecisionPill exports 3 variants)
- Decision Components: 8 components
- Layout Components: 3 components
- Upload Components: 1 component
- **Total: 19 components across 17 files**

Last updated: 2026-05-16 (post-architecture cleanup sprint)
