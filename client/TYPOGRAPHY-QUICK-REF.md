# Typography Quick Reference

**Design System v2.0** — Semantic Typography Role Classes

## Available Classes

### Headings
- `.decision-title` — Main decision/campaign titles (20px, Display)
- `.panel-heading` — Card/panel headings (17px, Display)  
- `.section-heading` — Section dividers uppercase (14px, Display)

### Labels
- `.section-label` — Small uppercase labels (10px, Mono)
- `.radar-label` — Intelligence system labels (11px, Mono)

### Metrics
- `.metric-display` — Large dashboard metrics (30px, Display, tabular-nums)
- `.metric-value` — Standard metric values (14px, Mono, tabular-nums)
- `.verdict-number` — Verdict scores (24px, Mono, tabular-nums)

### Body Text
- `.body-muted` — Secondary descriptions (12px, Body)
- `.body-subtle` — Tertiary/helper text (12px, Body)

## Migration Pattern

**Before:**
```jsx
<h2 className="text-xl font-display font-semibold">Title</h2>
<div className="text-2xl font-mono tabular-nums">$12,345</div>
```

**After:**
```jsx
<h2 className="decision-title">Title</h2>
<div className="verdict-number">$12,345</div>
```

## Why?
- ✅ Single source of truth
- ✅ Lint-enforced consistency
- ✅ Easier rebranding
- ✅ Self-documenting code

See `DESIGN-SYSTEM-REFACTOR.md` for full migration guide.
