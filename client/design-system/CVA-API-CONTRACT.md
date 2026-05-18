# CVA API Contract — Semantic Text Variants
**Version:** 2.0 (Production-Ready)  
**Status:** 🎯 Phase 2 — CVA Modeling  
**Replaces:** `role`-based string mapping (v1.0)

---

## Executive Summary

**Problem:** Current `Text` component uses string-based `role` prop → Limited composability, no type safety, no variant combinations.

**Solution:** Migrate to **CVA (class-variance-authority)** with:
- `variant` prop → Semantic function (title, body, label, metric)
- `intent` prop → Visual emphasis (primary, secondary, muted, subtle)
- `size` prop → Scale variations (sm, base, lg, xl)

**Benefit:** Composable API allows `<Text variant="title" intent="muted" size="lg" />` without creating primitive inflation.

---

## API Design

### Prop Schema

```typescript
interface TextProps {
  // Semantic function — REQUIRED
  variant: 'title' | 'body' | 'label' | 'metric' | 'data';
  
  // Visual emphasis — optional (default: 'primary')
  intent?: 'primary' | 'secondary' | 'muted' | 'subtle' | 'success' | 'warning' | 'danger';
  
  // Scale — optional (default: 'base')
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
  
  // Polymorphic element — optional (default: 'p')
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'label' | 'div';
  
  // Pass-through
  className?: string;
  children: React.ReactNode;
}
```

---

## Variant Definitions

### `variant` (Semantic Function)

Defines **what** the text represents semantically.

| Variant | Semantic Domain | Default Size | Default Weight | Use Cases |
|---------|----------------|--------------|----------------|-----------|
| `title` | Headers, section titles, decision states | `2xl` | `bold` | Page titles, decision headers, section dividers |
| `body` | Primary content text | `base` | `normal` | Paragraphs, descriptions, content blocks |
| `label` | Categorization, metadata labels | `xs` | `medium` | Section labels, field labels, tags |
| `metric` | Numeric data, KPIs, performance values | `3xl` | `extrabold` | ROAS, CPC, conversion rates, budget values |
| `data` | Structured data (non-metric) | `sm` | `medium` | Table cells, list items, structured content |

---

### `intent` (Visual Emphasis)

Defines **how** the text should be emphasized (color/weight).

| Intent | Color Token | Use Cases |
|--------|-------------|-----------|
| `primary` (default) | `text-text-primary` | Main content, headers, emphasized text |
| `secondary` | `text-text-secondary` | Supporting text, less critical info |
| `muted` | `text-text-muted` | De-emphasized content, help text, notes |
| `subtle` | `text-text-subtle` | Tertiary metadata, timestamps, attribution |
| `success` | `text-signal-success` | Positive outcomes, wins, uptrends |
| `warning` | `text-signal-warning` | Caution states, moderate risk |
| `danger` | `text-signal-danger` | Critical alerts, losses, failures |

---

### `size` (Scale Override)

Allows scale variation within a variant (use sparingly).

| Size | Font Size Token | Use Cases |
|------|----------------|-----------|
| `xs` | `text-xs` | Micro labels, fine print |
| `sm` | `text-sm` | Secondary text, metadata |
| `base` | `text-base` | Default body text |
| `lg` | `text-lg` | Emphasized body, sub-headers |
| `xl` | `text-xl` | Section headers |
| `2xl` | `text-2xl` | Page titles |
| `3xl` | `text-3xl` | Hero metrics, primary KPIs |

**Guidance:** Use size overrides only when semantic variant + default size is close but not exact.

---

## CVA Implementation

### Full CVA Configuration

```javascript
import { cva } from 'class-variance-authority';

const textVariants = cva(
  // Base classes (always applied)
  'font-sans antialiased',
  {
    variants: {
      // Semantic function (REQUIRED)
      variant: {
        title: 'text-2xl font-bold leading-tight tracking-tight',
        body: 'text-base font-normal leading-relaxed',
        label: 'text-xs font-medium uppercase tracking-wider',
        metric: 'text-3xl font-extrabold tabular-nums leading-none',
        data: 'text-sm font-medium leading-snug',
      },
      
      // Visual emphasis (optional)
      intent: {
        primary: 'text-text-primary',
        secondary: 'text-text-secondary',
        muted: 'text-text-muted',
        subtle: 'text-text-subtle',
        success: 'text-signal-success',
        warning: 'text-signal-warning',
        danger: 'text-signal-danger',
      },
      
      // Scale override (optional)
      size: {
        xs: 'text-xs',
        sm: 'text-sm',
        base: 'text-base',
        lg: 'text-lg',
        xl: 'text-xl',
        '2xl': 'text-2xl',
        '3xl': 'text-3xl',
      },
    },
    
    // Compound variants (special combinations)
    compoundVariants: [
      // Metric + success → add green glow effect
      {
        variant: 'metric',
        intent: 'success',
        class: 'drop-shadow-sm',
      },
      // Label + muted → reduce tracking
      {
        variant: 'label',
        intent: 'muted',
        class: 'tracking-wide', // Less aggressive than default tracking-wider
      },
    ],
    
    // Default values
    defaultVariants: {
      variant: 'body',       // Safest default
      intent: 'primary',     // Most common
      size: undefined,       // Use variant's default size
    },
  }
);
```

---

## Usage Examples

### Basic Usage (Variant Only)

```jsx
// Title (default: 2xl, bold, primary)
<Text variant="title">Decision Approval Required</Text>

// Body (default: base, normal, primary)
<Text variant="body">This campaign requires manual review.</Text>

// Label (default: xs, medium, uppercase, primary)
<Text variant="label">Campaign Status</Text>

// Metric (default: 3xl, extrabold, tabular-nums, primary)
<Text variant="metric">$42,847.50</Text>
```

---

### Variant + Intent Composition

```jsx
// Title with muted emphasis
<Text variant="title" intent="muted">
  Optional Configuration
</Text>

// Metric with success color
<Text variant="metric" intent="success">
  +247% ROAS
</Text>

// Body with subtle emphasis (metadata)
<Text variant="body" intent="subtle">
  Last updated 2 hours ago
</Text>
```

---

### Variant + Size Override

```jsx
// Large title (override default 2xl → 3xl)
<Text variant="title" size="3xl">
  Hero Section Title
</Text>

// Small metric (for compact dashboards)
<Text variant="metric" size="xl">
  $1.2M
</Text>

// Large body text (emphasis)
<Text variant="body" size="lg">
  This is an important announcement.
</Text>
```

---

### Full Composition (Variant + Intent + Size)

```jsx
// Large, muted title for secondary sections
<Text variant="title" intent="muted" size="xl">
  Additional Details
</Text>

// Small, success metric for inline KPIs
<Text variant="metric" intent="success" size="lg">
  +42%
</Text>

// Subtle data text for table cells
<Text variant="data" intent="subtle" size="xs">
  Pending
</Text>
```

---

## Migration from v1.0 (role-based)

### Before (v1.0 — String Roles)
```jsx
<Text role="decision-title">Title</Text>
<Text role="metric-value">$42,847</Text>
<Text role="body-muted">Secondary info</Text>
```

### After (v2.0 — CVA Variants)
```jsx
<Text variant="title">Title</Text>
<Text variant="metric">$42,847</Text>
<Text variant="body" intent="muted">Secondary info</Text>
```

### Migration Mapping Table

| v1.0 `role` | v2.0 CVA Props | Notes |
|-------------|---------------|-------|
| `decision-title` | `variant="title"` | Direct mapping |
| `section-label` | `variant="label"` | Direct mapping |
| `body-muted` | `variant="body" intent="muted"` | Split role into variant + intent |
| `body-subtle` | `variant="body" intent="subtle"` | Split role into variant + intent |
| `metric-value` | `variant="metric"` | Direct mapping |
| `verdict-number` | `variant="metric" intent="success/warning/danger"` | Add intent based on verdict |
| `radar-label` | `variant="label"` | Direct mapping |
| `signal-label` | `variant="label"` | Direct mapping |

---

## Primitive Derivation

Typography primitives should extend `Text` with locked variants:

```jsx
// DecisionTitle.jsx
export const DecisionTitle = ({ children, ...props }) => (
  <Text variant="title" intent="primary" as="h2" {...props}>
    {children}
  </Text>
);

// MetricValue.jsx
export const MetricValue = ({ children, intent = 'primary', ...props }) => (
  <Text variant="metric" intent={intent} {...props}>
    {children}
  </Text>
);

// SectionLabel.jsx
export const SectionLabel = ({ children, ...props }) => (
  <Text variant="label" intent="subtle" {...props}>
    {children}
  </Text>
);

// BodyMuted.jsx
export const BodyMuted = ({ children, ...props }) => (
  <Text variant="body" intent="muted" {...props}>
    {children}
  </Text>
);
```

**Benefit:** Primitives become "presets" of the `Text` CVA engine — no duplicate implementation.

---

## Compound Variants (Advanced)

CVA allows special combinations via `compoundVariants`:

```javascript
compoundVariants: [
  // Success metrics get glow effect
  {
    variant: 'metric',
    intent: 'success',
    class: 'drop-shadow-[0_0_8px_rgba(34,197,94,0.3)]',
  },
  
  // Danger metrics get warning glow
  {
    variant: 'metric',
    intent: 'danger',
    class: 'drop-shadow-[0_0_8px_rgba(239,68,68,0.3)]',
  },
  
  // Large titles reduce line-height
  {
    variant: 'title',
    size: '3xl',
    class: 'leading-tight',
  },
  
  // Subtle labels reduce tracking
  {
    variant: 'label',
    intent: 'subtle',
    class: 'tracking-wide', // Instead of tracking-wider
  },
]
```

---

## Type Safety (TypeScript)

```typescript
import { VariantProps } from 'class-variance-authority';

type TextVariantProps = VariantProps<typeof textVariants>;

interface TextProps extends TextVariantProps {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'label' | 'div';
  className?: string;
  children: React.ReactNode;
}

export const Text: React.FC<TextProps> = ({ ... }) => { ... };
```

**Benefit:** IntelliSense autocomplete for `variant`, `intent`, `size` props.

---

## Validation Rules

### Rule 1: Variant is Always Required
```jsx
// ❌ Invalid: No variant
<Text>Text content</Text>

// ✅ Valid: Variant specified
<Text variant="body">Text content</Text>
```

### Rule 2: Intent/Size Are Optional
```jsx
// ✅ Valid: Uses default intent="primary"
<Text variant="title">Title</Text>

// ✅ Valid: Custom intent
<Text variant="title" intent="muted">Title</Text>
```

### Rule 3: Size Override Should Be Rare
```jsx
// 🟡 Discouraged: Size override changes semantic meaning
<Text variant="body" size="3xl">This is not really body text</Text>

// ✅ Better: Use correct variant
<Text variant="title" size="3xl">This is a title</Text>
```

---

## Performance Considerations

### CVA Bundle Impact
- **Before (v1.0):** String map lookup (~0.5KB)
- **After (v2.0):** CVA library + config (~2.5KB minified + gzipped)
- **Net Cost:** +2KB (acceptable for composability gain)

### Runtime Performance
- CVA uses memoization internally
- Class concatenation is fast (`cn` utility)
- No prop drilling or context overhead

---

## Rollout Plan

### Phase 2.2: Implement CVA in Text Component
1. Install CVA: `npm install class-variance-authority`
2. Replace `roleClassMap` with `textVariants` CVA config
3. Update `Text` component to use CVA props
4. Add TypeScript types (if TS enabled)

### Phase 2.3: Update Typography Primitives
1. Refactor `DecisionTitle` to use `<Text variant="title" />`
2. Refactor `MetricValue` to use `<Text variant="metric" />`
3. Refactor `SectionLabel`, `BodyMuted`, `BodySubtle`
4. Keep same public API (no breaking changes)

### Phase 2.4: Documentation + Examples
1. Create Storybook stories for all variant combinations
2. Update MIGRATION-MAP.md with CVA examples
3. Write migration guide from v1.0 → v2.0

---

## Future Extensions

### Responsive Variants (Phase 3+)
```jsx
<Text 
  variant="title" 
  size={{ base: 'lg', md: 'xl', lg: '2xl' }}
>
  Responsive Title
</Text>
```

### Animation Variants (Phase 4+)
```jsx
<Text 
  variant="metric" 
  intent="success" 
  animated="pulse"
>
  +247%
</Text>
```

---

**Status:** 🎯 Ready for implementation (Phase 2.2)  
**Next:** Implement CVA in Text component, refactor primitives

