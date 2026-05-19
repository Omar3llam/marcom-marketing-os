# Primitives — Base Layout Components

**Phase A: Layout System**  
**Layer:** Primitives (no business logic)

---

## Philosophy

Primitives are **pure layout components** with:

- ✅ **Zero business logic** — No API calls, no FSM, no state
- ✅ **Semantic naming** — Named by role, not appearance
- ✅ **Design tokens only** — No raw colors or spacing
- ✅ **Composable** — Can be nested and combined
- ✅ **Universal** — Not tied to campaigns or decisions

---

## Components

### Shell

**Role:** Application boundary, FSM container  
**Replaces:** `<div className="min-h-screen bg-gray-900">`

```tsx
<Shell mode="full" navigation={<Nav />}>
  <Panel>{children}</Panel>
</Shell>
```

**Props:**
- `mode`: 'full' | 'sidebar'
- `navigation`: Optional nav element

---

### Panel

**Role:** Content isolation, visual grouping  
**Replaces:** `<div className="bg-gray-800 rounded-lg p-6">`

```tsx
<Panel
  elevation="raised"
  padding="md"
  header={<h2>Campaign</h2>}
  footer={<button>Execute</button>}
>
  {children}
</Panel>
```

**Props:**
- `elevation`: 'flat' | 'raised' | 'floating'
- `padding`: 'sm' | 'md' | 'lg'
- `header`: Optional header element
- `footer`: Optional footer element

---

### Stack

**Role:** Flow layout, vertical rhythm  
**Replaces:** `<div className="space-y-4">`

```tsx
<Stack gap="md" align="stretch" dividers={false}>
  <Alert {...alert1} />
  <Alert {...alert2} />
</Stack>
```

**Props:**
- `gap`: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
- `align`: 'start' | 'center' | 'end' | 'stretch'
- `dividers`: Show dividers between items

---

### Cluster

**Role:** Inline grouping, wrappable flow  
**Replaces:** `<div className="flex flex-wrap gap-2">`

```tsx
<Cluster gap="sm" justify="start" wrap={true}>
  <Badge>HIGH</Badge>
  <Badge>PAUSE_AND_RELAUNCH</Badge>
</Cluster>
```

**Props:**
- `gap`: 'xs' | 'sm' | 'md' | 'lg'
- `justify`: 'start' | 'center' | 'end' | 'space-between'
- `align`: 'start' | 'center' | 'end' | 'baseline'
- `wrap`: Allow wrapping

---

## Rules

### ✅ DO

- Use primitives for layout structure
- Compose primitives to build complex layouts
- Use design tokens exclusively
- Name by semantic role, not appearance

### ❌ DON'T

- Add business logic to primitives
- Make API calls from primitives
- Use raw colors or spacing values
- Name by visual appearance (no `<BigCard />`)

---

## Example: Building a Layout

```tsx
import { Shell, Panel, Stack, Cluster } from '@/primitives';

<Shell mode="full">
  <Panel elevation="raised" padding="lg">
    <Stack gap="md">
      <h1>Campaign Feed</h1>
      <Cluster gap="sm">
        <button>Filter</button>
        <button>Sort</button>
      </Cluster>
      <Stack gap="lg">
        {campaigns.map(c => <CampaignCard key={c.id} {...c} />)}
      </Stack>
    </Stack>
  </Panel>
</Shell>
```

---

## Design Tokens

All primitives use design tokens from the design system:

**Spacing:**
- `var(--spacing-xs)` → 4px
- `var(--spacing-sm)` → 8px
- `var(--spacing-md)` → 16px
- `var(--spacing-lg)` → 24px
- `var(--spacing-xl)` → 32px

**Colors:**
- `var(--color-bg-primary)` → Main background
- `var(--color-bg-secondary)` → Panel background
- `var(--color-bg-tertiary)` → Nested background
- `var(--color-text-primary)` → Main text
- `var(--color-text-secondary)` → Muted text

**Borders:**
- `var(--color-border-default)` → Standard border
- `var(--color-border-subtle)` → Light border
- `var(--color-border-strong)` → Strong border

**Shadows:**
- `var(--shadow-sm)` → Light shadow
- `var(--shadow-md)` → Medium shadow
- `var(--shadow-lg)` → Prominent shadow

**Radius:**
- `var(--radius-sm)` → 4px
- `var(--radius-md)` → 8px
- `var(--radius-lg)` → 12px

---

**Next:** See [layouts/README.md](../layouts/README.md) for semantic decision components.
