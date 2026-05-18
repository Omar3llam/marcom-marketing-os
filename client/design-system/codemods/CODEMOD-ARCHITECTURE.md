# Codemod Architecture — Automated Semantic Migration
**Version:** 1.0  
**Status:** 🛠️ Phase 4 — Automation Tooling  
**Purpose:** Automate migration from raw Tailwind → semantic primitives

---

## Executive Summary

**Problem:** 305 raw Tailwind text utilities across 31 files → manual migration is error-prone and slow.

**Solution:** AST-based codemod that:
1. Parses JSX files
2. Identifies raw Tailwind text patterns
3. Transforms to semantic primitives
4. Preserves existing props/className
5. Validates transformations

**Benefit:** 90%+ coverage in 1-2 days (vs. 8-12 days manual)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Codemod Pipeline                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Parse JSX → AST (Babel parser)                         │
│  2. Traverse AST → Find Tailwind patterns                  │
│  3. Transform → Replace with semantic primitive             │
│  4. Validate → Check prop safety, className preservation   │
│  5. Dry-run → Show diff, no file changes                   │
│  6. Execute → Write transformed files                       │
│  7. Verify → Run build + lint                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Codemod Phases

### Phase 1: Detection (AST Traversal)
**Goal:** Find all elements with raw Tailwind text utilities

**Input:**
```jsx
<div className="text-2xl font-bold text-gray-900">
  Campaign Analysis
</div>
```

**Detection Pattern:**
```javascript
// Match className containing text-{size}
className.includes('text-xl') ||
className.includes('text-2xl') ||
className.includes('text-3xl')
```

**Output:**
```javascript
{
  type: 'JSXElement',
  tag: 'div',
  className: 'text-2xl font-bold text-gray-900',
  children: ['Campaign Analysis'],
  location: { file: 'DecisionFrame.jsx', line: 42 }
}
```

---

### Phase 2: Classification (Semantic Inference)
**Goal:** Determine which semantic primitive to use

**Decision Tree:**
```
1. Is this numeric/tabular data?
   YES → <MetricValue>

2. Is className uppercase + small + tracking-wide?
   YES → <SectionLabel>

3. Is text-2xl/3xl + font-bold?
   YES → <DecisionTitle>

4. Is text-gray-500/400 (muted)?
   YES → <BodyMuted>

5. Is text-gray-600/subtle?
   YES → <BodySubtle>

6. Default: <Text variant="body" />
```

**Classification Rules:**
```javascript
const classificationRules = [
  {
    name: 'MetricValue',
    match: (className, children) => {
      const isLarge = /text-(2xl|3xl)/.test(className);
      const isBold = /font-(bold|extrabold)/.test(className);
      const isNumeric = /^[\d.,\$%]+/.test(children);
      return isLarge && isBold && isNumeric;
    },
    primitive: 'MetricValue',
    defaultTag: 'p',
  },
  {
    name: 'SectionLabel',
    match: (className) => {
      const isSmall = /text-xs/.test(className);
      const isUppercase = /uppercase/.test(className);
      const hasTracking = /tracking-(wide|wider)/.test(className);
      return isSmall && isUppercase && hasTracking;
    },
    primitive: 'SectionLabel',
    defaultTag: 'h3',
  },
  {
    name: 'DecisionTitle',
    match: (className) => {
      const isLarge = /text-(xl|2xl)/.test(className);
      const isBold = /font-(semibold|bold)/.test(className);
      return isLarge && isBold;
    },
    primitive: 'DecisionTitle',
    defaultTag: 'h2',
  },
  {
    name: 'BodyMuted',
    match: (className) => {
      return /text-gray-(400|500)/.test(className);
    },
    primitive: 'BodyMuted',
    defaultTag: 'p',
  },
  {
    name: 'BodySubtle',
    match: (className) => {
      return /text-gray-(600|subtle)/.test(className);
    },
    primitive: 'BodySubtle',
    defaultTag: 'p',
  },
];
```

---

### Phase 3: Transformation (AST Modification)
**Goal:** Replace element with semantic primitive

**Before:**
```jsx
<div className="text-2xl font-bold text-gray-900 mb-4">
  Campaign Analysis
</div>
```

**Transformation:**
```javascript
// 1. Classify → DecisionTitle (text-2xl + font-bold)
// 2. Extract non-semantic classes → mb-4
// 3. Generate import if missing
// 4. Generate JSX element
```

**After:**
```jsx
import { DecisionTitle } from '@/components/primitives';

<DecisionTitle className="mb-4">
  Campaign Analysis
</DecisionTitle>
```

**Transformation Logic:**
```javascript
function transformElement(node, classification) {
  const { primitive, defaultTag } = classification;
  const preservedClasses = extractNonSemanticClasses(node.className);
  
  return {
    type: 'JSXElement',
    openingElement: {
      name: primitive,
      attributes: [
        // Preserve as prop if not the default tag
        node.tag !== defaultTag && { name: 'as', value: node.tag },
        // Preserve non-semantic className
        preservedClasses && { name: 'className', value: preservedClasses },
        // Preserve other props
        ...node.attributes.filter(attr => attr.name !== 'className'),
      ].filter(Boolean),
    },
    children: node.children,
  };
}
```

---

### Phase 4: Validation (Safety Checks)
**Goal:** Ensure transformation is safe and correct

**Validation Rules:**
1. **Import Safety**: Don't duplicate imports
2. **Prop Preservation**: All non-className props preserved
3. **Children Preservation**: Text content unchanged
4. **Ref Handling**: forwardRef primitives support refs
5. **ClassName Merge**: Non-semantic classes preserved
6. **Semantic Purity**: Don't transform styled-system components

**Validation Example:**
```javascript
function validateTransformation(before, after) {
  // Rule 1: Children unchanged
  assert(before.children === after.children);
  
  // Rule 2: Non-semantic props preserved
  const beforeProps = extractProps(before);
  const afterProps = extractProps(after);
  assert(beforeProps.id === afterProps.id);
  assert(beforeProps.onClick === afterProps.onClick);
  
  // Rule 3: Non-semantic classes preserved
  const beforeUtility = extractUtilityClasses(before.className);
  const afterUtility = after.props.className;
  assert(beforeUtility === afterUtility);
  
  return { valid: true, warnings: [] };
}
```

---

## Codemod Modes

### 1. Dry-Run Mode (Default)
**Purpose:** Show changes without modifying files

```bash
npm run codemod:semantic -- --dry-run
```

**Output:**
```diff
File: client/src/components/decision/DecisionFrame.jsx

- <div className="text-2xl font-bold text-gray-900">
-   Campaign Analysis
- </div>
+ <DecisionTitle>
+   Campaign Analysis
+ </DecisionTitle>

File: client/src/components/commandcenter/HeroToolCard.jsx

- <p className="text-3xl font-extrabold text-gray-900 tabular-nums">
-   $42,847
- </p>
+ <MetricValue>
+   $42,847
+ </MetricValue>

Summary:
- 23 transformations detected
- 2 files affected
- 0 unsafe transformations
```

---

### 2. Execute Mode
**Purpose:** Apply transformations to files

```bash
npm run codemod:semantic -- --execute
```

**Output:**
```
✓ client/src/components/decision/DecisionFrame.jsx (6 transformations)
✓ client/src/components/commandcenter/HeroToolCard.jsx (4 transformations)
✓ Import added: client/src/components/decision/DecisionFrame.jsx
✓ Import added: client/src/components/commandcenter/HeroToolCard.jsx

Summary:
✓ 10 transformations applied
✓ 2 imports added
✓ Build validation: PASSED
✓ Lint validation: PASSED
```

---

### 3. Interactive Mode
**Purpose:** Review each transformation individually

```bash
npm run codemod:semantic -- --interactive
```

**Output:**
```
Transformation 1/23:
File: client/src/components/decision/DecisionFrame.jsx:42

- <div className="text-2xl font-bold text-gray-900">
-   Campaign Analysis
- </div>
+ <DecisionTitle>
+   Campaign Analysis
+ </DecisionTitle>

Apply this transformation? [y/n/q/a]
  y = yes (apply this one)
  n = no (skip this one)
  q = quit (stop and exit)
  a = all (apply all remaining)
```

---

## AST Patterns

### Pattern 1: Simple Text Element
```jsx
// Before
<div className="text-2xl font-bold">Title</div>

// AST (simplified)
{
  type: 'JSXElement',
  openingElement: {
    name: { name: 'div' },
    attributes: [{
      type: 'JSXAttribute',
      name: { name: 'className' },
      value: { value: 'text-2xl font-bold' }
    }]
  },
  children: [{ type: 'JSXText', value: 'Title' }]
}

// After transformation
{
  type: 'JSXElement',
  openingElement: {
    name: { name: 'DecisionTitle' },
    attributes: []
  },
  children: [{ type: 'JSXText', value: 'Title' }]
}
```

---

### Pattern 2: Element with Preserved Classes
```jsx
// Before
<div className="text-2xl font-bold mb-4 hover:underline">Title</div>

// Transformation
1. Extract semantic: "text-2xl font-bold" → DecisionTitle
2. Preserve utility: "mb-4 hover:underline" → className prop

// After
<DecisionTitle className="mb-4 hover:underline">Title</DecisionTitle>
```

---

### Pattern 3: Element with Preserved Props
```jsx
// Before
<div className="text-2xl font-bold" id="title" onClick={handleClick}>
  Title
</div>

// After
<DecisionTitle id="title" onClick={handleClick}>
  Title
</DecisionTitle>
```

---

### Pattern 4: Nested Elements (Skip)
```jsx
// Before (SKIP — too complex)
<div className="text-2xl font-bold">
  <Icon />
  Title
</div>

// Reason: Children include non-text elements
// Action: Flag for manual review
```

---

## Edge Cases

### Edge Case 1: Mixed Semantic + Utility Classes
```jsx
// Before
<div className="text-2xl font-bold bg-blue-500 p-4">Title</div>

// Analysis
Semantic: text-2xl font-bold → DecisionTitle
Utility: bg-blue-500 p-4 → preserve

// After
<DecisionTitle className="bg-blue-500 p-4">Title</DecisionTitle>
```

---

### Edge Case 2: Conditional ClassName
```jsx
// Before
<div className={`text-2xl font-bold ${active ? 'text-blue-500' : ''}`}>
  Title
</div>

// Action: SKIP (template literal)
// Reason: Requires manual review for intent
```

---

### Edge Case 3: Unknown Element
```jsx
// Before
<SomeStyledComponent className="text-2xl font-bold">
  Title
</SomeStyledComponent>

// Action: SKIP (custom component)
// Reason: May have internal styling logic
```

---

### Edge Case 4: Empty or Dynamic Children
```jsx
// Before
<div className="text-2xl font-bold">{title}</div>

// After (VALID — dynamic children OK)
<DecisionTitle>{title}</DecisionTitle>
```

---

## Implementation Stack

### Dependencies
```json
{
  "@babel/parser": "^7.24.0",
  "@babel/traverse": "^7.24.0",
  "@babel/generator": "^7.24.0",
  "@babel/types": "^7.24.0",
  "jscodeshift": "^0.15.0",
  "chalk": "^5.3.0",
  "diff": "^5.1.0"
}
```

### File Structure
```
client/design-system/codemods/
├── CODEMOD-ARCHITECTURE.md       (this file)
├── migrate-to-semantic.js        (main codemod script)
├── lib/
│   ├── parser.js                  (AST parsing)
│   ├── classifier.js              (semantic inference)
│   ├── transformer.js             (AST transformation)
│   ├── validator.js               (safety checks)
│   └── reporter.js                (CLI output)
└── rules/
    ├── metric-value.js            (MetricValue classification)
    ├── decision-title.js          (DecisionTitle classification)
    ├── section-label.js           (SectionLabel classification)
    ├── body-muted.js              (BodyMuted classification)
    └── body-subtle.js             (BodySubtle classification)
```

---

## Usage Examples

### Basic Usage
```bash
# Dry-run (show changes)
npm run codemod:semantic

# Execute (apply changes)
npm run codemod:semantic -- --execute

# Interactive mode
npm run codemod:semantic -- --interactive
```

---

### Target Specific Files
```bash
# Single file
npm run codemod:semantic -- --file=client/src/pages/Settings.jsx

# Multiple files
npm run codemod:semantic -- --file=client/src/pages/*.jsx

# Glob pattern
npm run codemod:semantic -- --glob="client/src/components/decision/**/*.jsx"
```

---

### Filter by Primitive Type
```bash
# Only migrate to DecisionTitle
npm run codemod:semantic -- --primitive=DecisionTitle

# Only migrate to MetricValue + DecisionTitle
npm run codemod:semantic -- --primitive=MetricValue,DecisionTitle
```

---

### Output Options
```bash
# JSON output (for CI)
npm run codemod:semantic -- --format=json

# Quiet mode (errors only)
npm run codemod:semantic -- --quiet

# Verbose mode (detailed logs)
npm run codemod:semantic -- --verbose
```

---

## Success Metrics

### Automation Coverage
**Target:** 80%+ of raw Tailwind text utilities automated

**Measurement:**
```bash
# Before codemod
grep -rn 'className="[^"]*text-(xl|2xl|3xl)' client/src --include="*.jsx" | wc -l
# → 305 instances

# After codemod
grep -rn 'className="[^"]*text-(xl|2xl|3xl)' client/src --include="*.jsx" | wc -l
# → <61 instances (80% reduction)
```

---

### Transformation Safety
**Target:** 100% of transformations build + lint clean

**Validation:**
```bash
# After codemod execution
npm run build  # Must pass
npm run lint   # Must pass (0 errors)
```

---

### Time Savings
**Manual migration:** 8-12 days (305 instances at ~30/day)  
**Automated migration:** 1-2 days (80% automated, 20% manual review)  
**Time saved:** 6-10 days

---

## Rollout Plan

### Phase 4.2: Implement AST Patterns
1. Build classifier rules for each primitive
2. Build transformer functions for each pattern
3. Build validator checks for safety

### Phase 4.3: Build Migration Script
1. Implement CLI interface
2. Implement dry-run mode
3. Implement execute mode
4. Implement interactive mode

### Phase 4.4: Test + Validate
1. Test on sample files (10-20 instances)
2. Validate build + lint pass
3. Manual review of transformations
4. Execute full migration (305 instances)

---

**Status:** 🎯 Architecture complete — Ready for implementation  
**Next:** Phase 4.2 — Implement AST transformation patterns

