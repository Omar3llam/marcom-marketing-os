# MARCOM Component State Matrix
**Version 1.1 — Every component must implement all applicable states**

> Law: "No empty states" — every state has intelligent content.
> Law: Alert hierarchy must match Intelligence Grammar.

---

## State Definitions

| State ID | Description | Intelligence Grammar |
| --- | --- | --- |
| `empty` | No data yet | `pulse-dot-scale` + honest message, no fakes |
| `loading` | Fetching data | `scan-line-active` + shimmer |
| `active` | Data present, stable | `pulse-dot-scale` + muted mono |
| `danger` | KILL/HIGH alert | `pulse-dot-kill` + warm border |
| `scale` | SCALE opportunity | `scale-opportunity-edge` + green |
| `hold` | HOLD/MEDIUM | `pulse-dot-hold` + amber |
| `verified` | AI confirmed | `verified-insight` + gold border |
| `pending` | AI analyzing | `scan-line-active` + intel-pulse |
| `error` | API failure | signal-kill border + honest message |
| `locked` | Feature not enabled | muted + "initializing" language |

---

## DecisionPill (VerdictPill)

| Verdict | Background | Text | Border | Animation |
| --- | --- | --- | --- | --- |
| KILL | signal-kill-bg | signal-kill | signal-kill/25 | verdict-enter |
| HOLD | signal-hold-bg | signal-hold | signal-hold/25 | verdict-enter |
| SCALE | signal-scale-bg | signal-scale | signal-scale/25 + scale-glow | verdict-enter |
| TEST | stage-testing/10 | stage-testing | stage-testing/25 | none |
| Unknown | surface-light | dark-soft | surface-border | none |

---

## InlineBar

Renders a confidence/value bar. The `color` prop is set automatically based on `value`:

| Value | Bar color | Label color |
| --- | --- | --- |
| ≥ 80% | signal-scale | text-signal-scale |
| 55–79% | signal-hold | text-signal-hold |
| < 55% | signal-kill | text-signal-kill |

---

## CampaignsPage

| State | Visual | Notes |
| --- | --- | --- |
| `loading` | Skeleton grid (5 rows, column-matched) | `loading={true}` prop |
| `empty (no data)` | Empty state with upload CTA | `alerts.length === 0`, filter === 'All' |
| `empty (filtered)` | Empty state with clear filter CTA | `filteredAlerts.length === 0`, filter !== 'All' |
| `active` | Table + optional detail panel | Default |
| `panel-open` | Table dimmed + detail panel slide-in | `selectedId` set |

---

## ContentLab

| State | Visual | Notes |
| --- | --- | --- |
| `idle (no context)` | Left panel prompts campaign select | `contextCampaign = null` |
| `idle (with context)` | Pre-loaded campaign shown | `contextCampaign` set |
| `generating` | Progress bar fills | `phase = 'generating'` |
| `done` | 4 content blocks rendered | `phase = 'done'` |

---

## Sidebar

| State | Visual | Notes |
| --- | --- | --- |
| `expanded` | Full 268px width with labels | `collapsed = false` |
| `collapsed` | 64px icon-rail | `collapsed = true` |
| `mobile` | Fixed overlay drawer | `isMobile = true` |
| `alerts-active` | Notification badge on bell | `alertCount > 0` |

---

## InputView

| State | Visual | Notes |
| --- | --- | --- |
| `idle` | File drop zone + campaign info | Default |
| `file-selected` | File name shown, Analyze enabled | `file` set |
| `analyzing` | Disabled state + spinner | `onAnalyze` called |

---

## Governance Checklist (pre-PR)

For every new component:

- [ ] All applicable states from the matrix above are implemented
- [ ] Empty state has intelligent content (not "No data yet")
- [ ] Loading state uses scan-line-active or shimmer
- [ ] Error state uses signal-kill with honest message
- [ ] Color uses semantic token (not raw hex or gray-*)
- [ ] Typography uses role class (not text-xl font-bold)
- [ ] Animation within approved duration range
- [ ] `prefers-reduced-motion` respected
