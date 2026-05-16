# MARCOM Component State Matrix
**Version 1.0 — Every component must implement all applicable states**

> Law: "No empty states" — every state has intelligent content.
> Law: Alert hierarchy must match Intelligence Grammar.

---

## State Definitions

| State ID | Description | Intelligence Grammar |
|---|---|---|
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

## CommandCenter

| State | Visual | Empty text |
|---|---|---|
| `empty` | GuidedPath visible, pulse-dot-scale | "Start here — your 4-step workflow" |
| `active` | RadarFeed + ActivityTicker | — |
| `danger` | pulse-dot-kill, radar-surface-active | "N campaigns bleeding" |
| `scale` | scale-opportunity-edge on hero card | — |
| `loading` | scan-line-active in radar section | — |

---

## RadarAlertCard

| State | Visual | Border |
|---|---|---|
| `kill` | pulse-dot-kill, signal-kill text | signal-kill/25 |
| `hold` | pulse-dot-hold, signal-hold text | signal-hold/25 |
| `scale` | pulse-dot-scale, signal-scale text | signal-scale/25 |
| `empty` | EmptyRadar / Intelligence Feed | surface-border |

---

## ConfidenceBar

| Value | Color | Label color |
|---|---|---|
| ≥ 80% | signal-scale | text-signal-scale |
| 55–79% | signal-hold | text-signal-hold |
| < 55% | signal-kill | text-signal-kill |

---

## DecisionPill (VerdictPill)

| Verdict | Background | Text | Border | Animation |
|---|---|---|---|---|
| KILL | signal-kill-bg | signal-kill | signal-kill/25 | verdict-enter |
| HOLD | signal-hold-bg | signal-hold | signal-hold/25 | verdict-enter |
| SCALE | signal-scale-bg | signal-scale | signal-scale/25 + scale-glow | verdict-enter |
| TEST | stage-testing/10 | stage-testing | stage-testing/25 | none |
| Unknown | surface-light | dark-soft | surface-border | none |

---

## CsvUploader

| State | Drop zone | Button | Progress |
|---|---|---|---|
| `empty` | surface-light + dashed surface-border | lumi-gold (disabled) | hidden |
| `drag-over` | lumi-gold/10 + lumi-gold/60 border | lumi-gold | hidden |
| `file-selected` | surface-card + surface-border | bg-lumi-gold (enabled) | hidden |
| `uploading` | surface-card | lumi-deep (disabled + spinner) | bg-lumi-gold fill |
| `success` | signal-scale-bg | hidden | signal-scale fill |
| `error` | signal-kill-bg | bg-lumi-gold (retry) | signal-kill fill |

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
