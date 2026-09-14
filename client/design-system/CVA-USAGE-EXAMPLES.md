# CVA Usage Examples — Text Component v2.0

> **HISTORICAL DOCUMENT — NOT CURRENT DESIGN AUTHORITY.** Superseded by `design-governance/` (authority map: `design-governance/README.md` §2, §4). Kept as evidence; unchanged apart from this notice. *(Phase 1.5 Governance Synchronization, 2026-09-14)*
**Status:** 🎯 Production-Ready  
**Last Updated:** 2026-05-18  
**API Version:** CVA 2.0

---

## Table of Contents
1. [Basic Variants](#basic-variants)
2. [Variant + Intent Combinations](#variant--intent-combinations)
3. [Variant + Size Overrides](#variant--size-overrides)
4. [Full Composition](#full-composition)
5. [Typography Primitive Equivalents](#typography-primitive-equivalents)
6. [Real-World Examples](#real-world-examples)
7. [API Validation](#api-validation)

---

## Basic Variants

### Title Variant
**Purpose:** Decision state headers, page titles, section dividers

```jsx
// Default: 2xl, bold, primary, tight leading
<Text variant="title">
  Campaign Analysis Dashboard
</Text>

// Polymorphic rendering (semantic HTML)
<Text variant="title" as="h1">
  Executive Summary
</Text>

<Text variant="title" as="h2">
  Performance Metrics
</Text>

// Output class names:
// "font-sans antialiased text-2xl font-bold leading-tight tracking-tight text-text-primary"
```

---

### Body Variant
**Purpose:** Primary content, paragraphs, descriptions

```jsx
// Default: base, normal, primary, relaxed leading
<Text variant="body">
  This campaign has shown consistent growth over the past 30 days
  with a ROAS improvement of 42% week-over-week.
</Text>

// As span for inline text
<Text variant="body" as="span">
  Inline body text
</Text>

// Output class names:
// "font-sans antialiased text-base font-normal leading-relaxed text-text-primary"
```

---

### Label Variant
**Purpose:** Section labels, category tags, field labels

```jsx
// Default: xs, medium, uppercase, wide tracking, primary
<Text variant="label">
  Campaign Status
</Text>

<Text variant="label" as="label" htmlFor="status-filter">
  Filter By
</Text>

// Output class names:
// "font-sans antialiased text-xs font-medium uppercase tracking-wider text-text-primary"
```

---

### Metric Variant
**Purpose:** Numeric KPIs, ROAS, conversion rates, budget values

```jsx
// Default: 3xl, extrabold, tabular-nums, no leading, primary
<Text variant="metric">
  $42,847.50
</Text>

<Text variant="metric">
  4.2x
</Text>

<Text variant="metric">
  87.5%
</Text>

// Output class names:
// "font-sans antialiased text-3xl font-extrabold tabular-nums leading-none text-text-primary"
```

---

### Data Variant
**Purpose:** Structured data, table cells, list items

```jsx
// Default: sm, medium, snug leading
<Text variant="data">
  Active
</Text>

<Text variant="data" as="td">
  Campaign #1247
</Text>

// Output class names:
// "font-sans antialiased text-sm font-medium leading-snug text-text-primary"
```

---

## Variant + Intent Combinations

### Title + Intent

```jsx
// Primary title (default)
<Text variant="title" intent="primary">
  Main Decision Header
</Text>

// Secondary title (de-emphasized)
<Text variant="title" intent="secondary">
  Supporting Section
</Text>

// Muted title (optional sections)
<Text variant="title" intent="muted">
  Additional Information
</Text>

// Subtle title (low-priority headers)
<Text variant="title" intent="subtle">
  Fine Print Section
</Text>

// Success title (positive outcomes)
<Text variant="title" intent="success">
  Campaign Approved
</Text>

// Warning title (caution states)
<Text variant="title" intent="warning">
  Manual Review Required
</Text>

// Danger title (critical alerts)
<Text variant="title" intent="danger">
  Budget Exceeded
</Text>
```

---

### Metric + Intent

```jsx
// Default metric
<Text variant="metric">
  $42,847
</Text>

// Success metric (positive performance)
<Text variant="metric" intent="success">
  +247%
</Text>
// → Adds drop-shadow-sm via compound variant

// Warning metric (moderate risk)
<Text variant="metric" intent="warning">
  1.2x
</Text>

// Danger metric (negative performance)
<Text variant="metric" intent="danger">
  -15%
</Text>
// → Adds drop-shadow-sm via compound variant

// Muted metric (de-emphasized data)
<Text variant="metric" intent="muted">
  $1,234
</Text>
```

---

### Body + Intent

```jsx
// Primary body (default)
<Text variant="body">
  Main content text here.
</Text>

// Muted body (secondary information)
<Text variant="body" intent="muted">
  This is optional information that provides context.
</Text>

// Subtle body (tertiary metadata)
<Text variant="body" intent="subtle">
  Last updated 2 hours ago by System
</Text>

// Success body (positive confirmation)
<Text variant="body" intent="success">
  Your changes have been saved successfully.
</Text>

// Danger body (error messages)
<Text variant="body" intent="danger">
  Unable to process your request. Please try again.
</Text>
```

---

### Label + Intent

```jsx
// Primary label (default)
<Text variant="label">
  Section Title
</Text>

// Subtle label (de-emphasized categories)
<Text variant="label" intent="subtle">
  Optional Field
</Text>
// → Reduces tracking-wider to tracking-wide via compound variant

// Success label (positive states)
<Text variant="label" intent="success">
  Verified
</Text>

// Warning label (caution states)
<Text variant="label" intent="warning">
  Pending
</Text>

// Danger label (alert states)
<Text variant="label" intent="danger">
  Failed
</Text>
```

---

## Variant + Size Overrides

**⚠️ Use size overrides sparingly — prefer correct variant selection**

### Title Size Overrides

```jsx
// Small title (for compact UIs)
<Text variant="title" size="xl">
  Compact Section Header
</Text>

// Large title (for hero sections)
<Text variant="title" size="3xl">
  Hero Landing Page Title
</Text>

// Extra small title (for dense layouts)
<Text variant="title" size="lg">
  Mini Card Title
</Text>
```

---

### Metric Size Overrides

```jsx
// Small metric (inline KPIs)
<Text variant="metric" size="xl">
  $1.2M
</Text>

// Large metric (hero numbers)
<Text variant="metric" size="3xl">
  4.2x
</Text>

// Extra small metric (dashboard widgets)
<Text variant="metric" size="lg">
  87%
</Text>
```

---

### Body Size Overrides

```jsx
// Small body (dense content)
<Text variant="body" size="sm">
  Compact paragraph text.
</Text>

// Large body (emphasis)
<Text variant="body" size="lg">
  This is an important announcement that needs emphasis.
</Text>
```

---

## Full Composition

**Variant + Intent + Size** combined

```jsx
// Large, muted title for secondary pages
<Text variant="title" intent="muted" size="xl">
  Additional Configuration
</Text>

// Small, success metric for inline badges
<Text variant="metric" intent="success" size="lg">
  +42%
</Text>

// Subtle, small body for footnotes
<Text variant="body" intent="subtle" size="sm">
  *Terms and conditions apply
</Text>

// Primary, extra-large title for heroes
<Text variant="title" intent="primary" size="3xl">
  Welcome to MARCOM
</Text>

// Danger, medium data for error states
<Text variant="data" intent="danger">
  Failed
</Text>
```

---

## Typography Primitive Equivalents

All typography primitives are now **presets** of the CVA `Text` component:

### DecisionTitle

```jsx
// Primitive API (unchanged)
<DecisionTitle>Campaign Analysis</DecisionTitle>

// Equivalent CVA API
<Text variant="title" intent="primary" as="h2">
  Campaign Analysis
</Text>

// With intent override
<DecisionTitle intent="muted">Optional Section</DecisionTitle>
// → <Text variant="title" intent="muted" as="h2">...</Text>
```

---

### MetricValue

```jsx
// Primitive API (unchanged)
<MetricValue>$42,847</MetricValue>

// Equivalent CVA API
<Text variant="metric" intent="primary">
  $42,847
</Text>

// With intent override (success metric)
<MetricValue intent="success">+247%</MetricValue>
// → <Text variant="metric" intent="success">+247%</Text>
// → Adds drop-shadow-sm via compound variant
```

---

### SectionLabel

```jsx
// Primitive API (unchanged)
<SectionLabel>Campaign Status</SectionLabel>

// Equivalent CVA API
<Text variant="label" intent="subtle" as="h3">
  Campaign Status
</Text>

// Default intent is 'subtle' (different from other primitives)
<SectionLabel />
// → intent="subtle" by default
```

---

### BodyMuted

```jsx
// Primitive API (unchanged)
<BodyMuted>This is secondary information.</BodyMuted>

// Equivalent CVA API
<Text variant="body" intent="muted">
  This is secondary information.
</Text>

// Intent is locked to 'muted'
<BodyMuted intent="subtle" /> // ❌ Intent prop is ignored
```

---

### BodySubtle

```jsx
// Primitive API (unchanged)
<BodySubtle>Last updated 2 hours ago</BodySubtle>

// Equivalent CVA API
<Text variant="body" intent="subtle">
  Last updated 2 hours ago
</Text>

// Intent is locked to 'subtle'
<BodySubtle intent="muted" /> // ❌ Intent prop is ignored
```

---

## Real-World Examples

### Dashboard Card Header

```jsx
<div className="card">
  {/* Section label */}
  <Text variant="label" intent="subtle">
    CAMPAIGN PERFORMANCE
  </Text>
  
  {/* Card title */}
  <Text variant="title" size="lg" as="h3">
    Meta Advantage+ Campaign
  </Text>
  
  {/* Primary metric */}
  <Text variant="metric" intent="success">
    4.2x
  </Text>
  
  {/* Metric label */}
  <Text variant="body" intent="muted" size="sm">
    ROAS (Last 30 days)
  </Text>
</div>
```

---

### Decision State Header

```jsx
<header>
  {/* Breadcrumb */}
  <Text variant="data" intent="subtle" size="xs">
    Campaigns → Meta ASC → Decision #1247
  </Text>
  
  {/* Decision title */}
  <Text variant="title" as="h1">
    Campaign Approval Required
  </Text>
  
  {/* Decision description */}
  <Text variant="body" intent="secondary">
    This campaign has exceeded the confidence threshold and requires
    manual approval before Meta execution.
  </Text>
  
  {/* Verdict badge (not Text component) */}
  <VerdictBadge verdict="SCALE" />
</header>
```

---

### Settings Section

```jsx
<section>
  {/* Section label */}
  <Text variant="label">
    NOTIFICATION PREFERENCES
  </Text>
  
  {/* Section description */}
  <Text variant="body" intent="muted">
    Configure how and when you receive alerts from MARCOM.
  </Text>
  
  {/* Form field label */}
  <Text variant="body" size="sm" as="label" htmlFor="email-freq">
    Email Frequency
  </Text>
  
  {/* Help text */}
  <Text variant="body" intent="subtle" size="xs">
    Choose how often you'd like to receive email digests.
  </Text>
</section>
```

---

### Error State

```jsx
<div className="error-container">
  {/* Error title */}
  <Text variant="title" intent="danger" size="xl">
    Unable to Connect to Meta
  </Text>
  
  {/* Error message */}
  <Text variant="body" intent="danger">
    We couldn't establish a connection to the Meta API.
    This may be due to expired credentials or network issues.
  </Text>
  
  {/* Error code */}
  <Text variant="data" intent="muted" size="xs">
    Error Code: META_AUTH_001
  </Text>
</div>
```

---

### Metric Grid

```jsx
<div className="metrics-grid">
  {/* Metric 1 */}
  <div>
    <Text variant="label" intent="subtle">ROAS</Text>
    <Text variant="metric" intent="success">4.2x</Text>
    <Text variant="data" intent="success" size="xs">+42% vs. last week</Text>
  </div>
  
  {/* Metric 2 */}
  <div>
    <Text variant="label" intent="subtle">CPA</Text>
    <Text variant="metric">$12.50</Text>
    <Text variant="data" intent="muted" size="xs">Within target</Text>
  </div>
  
  {/* Metric 3 */}
  <div>
    <Text variant="label" intent="subtle">SPENT</Text>
    <Text variant="metric" intent="warning">$42,847</Text>
    <Text variant="data" intent="warning" size="xs">87% of budget</Text>
  </div>
</div>
```

---

## API Validation

### ✅ Valid Usage

```jsx
// Variant is required
<Text variant="title">Valid</Text>

// Intent is optional (defaults to 'primary')
<Text variant="body">Valid</Text>

// Size is optional (uses variant default)
<Text variant="metric">Valid</Text>

// All props combined
<Text variant="title" intent="muted" size="xl" as="h2">Valid</Text>

// Polymorphic rendering
<Text variant="label" as="label" htmlFor="input">Valid</Text>

// Custom className (merges with CVA classes)
<Text variant="body" className="mb-4">Valid</Text>
```

---

### ❌ Invalid Usage

```jsx
// Missing variant prop
<Text>Invalid</Text>
// → Throws error: "[Text] Missing required `variant` prop"

// Invalid variant value
<Text variant="heading">Invalid</Text>
// → Runtime warning or TypeScript error

// Invalid intent value
<Text variant="body" intent="primary-success">Invalid</Text>
// → Runtime warning or TypeScript error

// Invalid size value
<Text variant="title" size="huge">Invalid</Text>
// → Runtime warning or TypeScript error

// Invalid as prop
<Text variant="body" as="button">Invalid</Text>
// → May render, but semantically incorrect (use <button> directly)
```

---

### ⚠️ Discouraged Patterns

```jsx
// Size override that changes semantic meaning
<Text variant="body" size="3xl">
  This is not really body text — should be variant="title"
</Text>

// Over-styling with className
<Text variant="title" className="text-sm font-normal text-red-500">
  Defeats the purpose of semantic primitives
</Text>

// Using intent for non-semantic styling
<Text variant="body" intent="danger" className="bg-red-100">
  Intent should drive color, not background
</Text>
```

---

## TypeScript Types (Reference)

```typescript
import { VariantProps } from 'class-variance-authority';

type TextVariantProps = VariantProps<typeof textVariants>;

interface TextProps extends TextVariantProps {
  variant: 'title' | 'body' | 'label' | 'metric' | 'data'; // REQUIRED
  intent?: 'primary' | 'secondary' | 'muted' | 'subtle' | 
           'success' | 'warning' | 'danger';
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 
       'p' | 'span' | 'label' | 'div' | 'td' | 'th';
  className?: string;
  children: React.ReactNode;
}

export const Text: React.ForwardRefExoticComponent<
  TextProps & React.RefAttributes<HTMLElement>
>;
```

---

## Bundle Impact

**Before CVA (v1.0):**
- Text component: ~0.5KB (string map)
- Total bundle: 267KB → 77.33KB gzipped

**After CVA (v2.0):**
- Text component + CVA: ~2.5KB
- Total bundle: 268KB → 77.82KB gzipped
- **Net cost:** +1.4KB raw, +0.5KB gzipped

**Verdict:** ✅ Acceptable cost for composability gain

---

## Migration Checklist

- [x] Install CVA: `npm install class-variance-authority`
- [x] Update `Text` component with CVA config
- [x] Refactor typography primitives to use CVA props
- [x] Validate build passes (no breaking changes)
- [x] Document usage examples
- [ ] Create Storybook stories for all combinations
- [ ] Add TypeScript types (if TS enabled)
- [ ] Update MIGRATION-MAP.md with CVA examples
- [ ] Write migration guide from role-based → CVA

---

**Status:** ✅ API Validated — Ready for Production  
**Next:** Phase 3 — Decision Flow Primitives

