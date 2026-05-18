# Semantic Migration Codemod
**Status:** 🎯 Ready for Implementation  
**Purpose:** Automate migration from raw Tailwind → semantic primitives

---

## Quick Start

```bash
# Install dependencies
cd client && npm install

# Dry-run (show what would change)
npm run codemod:semantic

# Execute transformation
npm run codemod:semantic -- --execute

# Interactive mode
npm run codemod:semantic -- --interactive
```

---

## What This Codemod Does

**Transforms raw Tailwind text utilities** → **Semantic primitives**

### Example Transformations

#### Before
```jsx
<div className="text-2xl font-bold text-gray-900">
  Campaign Analysis
</div>

<p className="text-3xl font-extrabold tabular-nums">
  $42,847
</p>

<span className="text-xs uppercase tracking-wider text-gray-600">
  Campaign Status
</span>

<p className="text-sm text-gray-500">
  Last updated 2 hours ago
</p>
```

#### After
```jsx
import { DecisionTitle, MetricValue, SectionLabel, BodyMuted } from '@/components/primitives';

<DecisionTitle>
  Campaign Analysis
</DecisionTitle>

<MetricValue>
  $42,847
</MetricValue>

<SectionLabel>
  Campaign Status
</SectionLabel>

<BodyMuted>
  Last updated 2 hours ago
</BodyMuted>
```

---

## Classification Rules

The codemod uses pattern matching to determine which primitive to use:

| Pattern | Primitive | Example |
|---------|-----------|---------|
| `text-(2xl\|3xl)` + `font-(bold\|extrabold)` + numeric | MetricValue | `$42,847` |
| `text-(xl\|2xl)` + `font-(semibold\|bold)` | DecisionTitle | `Campaign Analysis` |
| `text-xs` + `uppercase` + `tracking-wider` | SectionLabel | `CAMPAIGN STATUS` |
| `text-sm` + `text-gray-(400\|500)` | BodyMuted | `Secondary info` |
| `text-gray-600` | BodySubtle | `Last updated...` |

---

## Preserved vs. Removed Classes

### ✅ Preserved (Non-Semantic Utility Classes)
```jsx
// Before
<div className="text-2xl font-bold mb-4 hover:underline bg-blue-50">
  Title
</div>

// After
<DecisionTitle className="mb-4 hover:underline bg-blue-50">
  Title
</DecisionTitle>
```

**Preserved:**
- Layout: `mb-4`, `p-4`, `flex`, `grid`, etc.
- Interactive: `hover:*`, `focus:*`, `active:*`
- Backgrounds: `bg-*`
- Borders: `border-*`
- Other utilities: `rounded-*`, `shadow-*`, etc.

**Removed (replaced by semantic primitive):**
- Text sizes: `text-*`
- Font weights: `font-*`
- Text colors: `text-gray-*`, `text-text-*`
- Typography: `uppercase`, `tracking-*`, `leading-*`, `tabular-nums`

---

## Edge Cases & Skipped Patterns

### ❌ Skipped (Manual Review Required)

**1. Template Literal classNames**
```jsx
<div className={`text-2xl font-bold ${active ? 'text-blue-500' : ''}`}>
  Title
</div>
```
**Reason:** Dynamic classes need manual review

**2. Mixed JSX Children**
```jsx
<div className="text-2xl font-bold">
  <Icon />
  Title
</div>
```
**Reason:** Non-text children are complex to transform

**3. Custom Components**
```jsx
<CustomText className="text-2xl font-bold">
  Title
</CustomText>
```
**Reason:** May have internal styling logic

**4. clsx/cn Function Calls**
```jsx
<div className={cn('text-2xl font-bold', extraClasses)}>
  Title
</div>
```
**Reason:** Dynamic expressions need manual handling

---

## Usage Modes

### 1. Dry-Run Mode (Default)

Shows what would change **without modifying files**.

```bash
npm run codemod:semantic
```

**Output:**
```diff
File: client/src/components/decision/DecisionFrame.jsx
─────────────────────────────────────────────────────

Line 42:
- <div className="text-2xl font-bold text-gray-900">
-   Campaign Analysis
- </div>
+ <DecisionTitle>
+   Campaign Analysis
+ </DecisionTitle>

Line 87:
- <p className="text-3xl font-extrabold tabular-nums">
-   $42,847
- </p>
+ <MetricValue>
+   $42,847
+ </MetricValue>

─────────────────────────────────────────────────────
Summary:
  ✓ 6 transformations detected
  ✓ 1 file affected
  ✓ 0 unsafe transformations
  ✓ 0 skipped elements
```

---

### 2. Execute Mode

Applies transformations **and modifies files**.

```bash
npm run codemod:semantic -- --execute
```

**Output:**
```
✓ Transformed: client/src/components/decision/DecisionFrame.jsx (6 changes)
✓ Added import: { DecisionTitle, MetricValue } from '@/components/primitives'
✓ Build validation: PASSED
✓ Lint validation: PASSED (0 errors, 0 warnings)

Summary:
  ✓ 6 transformations applied
  ✓ 1 file modified
  ✓ 1 import added
  ✓ 0 errors
```

---

### 3. Interactive Mode

Review each transformation **individually**.

```bash
npm run codemod:semantic -- --interactive
```

**Output:**
```
Transformation 1/6:
File: client/src/components/decision/DecisionFrame.jsx:42

- <div className="text-2xl font-bold text-gray-900">
-   Campaign Analysis
- </div>
+ <DecisionTitle>
+   Campaign Analysis
+ </DecisionTitle>

Apply this transformation? [y/n/q/a/?]
  y = yes (apply this one)
  n = no (skip this one)
  q = quit (stop and save)
  a = all (apply all remaining)
  ? = help
```

---

## Advanced Options

### Target Specific Files

```bash
# Single file
npm run codemod:semantic -- --file=client/src/pages/Settings.jsx

# Glob pattern
npm run codemod:semantic -- --glob="client/src/components/decision/**/*.jsx"

# Multiple patterns
npm run codemod:semantic -- \
  --glob="client/src/components/**/*.jsx" \
  --glob="client/src/pages/**/*.jsx"
```

---

### Filter by Primitive Type

```bash
# Only DecisionTitle transformations
npm run codemod:semantic -- --primitive=DecisionTitle

# Multiple primitives
npm run codemod:semantic -- --primitive=DecisionTitle,MetricValue

# Exclude specific primitives
npm run codemod:semantic -- --exclude=BodyMuted,BodySubtle
```

---

### Output Formats

```bash
# JSON output (for CI/CD)
npm run codemod:semantic -- --format=json > transformations.json

# Quiet mode (errors only)
npm run codemod:semantic -- --quiet

# Verbose mode (detailed logs)
npm run codemod:semantic -- --verbose
```

---

## Safety Guarantees

### 1. Non-Destructive Dry-Run
**Default mode never modifies files** — always review changes first.

### 2. Build Validation
After transformations, automatically runs:
```bash
npm run build  # Ensures no TypeScript/build errors
npm run lint   # Ensures no ESLint violations
```

If either fails, **transformations are rolled back**.

### 3. Prop Preservation
All non-className props are preserved:
```jsx
// Before
<div className="text-2xl font-bold" id="title" onClick={handleClick} data-testid="title">
  Title
</div>

// After (all props preserved)
<DecisionTitle id="title" onClick={handleClick} data-testid="title">
  Title
</DecisionTitle>
```

### 4. Import Management
- Automatically adds missing imports
- Deduplicates existing imports
- Uses correct import path (`@/components/primitives`)

---

## Migration Waves

### Wave 1: High-Priority Files (Recommended First)
```bash
npm run codemod:semantic -- \
  --glob="client/src/pages/Settings.jsx" \
  --glob="client/src/pages/GrowthStrategyBoard.jsx" \
  --glob="client/src/pages/LandingPage.jsx" \
  --execute
```
**Impact:** 147 instances (48% of total)

---

### Wave 2: Decision Components
```bash
npm run codemod:semantic -- \
  --glob="client/src/components/decision/**/*.jsx" \
  --execute
```
**Impact:** 87 instances (partial migrations → completion)

---

### Wave 3: Remaining Components
```bash
npm run codemod:semantic -- \
  --glob="client/src/components/**/*.jsx" \
  --execute
```
**Impact:** ~40 instances (supporting UI)

---

## Troubleshooting

### Build Fails After Transformation

**Problem:** `npm run build` fails after codemod execution.

**Solution:**
1. Check import paths are correct (`@/components/primitives`)
2. Verify primitives index exports all used primitives
3. Run `npm run lint -- --fix` to auto-fix simple issues

---

### Too Many Skipped Elements

**Problem:** Codemod skips most elements.

**Cause:** Elements have template literals or dynamic classNames.

**Solution:** 
- Run `npm run codemod:semantic -- --verbose` to see skip reasons
- Manually migrate skipped elements
- Consider refactoring to static classNames where possible

---

### Import Not Added

**Problem:** Import statement not added after transformation.

**Cause:** File already has an import statement for different primitives.

**Solution:** Codemod **merges** imports automatically. If merge fails:
1. Manually add missing primitives to existing import
2. Re-run codemod with `--force-import` flag

---

## Implementation Status

- [x] Phase 4.1: Architecture Design
- [x] Phase 4.2: Classification Rules
- [ ] Phase 4.3: AST Parser (requires Babel implementation)
- [ ] Phase 4.4: Transformer (requires jscodeshift)
- [ ] Phase 4.5: Validator (requires AST traversal)
- [ ] Phase 4.6: CLI Interface

**Current Status:** 🟡 Architecture + classifier complete, AST implementation pending

---

## Next Steps for Full Implementation

### 1. Install Dependencies
```bash
cd client
npm install --save-dev @babel/parser @babel/traverse @babel/generator jscodeshift chalk diff
```

### 2. Implement AST Parser
File: `client/design-system/codemods/lib/parser.js`
- Parse JSX files with Babel
- Traverse AST to find elements with className
- Extract node information (tag, props, children)

### 3. Implement Transformer
File: `client/design-system/codemods/lib/transformer.js`
- Transform AST nodes based on classification
- Generate new JSX element with primitive component
- Preserve non-semantic props and className

### 4. Implement CLI
File: `client/design-system/codemods/migrate-to-semantic.js`
- Parse command-line arguments
- Orchestrate parser → classifier → transformer → validator
- Output diffs or apply transformations

### 5. Add npm Script
```json
{
  "scripts": {
    "codemod:semantic": "node design-system/codemods/migrate-to-semantic.js"
  }
}
```

---

## Estimated Timeline

**Full implementation:** 2-3 days  
**Testing + validation:** 1 day  
**Full migration execution:** 1-2 days  

**Total:** 4-6 days from architecture to 90%+ coverage

---

**Contact:** Design System Team  
**Docs:** [CODEMOD-ARCHITECTURE.md](./CODEMOD-ARCHITECTURE.md)

