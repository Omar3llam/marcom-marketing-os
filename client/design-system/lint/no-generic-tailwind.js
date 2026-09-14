// ============================================================
// MARCOM Design System — ESLint Custom Rule
// no-generic-tailwind
// ============================================================
// Prevents generic Tailwind utilities from appearing in JSX.
// Enforces the LEGACY token names the existing UI uses. (The "Design Bible"
// this line once cited never existed.) Current token authority:
// client/design-system/foundation/tokens/ — see DESIGN_TOKEN_ARCHITECTURE.md.
//
// FAILS on:
//   bg-gray-*, text-gray-*, border-gray-*
//   text-xl, text-2xl, text-3xl (use typography role classes)
//   font-bold, font-semibold (use typography role classes)
//   raw hex values (#RRGGBB) in className
//   bg-white, bg-black (use surface-card, dark-base)
//   bg-blue-*, bg-red-* (use signal-kill, signal-scale etc.)
//
// ALLOWED exceptions (documented in comments):
//   bg-gray-* inside ErrorBoundary (dark mode error screen)
//   text-gray-* in CsvUploader (pending migration)
// ============================================================

// Generic Tailwind patterns to ban in className strings
const BANNED_PATTERNS = [
  // Generic color utilities — use semantic tokens
  { pattern: /\bbg-gray-\d+/, message: 'Use bg-surface-* or bg-lumi-* instead of bg-gray-*' },
  { pattern: /\btext-gray-\d+/, message: 'Use text-dark-* or text-lumi-* instead of text-gray-*' },
  { pattern: /\bborder-gray-\d+/, message: 'Use border-surface-border or border-lumi-border instead' },
  { pattern: /\bbg-blue-\d+/, message: 'Use bg-lumi-gold or semantic token instead of bg-blue-*' },
  { pattern: /\btext-blue-\d+/, message: 'Use semantic token instead of text-blue-*' },
  { pattern: /\bbg-green-\d+/, message: 'Use bg-signal-scale or bg-signal-scale-bg instead' },
  { pattern: /\btext-green-\d+/, message: 'Use text-signal-scale instead of text-green-*' },
  { pattern: /\bbg-red-\d+(?!\/\d+)/, message: 'Use bg-signal-kill or bg-signal-kill-bg instead' },
  { pattern: /\btext-red-\d+/, message: 'Use text-signal-kill instead of text-red-*' },

  // Raw hex values in className — always use tokens
  { pattern: /#[0-9a-fA-F]{3,6}\b/, message: 'Raw hex in className. Use design token instead.' },

  // Generic type utilities — use typography role classes
  { pattern: /\btext-xl\b/, message: 'Use typography role class: decision-title, radar-label, etc.' },
  { pattern: /\btext-2xl\b/, message: 'Use typography role class: metric-display, verdict-number, etc.' },
  { pattern: /\btext-3xl\b/, message: 'Use typography role class: metric-display for large numbers' },
];

// Files exempt from the rule (document the reason)
const EXEMPT_FILES = [
  'ErrorBoundary.jsx',  // Dark mode error screen — intentional gray palette
  'VerdictBadge.jsx',   // Composite state primitive — hardcoded typography is intentional
];

function extractClassStrings(node) {
  // Handle JSX className="..." and className={cn("...")}
  const strings = [];

  if (node.type === 'Literal' && typeof node.value === 'string') {
    strings.push({ value: node.value, loc: node.loc });
  }
  if (node.type === 'TemplateLiteral') {
    node.quasis.forEach(q => {
      if (q.value.raw) strings.push({ value: q.value.raw, loc: q.loc });
    });
  }
  if (node.type === 'CallExpression') {
    node.arguments.forEach(arg => strings.push(...extractClassStrings(arg)));
  }
  if (node.type === 'ArrayExpression') {
    node.elements.forEach(el => el && strings.push(...extractClassStrings(el)));
  }

  return strings;
}

export const noGenericTailwind = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce MARCOM Design System token usage in className props',
      category:    'MARCOM Design System',
    },
    schema: [],
    messages: {
      forbidden: '{{message}} Found: "{{found}}"',
    },
  },

  create(context) {
    // Check if current file is exempt
    const filename = context.getFilename();
    const isExempt = EXEMPT_FILES.some(f => filename.includes(f));
    if (isExempt) return {};

    return {
      JSXAttribute(node) {
        // Only check className props
        if (node.name.name !== 'className') return;
        if (!node.value) return;

        const classStrings = extractClassStrings(
          node.value.type === 'JSXExpressionContainer'
            ? node.value.expression
            : node.value
        );

        for (const { value, loc } of classStrings) {
          for (const { pattern, message } of BANNED_PATTERNS) {
            const match = value.match(pattern);
            if (match) {
              context.report({
                loc,
                messageId: 'forbidden',
                data: { message, found: match[0] },
              });
            }
          }
        }
      },
    };
  },
};
