# LEGACY TOKEN MIGRATION MAP

```text
Status   Phase 2 deliverable · 2026-09-14 · base 16207f6
Scope    every entry of every legacy token source the client still builds from
Rule     legacy files are NOT deleted and NO legacy value is changed in Phase 2.
         Each entry is disposed of when the last surface that uses it migrates
         (Constitution Article 37).
```

**Counts.** 341 status rows in total.

- 289 rows are source-qualified token entries: sections A–E and G, one per
  (source file, token name).
- Those rows hold 268 distinct names, because 21 `--c-*` names appear in both E
  and G.
- 52 rows (F, H, I) cover rules, classes, wiring and mechanisms.
- Measurement and meaning: PHASE_2_TOKEN_AUDIT.md, Legacy Migration.

**Current token authority:** `client/design-system/foundation/tokens/*.json`
(see `DESIGN_TOKEN_ARCHITECTURE.md`). Nothing below is current authority.

## Statuses

| Status | Meaning |
|---|---|
| **MIGRATE** | Same job. Call sites move 1:1 to the new token. The value may change, because the new palette resolves per environment. |
| **REPLACE** | The legacy entry conflated jobs, misassigned a job, or had a job the new system expresses differently. Call sites move to one of the named successors, chosen per call site by the stated rule. |
| **RETAIN** | Kept as-is. Used only for mechanisms and evidence, never for a value that new code may use. |
| **DEPRECATE** | No successor. Governance forbids the job or the entry is orphaned. It is removed when its last call site migrates. |
| **UNKNOWN** | No ruling-backed owner exists for the job, so a successor cannot be named without a product or design ruling. Not guessed. |

Tailwind class names such as `bg-signal-kill` and `text-lumi-muted` are derived from
`colors.json` keys through `client/tailwind.config.js`. They follow the row of
their key.

---

## A · `client/design-system/tokens/colors.json`

| Legacy token | Legacy value | New token | Status | Why |
|---|---|---|---|---|
| `brand.gold` | `#F6C945` | `brand.color.gold` (identity) · `color.signal.attention` (the single attention signal in a region) | REPLACE | Brand lock value `#D4A017`. Legacy uses as focus, selection, "verified" and radar have no gold successor (FC-14). |
| `brand.deep` | `#E0A800` | — | DEPRECATE | A second gold has no job (Article 12 §2). |
| `brand.glow` | `#FFD95A` | — | DEPRECATE | Glow is forbidden (Article 18). |
| `accent.warm` | `#F59E0B` | — | DEPRECATE | The brand accent that was also HOLD (audit P0-15). |
| `accent.amber` | `#FBBF24` | — | DEPRECATE | No semantic owner (Article 12 §7). |
| `surface.light` | `#F8F6F2` | `color.surface.base` | MIGRATE | The ground. |
| `surface.card` | `#FFFFFF` | `color.surface.raised` | MIGRATE | A reading region distinct from the ground. |
| `surface.border` | `#EDEAE4` | `color.border.divider` (separates) · `color.border.subtle` (outlines) | REPLACE | Chosen by function. |
| `surface.elevated` | `#F1EEE8` | — | UNKNOWN | Carries two jobs (secondary panel and hover wash) with no single owner. |
| `surface.border-strong` | `#D4CFCA` | `color.border.strong` | MIGRATE | Legacy value is 1.5 : 1 on its ground; the successor meets 3 : 1. |
| `surface.dark` | `#0F0F0F` | `color.surface.base` in `product` / `marketing-dark-section` | REPLACE | Charcoal replaces an unlocked near-black. |
| `text.base` | `#2B2B2B` | `color.text.body` | MIGRATE | `color.text.claim` is new and is assigned per grammar object. |
| `text.soft` | `#3A3A3A` | `color.text.body` | MIGRATE | No separate step. |
| `text.muted` | `#6B6B6B` | `color.text.meta` | MIGRATE | |
| `text.subtle` | `#9A9A9A` | `color.text.meta` | MIGRATE | No lighter text step exists; meta holds 4.5 : 1. |
| `blush` | `#F8B4B4` | — | DEPRECATE | Orphaned by its own `_blush_status`. |
| `signal.kill` | `#EF4444` | `color.verdict.kill.mark` | REPLACE | `#C74646` (PR-6). Uses as text have no successor (no verdict text tokens). |
| `signal.kill-bg` | `rgba(239,68,68,0.10)` | — | DEPRECATE | No verdict fills or washes (CMP-09). |
| `signal.hold` | `#F59E0B` | `color.verdict.hold.mark` | REPLACE | `#D97732` (PR-6). |
| `signal.hold-bg` | `rgba(245,158,11,0.10)` | — | DEPRECATE | As `signal.kill-bg`. |
| `signal.scale` | `#10B981` | `color.verdict.scale.mark` | REPLACE | `#3D9B6D` (PR-6). |
| `signal.scale-bg` | `rgba(16,185,129,0.10)` | — | DEPRECATE | As `signal.kill-bg`. |
| `signal.watch` | `#3B82F6` | `color.verdict.watch.mark` | REPLACE | Value unchanged; uses as text have no successor. |
| `signal.watch-bg` | `rgba(59,130,246,0.10)` | — | DEPRECATE | As `signal.kill-bg`. |
| `stage.dying` | `#EF4444` | — | UNKNOWN | Creative lifecycle stages have no colour owner. Verdict colours may not be reused for categories (CMP-09 §5). |
| `stage.fatigued` | `#F59E0B` | — | UNKNOWN | As `stage.dying`. |
| `stage.testing` | `#6366F1` | — | UNKNOWN | As `stage.dying`. |
| `stage.stable` | `#10B981` | — | UNKNOWN | As `stage.dying`. |
| `stage.scaling` | `#06B6D4` | — | UNKNOWN | As `stage.dying`. |
| `trend.danger` | `#EF4444` | — | UNKNOWN | No ruling says trend direction carries colour; generic status names are forbidden (DESIGN_TOKEN_ARCHITECTURE.md §4.3). |
| `trend.warning` | `#F59E0B` | — | UNKNOWN | As `trend.danger`. |
| `trend.positive` | `#10B981` | — | UNKNOWN | As `trend.danger`. |
| `trend.neutral` | `#8A93A4` | — | UNKNOWN | As `trend.danger`. |
| `lumi.bg` | `#F8F6F2` | `color.surface.base` | MIGRATE | |
| `lumi.surface` | `#FFFFFF` | `color.surface.raised` | MIGRATE | |
| `lumi.elevated` | `#F1EEE8` | — | UNKNOWN | As `surface.elevated`. |
| `lumi.border` | `#EDEAE4` | `color.border.divider` · `color.border.subtle` | REPLACE | Chosen by function. |
| `lumi.border-strong` | `#D4CFCA` | `color.border.strong` | MIGRATE | |
| `lumi.text` | `#2B2B2B` | `color.text.body` | MIGRATE | |
| `lumi.muted` | `#6B6B6B` | `color.text.meta` | MIGRATE | |
| `lumi.subtle` | `#9A9A9A` | `color.text.meta` | MIGRATE | |
| `lumi.accent` | `#E0A800` | `color.signal.attention` only where the call site is the region's single attention signal | UNKNOWN | Used as generic emphasis. Each call site needs review; most have no successor. |
| `lumi.accent-soft` | `#F8EBC7` | — | DEPRECATE | A gold background wash (Article 12 §2). |
| `radar.active` | `#F6C945` | — | DEPRECATE | Radar is liveness theatre (MO-8). |
| `radar.idle` | `#9A9A9A` | — | DEPRECATE | As `radar.active`. |
| `radar.critical` | `#EF4444` | — | UNKNOWN | A health claim renders only from a published value (STATE_RULES.md §16); no colour owner exists. |
| `radar.stable` | `#10B981` | — | UNKNOWN | As `radar.critical`. |
| `intel.verified` | `#F6C945` | — | UNKNOWN | "Verified" maps to no published state, and gold is not a success colour. |
| `intel.pending` | `#F59E0B` | — | UNKNOWN | Possibly PROCESSING, but "pending" is not tied to a published lifecycle here. |
| `intel.muted` | `#9A9A9A` | `color.text.meta` | MIGRATE | |
| `intel.surface` | `rgba(246,201,69,0.06)` | — | DEPRECATE | Gold wash. |
| `verdict.kill-bg` | `rgba(239,68,68,0.10)` | — | DEPRECATE | No verdict fills. |
| `verdict.hold-bg` | `rgba(245,158,11,0.10)` | — | DEPRECATE | No verdict fills. |
| `verdict.scale-bg` | `rgba(16,185,129,0.10)` | — | DEPRECATE | No verdict fills. |
| `verdict.kill-text` | `#DC2626` | — | DEPRECATE | Verdict words are neutral text (KILL is 4.02 : 1 on Charcoal). |
| `verdict.hold-text` | `#D97706` | — | DEPRECATE | As `verdict.kill-text`. |
| `verdict.scale-text` | `#059669` | — | DEPRECATE | As `verdict.kill-text`. |

## B · `client/design-system/tokens/typography.json`

| Legacy token | Legacy value | New token | Status | Why |
|---|---|---|---|---|
| `families.display` | Space Grotesk stack | `primitive.font.stack.display` via `type.display.brand` · `type.heading.surface` | MIGRATE | Same face; now restricted to two roles. |
| `families.body` | Inter stack | `primitive.font.stack.ui` via Inter roles | MIGRATE | |
| `families.mono` | JetBrains Mono stack | `primitive.font.stack.data` via `type.metric.*` · `type.technical.identifier` | MIGRATE | |
| `scale.xs` | 11px | a type role | REPLACE | Nothing renders below 12px (Article 20 §5). |
| `scale.sm` | 12px | `type.caption.default` · `type.technical.identifier` | REPLACE | Roles, not sizes. |
| `scale.base` | 14px | `type.body.default` · `type.label.default` · `type.metric.inline` | REPLACE | Roles, not sizes. |
| `scale.md` | 15px | a type role | REPLACE | No 15px step. |
| `scale.lg` | 17px | a type role | REPLACE | No 17px step. |
| `scale.xl` | 20px | `type.metric.headline` | REPLACE | Roles, not sizes. |
| `scale.2xl` | 24px | `type.heading.surface` | REPLACE | Roles, not sizes. |
| `scale.3xl` | 30px | a type role | REPLACE | No 30px step. |
| `roles.decision-title` | SG 20/700 | `type.heading.surface` (a surface or object name) · `type.body.claim` (a verdict or decision sentence) | REPLACE | Space Grotesk never sets verdict words (Article 20 §2–3). |
| `roles.metric-display` | Mono 24/600 | `type.metric.headline` | MIGRATE | |
| `roles.financial-impact` | Mono 18/700 | `type.metric.headline` | MIGRATE | Always with its window and currency (PR-12). |
| `roles.radar-label` | SG 13/600 | `type.label.default` · `type.body.default` | REPLACE | The Phase 3 attention component decides; radar vocabulary retired. |
| `roles.intel-caption` | Mono 11/400 | — | DEPRECATE | Below the floor, and its job ("Scanned 14 vectors") is narrative no published process says (MO-8). |
| `roles.system-mono` | Mono 11/500 uppercase | `type.technical.identifier` | MIGRATE | Uppercase transform not carried. |
| `roles.section-label` | SG 11/600 uppercase | `type.heading.section` | REPLACE | Inter, not Space Grotesk; no uppercase label style. |
| `roles.signal-timestamp` | Mono 10/400 | `type.caption.default` | REPLACE | Clocks are captions; 10px is below the floor. |
| `roles.verdict-number` | Mono 32/700 | `type.metric.headline` | MIGRATE | |
| `roles.command-label` | SG 12/500 | `type.label.default` | REPLACE | Navigation is Inter. |

## C · `client/design-system/tokens/spacing.json`

| Legacy token | Legacy value | New token | Status | Why |
|---|---|---|---|---|
| `scale.micro` | 4px | `space.inline` | MIGRATE | |
| `scale.dense` | 8px | `space.meta` | MIGRATE | |
| `scale.standard` | 12px | `space.meta` · `space.object` | REPLACE | No 12px tier; chosen by relationship (Article 14). |
| `scale.group` | 16px | `space.object` | MIGRATE | |
| `scale.section` | 24px | `space.section` | MIGRATE | 24 → 32. |
| `scale.zone` | 40px | `space.macro` | MIGRATE | 40 → 64. |
| `scale.page` | 48px | `layout.gutter.*` | REPLACE | Page padding becomes a responsive gutter. |
| `borderRadius.sm` | 6px | `radius.control` · `radius.container` | REPLACE | By element kind (Article 19). |
| `borderRadius.md` | 8px | `radius.control` · `radius.container` | REPLACE | By element kind. |
| `borderRadius.lg` | 12px | `radius.container` | REPLACE | No large radii. |
| `borderRadius.xl` | 16px | `radius.container` | REPLACE | No large radii. |
| `borderRadius.2xl` | 20px | `radius.container` | REPLACE | No large radii. |
| `borderRadius.pill` | 9999px | `radius.round` (round-by-meaning only) | REPLACE | No pill badges or buttons. |
| `shadows.card` | two-layer shadow | — | DEPRECATE | No shadow ladder; cards are not elevated (Article 18). |
| `shadows.card-hover` | shadow | — | DEPRECATE | As `shadows.card`. |
| `shadows.panel` | shadow | `shadow.overlay` (only if the panel floats over content) | REPLACE | A panel in the flow has no shadow. |
| `shadows.modal` | shadow | `shadow.overlay` | MIGRATE | |
| `shadows.gold-glow` | glow | — | DEPRECATE | Glow forbidden. |
| `shadows.accent-glow` | glow | — | DEPRECATE | Glow forbidden. |
| `shadows.optimize-glow` | glow | — | DEPRECATE | Glow forbidden. |
| `shadows.kill-glow` | glow | — | DEPRECATE | Glow forbidden. |
| `shadows.scale-glow` | glow | — | DEPRECATE | Glow forbidden. |
| `shadows.hold-glow` | glow | — | DEPRECATE | Glow forbidden. |
| `shadows.active-ring` | gold ring + glow | `color.interaction.focus.ring` · `size.focus.width` · `size.focus.offset` | REPLACE | The focus ring is neutral, never gold. |

## D · `client/design-system/tokens/motion.json`

| Legacy token | Legacy value | New token | Status | Why |
|---|---|---|---|---|
| `duration.instant` | 100ms | `motion.duration.feedback` | MIGRATE | |
| `duration.fast` | 150ms | `motion.duration.feedback` · `motion.duration.reveal` | REPLACE | Named by purpose (MO-1). |
| `duration.base` | 200ms | `motion.duration.reveal` · `motion.duration.transition` | REPLACE | "base" is not a purpose. |
| `duration.enter` | 320ms | `motion.duration.reveal` · `motion.duration.transition` | REPLACE | By purpose. |
| `duration.deliberate` | 400ms | `motion.duration.maximum` | REPLACE | 400ms is the ceiling, not an animation length. |
| `duration.fill` | 600ms | — | DEPRECATE | Above the ceiling; drove grow-from-zero. |
| `easing.out` | ease-out | `motion.easing.reveal` | REPLACE | Named by purpose. |
| `easing.spring` | cubic-bezier(0.16,1,0.3,1) | `motion.easing.reveal` | REPLACE | The name "spring" is retired (MO-3). |
| `easing.progress` | cubic-bezier(0.65,0.05,0.36,1) | — | DEPRECATE | Used only by a continuous sweep. |
| `easing.linear` | linear | `motion.easing.feedback` | MIGRATE | |
| `animations.fade-in` | 220ms | a Phase 3 reveal using `motion.duration.reveal` + `motion.easing.reveal` | REPLACE | Motion behaviours are declared per component (MO-9). |
| `animations.scale-in` | 200ms scale | — | DEPRECATE | Nothing scales up from nothing (MO-4 §2). |
| `animations.slide-up` | 200ms, 6px | a Phase 3 reveal using `motion.distance.settle` | REPLACE | |
| `animations.slide-right` | 200ms, 8px | — | UNKNOWN | No purpose from MO-1 can be assigned without its call sites' ruling. |
| `animations.pulse-slow` | 3s infinite | — | DEPRECATE | Continuous motion (MO-8). |
| `animations.shimmer` | 1.5s infinite | — | DEPRECATE | Skeleton shimmer (MO-8). |
| `animations.progress-sweep` | 1.6s infinite | — | DEPRECATE | Continuous motion. |
| `animations.blink` | 1.1s infinite | — | DEPRECATE | Continuous motion. |
| `animations.radar-sweep` | 2.4s infinite | — | DEPRECATE | Liveness theatre. |
| `animations.verdict-enter` | 520ms scale | — | DEPRECATE | Above the ceiling; scales the verdict. |
| `animations.intel-pulse` | 1.6s infinite | — | DEPRECATE | Continuous motion. |
| `animations.scan-line` | 1.8s infinite | — | DEPRECATE | Thinking simulation. |
| `animations.confidence-fill` | 600ms scaleX | — | DEPRECATE | Grow-from-zero (MO-4 §3). |
| `animations.step-in` | 280ms, 10px | a Phase 3 transition using `motion.duration.transition` | REPLACE | |
| `animations.fade-up` | 300ms, 8px | a Phase 3 reveal | REPLACE | |
| `animations.fade-up-delay` | 300ms + 180ms | a Phase 3 reveal with hierarchy stagger | REPLACE | Stagger follows hierarchy (MO-2 §4). |
| `animations.fade-up-late` | 300ms + 320ms | a Phase 3 reveal with hierarchy stagger | REPLACE | As above. |
| `keyframes.fade-in` | | follows `animations.fade-in` | REPLACE | |
| `keyframes.scale-in` | | — | DEPRECATE | |
| `keyframes.slide-up` | | follows `animations.slide-up` | REPLACE | |
| `keyframes.slide-right` | | — | UNKNOWN | |
| `keyframes.pulse-slow` | | — | DEPRECATE | |
| `keyframes.shimmer` | | — | DEPRECATE | |
| `keyframes.progress-sweep` | | — | DEPRECATE | |
| `keyframes.blink` | | — | DEPRECATE | |
| `keyframes.radar-sweep` | | — | DEPRECATE | |
| `keyframes.verdict-enter` | | — | DEPRECATE | |
| `keyframes.intel-pulse` | | — | DEPRECATE | |
| `keyframes.scan-line` | | — | DEPRECATE | |
| `keyframes.confidence-fill` | | — | DEPRECATE | |
| `keyframes.step-in` | | follows `animations.step-in` | REPLACE | |
| `keyframes.fade-up` | | follows `animations.fade-up` | REPLACE | |

## E · `client/src/index.css` — `:root` custom properties

| Legacy token | Legacy value | New token | Status | Why |
|---|---|---|---|---|
| `--color-brand-gold` | `#F6C945` | as `brand.gold` (A) | REPLACE | |
| `--color-brand-deep` | `#E0A800` | — | DEPRECATE | |
| `--color-brand-glow` | `#FFD95A` | — | DEPRECATE | |
| `--color-surface-light` | `#F8F6F2` | `color.surface.base` | MIGRATE | |
| `--color-surface-card` | `#FFFFFF` | `color.surface.raised` | MIGRATE | |
| `--color-surface-border` | `#EDEAE4` | `color.border.divider` · `color.border.subtle` | REPLACE | |
| `--color-surface-elevated` | `#F1EEE8` | — | UNKNOWN | |
| `--color-surface-border-strong` | `#D4CFCA` | `color.border.strong` | MIGRATE | |
| `--color-text-base` | `#2B2B2B` | `color.text.body` | MIGRATE | |
| `--color-text-soft` | `#3A3A3A` | `color.text.body` | MIGRATE | |
| `--color-text-muted` | `#6B6B6B` | `color.text.meta` | MIGRATE | |
| `--color-text-subtle` | `#9A9A9A` | `color.text.meta` | MIGRATE | |
| `--color-signal-kill-rgb` | `239 68 68` | — | DEPRECATE | A channel helper for washes. |
| `--color-signal-kill` | `rgb(239 68 68)` | `color.verdict.kill.mark` | REPLACE | |
| `--color-signal-kill-bg` | 10% wash | — | DEPRECATE | |
| `--color-signal-hold-rgb` | `245 158 11` | — | DEPRECATE | |
| `--color-signal-hold` | `rgb(245 158 11)` | `color.verdict.hold.mark` | REPLACE | |
| `--color-signal-hold-bg` | 10% wash | — | DEPRECATE | |
| `--color-signal-scale-rgb` | `16 185 129` | — | DEPRECATE | |
| `--color-signal-scale` | `rgb(16 185 129)` | `color.verdict.scale.mark` | REPLACE | |
| `--color-signal-scale-bg` | 10% wash | — | DEPRECATE | |
| `--color-stage-dying` | `#EF4444` | — | UNKNOWN | As `stage.*` (A). |
| `--color-stage-fatigued` | `#F59E0B` | — | UNKNOWN | |
| `--color-stage-testing` | `#6366F1` | — | UNKNOWN | |
| `--color-stage-stable` | `#10B981` | — | UNKNOWN | |
| `--color-stage-scaling` | `#06B6D4` | — | UNKNOWN | |
| `--color-radar-active` | `#F6C945` | — | DEPRECATE | |
| `--color-intel-verified` | `#F6C945` | — | UNKNOWN | |
| `--color-lumi-accent` | `#E0A800` | as `lumi.accent` (A) | UNKNOWN | |
| `--font-display` | Space Grotesk stack | `type.display.brand.family` · `type.heading.surface.family` | MIGRATE | |
| `--font-body` | Inter, "Noto Sans" stack | Inter role families | MIGRATE | "Noto Sans" is not carried; Arabic falls back per glyph to `system-ui`. |
| `--font-mono` | JetBrains Mono stack | mono role families | MIGRATE | |
| `--glass-bg` | `rgba(43,43,43,0.70)` | — | DEPRECATE | Glassmorphism (VISUAL_BOUNDARIES.md). |
| `--glass-blur` | 12px | — | DEPRECATE | Glassmorphism. |
| `--grid-line` | `rgba(255,255,255,0.03)` | — | DEPRECATE | Background wallpaper (Article 14 §5). |
| `--selection-bg` | gold 20% | — | UNKNOWN | No text-selection highlight role exists, and gold is not a selection colour (FC-14). |
| `--selection-text` | `var(--color-lumi-accent)` | — | UNKNOWN | As `--selection-bg`. |
| `--focus-ring` | gold 60% | `color.interaction.focus.ring` | REPLACE | Neutral, never gold. |
| `--focus-ring-width` | 3px | `size.focus.width` | REPLACE | 2px. |
| `--focus-ring-offset` | 2px | `size.focus.offset` | MIGRATE | |
| `--color-bg-primary` | `→ surface-light` | `color.surface.base` | MIGRATE | |
| `--color-bg-secondary` | `→ surface-card` | `color.surface.raised` | MIGRATE | |
| `--color-bg-tertiary` | `→ surface-elevated` | — | UNKNOWN | |
| `--color-text-primary` | `→ text-base` | `color.text.body` | MIGRATE | |
| `--color-text-secondary` | `→ text-muted` | `color.text.meta` | MIGRATE | |
| `--color-text-tertiary` | `→ text-subtle` | `color.text.meta` | MIGRATE | |
| `--color-text-on-accent` | `#FFFFFF` | — | DEPRECATE | No text on accent or verdict fills. |
| `--color-border-default` | `→ surface-border` | `color.border.divider` · `color.border.subtle` | REPLACE | |
| `--color-border-subtle` | `→ surface-border` | `color.border.subtle` | MIGRATE | |
| `--color-border-strong` | `→ border-strong` | `color.border.strong` | MIGRATE | |
| `--color-border-danger` | `→ signal-kill` | — | UNKNOWN | Form validation error is not in the locked state vocabulary, and a verdict colour may not carry it. |
| `--color-status-danger` | `#EF4444` | — | UNKNOWN | Generic status tones have no owner. |
| `--color-status-warning` | `#F59E0B` | — | UNKNOWN | |
| `--color-status-neutral` | `#8A93A4` | — | UNKNOWN | |
| `--color-status-positive` | `#10B981` | — | UNKNOWN | |
| `--color-accent-blue` | `#3B82F6` | — | DEPRECATE | Hue-named, no semantic owner (Article 12 §6–7). |
| `--color-accent-green` | `#10B981` | — | DEPRECATE | |
| `--color-accent-orange` | `#F59E0B` | — | DEPRECATE | |
| `--color-bg-accent-blue` | `#3B82F6` | — | DEPRECATE | |
| `--color-bg-accent-green` | `#10B981` | — | DEPRECATE | |
| `--color-bg-accent-orange` | `#F59E0B` | — | DEPRECATE | |
| `--spacing-xs` | 4px | `space.inline` | MIGRATE | |
| `--spacing-sm` | 8px | `space.meta` | MIGRATE | |
| `--spacing-md` | 16px | `space.object` | MIGRATE | |
| `--spacing-lg` | 24px | `space.object` · `space.section` | REPLACE | No 24px tier. |
| `--spacing-xl` | 40px | `space.section` · `space.macro` | REPLACE | No 40px tier. |
| `--radius-sm` | 6px | `radius.control` · `radius.container` | REPLACE | |
| `--radius-md` | 8px | `radius.control` · `radius.container` | REPLACE | |
| `--radius-lg` | 12px | `radius.container` | REPLACE | |
| `--shadow-sm` | card shadow | — | DEPRECATE | |
| `--shadow-md` | card-hover shadow | — | DEPRECATE | |
| `--shadow-lg` | panel shadow | `shadow.overlay` (floating only) | REPLACE | |
| `--sh-modal` | modal shadow | `shadow.overlay` | MIGRATE | |
| `--sh-optimize-glow` | glow | — | DEPRECATE | |
| `--sh-accent-glow` | glow | — | DEPRECATE | |
| `--c-trend-danger` | `#EF4444` | — | UNKNOWN | As `trend.*` (A). |
| `--c-trend-warning` | `#F59E0B` | — | UNKNOWN | |
| `--c-trend-positive` | `#10B981` | — | UNKNOWN | |
| `--c-trend-neutral` | `#8A93A4` | — | UNKNOWN | |
| `--c-intel-verified` | `#F6C945` | — | UNKNOWN | |
| `--c-intel-pending` | `#F59E0B` | — | UNKNOWN | |
| `--c-intel-muted` | `#9A9A9A` | `color.text.meta` | MIGRATE | |
| `--c-intel-surface` | gold wash | — | DEPRECATE | |
| `--c-verdict-kill-bg` | wash | — | DEPRECATE | |
| `--c-verdict-hold-bg` | wash | — | DEPRECATE | |
| `--c-verdict-scale-bg` | wash | — | DEPRECATE | |
| `--c-verdict-kill-text` | `#DC2626` | — | DEPRECATE | |
| `--c-verdict-hold-text` | `#D97706` | — | DEPRECATE | |
| `--c-verdict-scale-text` | `#059669` | — | DEPRECATE | |
| `--c-gold` | `#F6C945` | as `brand.gold` (A) | REPLACE | |
| `--c-gold-deep` | `#E0A800` | — | DEPRECATE | |
| `--c-gold-glow` | `#FFD95A` | — | DEPRECATE | |
| `--c-lumi-accent` | `#E0A800` | as `lumi.accent` (A) | UNKNOWN | |
| `--c-surface-light` | `#F8F6F2` | `color.surface.base` | MIGRATE | |
| `--c-surface-card` | `#FFFFFF` | `color.surface.raised` | MIGRATE | |
| `--c-surface-border` | `#EDEAE4` | `color.border.divider` · `color.border.subtle` | REPLACE | |
| `--c-surface-elevated` | `#F1EEE8` | — | UNKNOWN | |
| `--c-surface-border-strong` | `#D4CFCA` | `color.border.strong` | MIGRATE | |
| `--c-text-base` | `#2B2B2B` | `color.text.body` | MIGRATE | |
| `--c-text-soft` | `#3A3A3A` | `color.text.body` | MIGRATE | |
| `--c-text-muted` | `#6B6B6B` | `color.text.meta` | MIGRATE | |
| `--c-text-subtle` | `#9A9A9A` | `color.text.meta` | MIGRATE | |
| `--c-kill` | `#EF4444` | `color.verdict.kill.mark` | REPLACE | |
| `--c-kill-bg` | wash | — | DEPRECATE | |
| `--c-kill-text` | `#DC2626` | — | DEPRECATE | |
| `--c-hold` | `#F59E0B` | `color.verdict.hold.mark` | REPLACE | |
| `--c-hold-bg` | wash | — | DEPRECATE | |
| `--c-hold-text` | `#D97706` | — | DEPRECATE | |
| `--c-scale` | `#10B981` | `color.verdict.scale.mark` | REPLACE | |
| `--c-scale-bg` | wash | — | DEPRECATE | |
| `--c-scale-text` | `#059669` | — | DEPRECATE | |
| `--c-lumi-elevated` | `#F1EEE8` | — | UNKNOWN | |
| `--font-size-xs` | 11px | a type role | REPLACE | Below the floor. |
| `--font-size-sm` | 12px | a type role | REPLACE | |
| `--font-size-md` | 14px | a type role | REPLACE | |
| `--font-size-lg` | 17px | a type role | REPLACE | |
| `--font-size-xl` | 20px | a type role | REPLACE | |
| `--font-size-2xl` | 24px | a type role | REPLACE | |

## F · `client/src/index.css` — theme block, rules and classes

| Legacy entry | New token | Status | Why |
|---|---|---|---|
| `[data-theme="dark"] --c-verdict-kill-bg` | — | DEPRECATE | A theme attribute (PR-9: no theme switch) and a verdict wash. |
| `[data-theme="dark"] --c-verdict-hold-bg` | — | DEPRECATE | As above. |
| `[data-theme="dark"] --c-verdict-scale-bg` | — | DEPRECATE | As above. |
| `body { @apply bg-surface-light text-dark-base font-body }` | `color.surface.base` · `color.text.body` · `type.body.default` inside a `[data-lumi-env]` scope | REPLACE | The environment is set by the app shell (Phase 7), not globally. |
| `:focus-visible` rule (gold ring) | `color.interaction.focus.ring` · `size.focus.width` · `size.focus.offset` | REPLACE | The global focus mechanism stays; its gold does not. |
| `::selection` rule | — | UNKNOWN | As `--selection-bg`. |
| scrollbar rules | — | RETAIN | Not a token. Their colour follows `--color-surface-border-strong` until the app shell migrates. |
| `@media (prefers-reduced-motion: reduce)` global override | — | RETAIN | The MO-7 safety net; `--lumi-motion-*` also reduce themselves. |
| `.lumi-toast` | a Phase 3 announcement using `color.surface.elevated` · `color.border.subtle` · `shadow.overlay` · `layer.announcement` | REPLACE | |
| `.page-title` | `type.heading.surface` | MIGRATE | |
| `.decision-title` | as `roles.decision-title` (B) | REPLACE | |
| `.metric-display` | `type.metric.headline` | MIGRATE | |
| `.verdict-number` | `type.metric.headline` | MIGRATE | |
| `.radar-label` | as `roles.radar-label` (B) | REPLACE | |
| `.financial-impact` | `type.metric.headline` | MIGRATE | |
| `.intel-caption` | — | DEPRECATE | |
| `.section-label` | `type.heading.section` | REPLACE | |
| `.system-mono` | `type.technical.identifier` | MIGRATE | |
| `.signal-timestamp` | `type.caption.default` | REPLACE | |
| `.command-label` | `type.label.default` | REPLACE | |
| `.glass` | — | DEPRECATE | Glassmorphism. |
| `.card-flat` | an Article 17 container (Phase 3) using `color.surface.raised` · `color.border.subtle` · `radius.container` | REPLACE | Only where CMP-04 justifies a container. |
| `.card-raised` | — | DEPRECATE | Shadow ladder. |
| `.card-floating` | an overlay using `color.surface.elevated` · `shadow.overlay` | REPLACE | |
| `.grid-bg` | — | DEPRECATE | Wallpaper. |
| `.reveal` | a Phase 3 reveal | REPLACE | |
| `.reveal-delay-100` | a hierarchy stagger declared by its component | REPLACE | |
| `.reveal-delay-200` | as above | REPLACE | |
| `.reveal-delay-300` | as above | REPLACE | |
| `.anim-scale-in` | — | DEPRECATE | |
| `.anim-slide-right` | — | UNKNOWN | |
| `.anim-intel-pulse` | — | DEPRECATE | Continuous motion. |
| `.anim-data-rise` | — | DEPRECATE | 📏 Its keyframe `data-rise` is defined in no stylesheet or token file in `client/` (searched 2026-09-14), so it animates nothing today. |
| `@keyframes spin` | — | UNKNOWN | A rotating indicator is continuous motion (MO-8), but an in-flight PROCESSING indicator that ends is allowed (STATE_RULES.md §10). |

## G · `client/src/pages/demo/Operations/Operations.module.css` (local copies)

| Legacy token | New token | Status |
|---|---|---|
| `--c-gold` | as `brand.gold` (A) | REPLACE |
| `--c-gold-deep` | — | DEPRECATE |
| `--c-surface-light` | `color.surface.base` | MIGRATE |
| `--c-surface-card` | `color.surface.raised` | MIGRATE |
| `--c-surface-border` | `color.border.divider` · `color.border.subtle` | REPLACE |
| `--c-surface-elevated` | — | UNKNOWN |
| `--c-surface-border-strong` | `color.border.strong` | MIGRATE |
| `--c-text-base` | `color.text.body` | MIGRATE |
| `--c-text-soft` | `color.text.body` | MIGRATE |
| `--c-text-muted` | `color.text.meta` | MIGRATE |
| `--c-text-subtle` | `color.text.meta` | MIGRATE |
| `--c-kill` | `color.verdict.kill.mark` | REPLACE |
| `--c-kill-bg` | — | DEPRECATE |
| `--c-kill-text` | — | DEPRECATE |
| `--c-hold` | `color.verdict.hold.mark` | REPLACE |
| `--c-hold-bg` | — | DEPRECATE |
| `--c-hold-text` | — | DEPRECATE |
| `--c-scale` | `color.verdict.scale.mark` | REPLACE |
| `--c-scale-bg` | — | DEPRECATE |
| `--c-scale-text` | — | DEPRECATE |
| `--c-lumi-elevated` | — | UNKNOWN |
| `--f-display` | Space Grotesk role families | MIGRATE |
| `--f-body` | Inter role families | MIGRATE |
| `--f-mono` | mono role families | MIGRATE |
| `--sh-card` | — | DEPRECATE |
| `--sh-card-hover` | — | DEPRECATE |
| `--sh-gold-glow` | — | DEPRECATE |

## H · `client/tailwind.config.js` — inline values

| Legacy entry | New token | Status | Why |
|---|---|---|---|
| `fontFamily.display` | Space Grotesk role families | MIGRATE | |
| `fontFamily.body` | Inter role families | MIGRATE | |
| `fontFamily.mono` | mono role families | MIGRATE | |
| `fontSize.xs` | a type role | REPLACE | Duplicate of `typography.json` `scale.xs`. |
| `fontSize.sm` | a type role | REPLACE | Duplicate of `scale.sm`. |
| `fontSize.base` | a type role | REPLACE | Duplicate of `scale.base`. |
| `fontSize.md` | a type role | REPLACE | Duplicate of `scale.md`. |
| `fontSize.lg` | a type role | REPLACE | Duplicate of `scale.lg`. |
| `fontSize.xl` | a type role | REPLACE | Duplicate of `scale.xl`. |
| `fontSize.2xl` | a type role | REPLACE | Duplicate of `scale.2xl`. |
| `fontSize.3xl` | a type role | REPLACE | Duplicate of `scale.3xl`. |
| `fontVariantNumeric.tabular-nums` | `type.metric.*.numeric` | MIGRATE | |
| the `colors` / `boxShadow` / `borderRadius` / `animation` / `keyframes` wiring | — | RETAIN | Wiring for the legacy UI until its surfaces migrate. Exposing the new tokens as Tailwind utilities is a Phase 3 decision (DESIGN_TOKEN_ARCHITECTURE.md §10). |

## I · Mechanisms, consumers and historical copies

| Entry | Status | Why |
|---|---|---|
| `client/design-system/lint/no-generic-tailwind.js` | RETAIN | Checks legacy class names. It is re-pointed when the first surface consumes `--lumi-*` tokens; re-pointing it now would fail every legacy call site. |
| `client/scripts/checkTokenResolution.js` | RETAIN | Asks whether a class exists in compiled CSS. Contrast pairs are token facts, so they are verified by the token build, not by this reader. |
| `client/src/design-system/signals/signals.js` (unknown → HOLD) | DEPRECATE | Removed once the Phase 3 verdict primitive exists; no unknown → default mapping survives. |
| `client/src/components/ui/DecisionPill.jsx` `verdictConfig` | DEPRECATE | As above. |
| `design-system-figma/marcom-ai/project/client/design-system/tokens/colors.json` | RETAIN | A historical copy inside the Figma bundle, read by no build. Evidence only (design-governance/README.md §4). |
