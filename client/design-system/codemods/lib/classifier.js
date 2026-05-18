/**
 * Semantic Classifier
 * Determines which semantic primitive to use based on className and content
 */

/**
 * Classification rules for each primitive
 * Returns the first matching rule
 */
export const classificationRules = [
  {
    name: 'MetricValue',
    test: (className, textContent) => {
      const isLarge = /text-(2xl|3xl)/.test(className);
      const isBold = /font-(bold|extrabold)/.test(className);
      const hasTabular = /tabular-nums/.test(className);
      const isNumeric = /^[\d.,\$%€£¥x×+-]+/i.test(textContent?.trim() || '');

      return (isLarge && isBold) || (isLarge && hasTabular) || (isBold && isNumeric && isLarge);
    },
    primitive: 'MetricValue',
    defaultTag: 'p',
    intent: 'primary',
  },

  {
    name: 'DecisionTitle',
    test: (className) => {
      const isLarge = /text-(xl|2xl)/.test(className);
      const isBold = /font-(semibold|bold)/.test(className);

      return isLarge && isBold;
    },
    primitive: 'DecisionTitle',
    defaultTag: 'h2',
    intent: 'primary',
  },

  {
    name: 'SectionLabel',
    test: (className) => {
      const isSmall = /text-xs/.test(className);
      const isUppercase = /uppercase/.test(className);
      const hasTracking = /tracking-(wide|wider)/.test(className);

      return (isSmall && isUppercase) || (isSmall && hasTracking);
    },
    primitive: 'SectionLabel',
    defaultTag: 'h3',
    intent: 'subtle',
  },

  {
    name: 'BodyMuted',
    test: (className) => {
      // Match text-gray-400/500 or explicit text-text-muted
      const isMuted = /text-(gray-(400|500)|text-muted)/.test(className);
      const isSmall = /text-sm/.test(className);

      return isMuted || (isSmall && /gray/.test(className));
    },
    primitive: 'BodyMuted',
    defaultTag: 'p',
    locked: true, // Intent is locked, not overrideable
  },

  {
    name: 'BodySubtle',
    test: (className) => {
      // Match text-gray-600 or explicit text-text-subtle
      const isSubtle = /text-(gray-600|text-subtle)/.test(className);

      return isSubtle;
    },
    primitive: 'BodySubtle',
    defaultTag: 'p',
    locked: true, // Intent is locked, not overrideable
  },
];

/**
 * Classify an element based on its className and text content
 * @param {string} className - The className string to analyze
 * @param {string} textContent - The text content of the element
 * @returns {object|null} - Classification result or null if no match
 */
export function classifyElement(className, textContent) {
  if (!className) return null;

  for (const rule of classificationRules) {
    if (rule.test(className, textContent)) {
      return {
        ...rule,
        originalClassName: className,
      };
    }
  }

  return null;
}

/**
 * Extract non-semantic utility classes that should be preserved
 * @param {string} className - The original className string
 * @returns {string} - Non-semantic classes
 */
export function extractUtilityClasses(className) {
  if (!className) return '';

  const semanticClasses = [
    // Text sizes
    /text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)/g,
    // Font weights
    /font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)/g,
    // Text colors (gray shades used for semantic text)
    /text-gray-\d+/g,
    /text-text-(primary|secondary|muted|subtle)/g,
    // Tracking
    /tracking-(tighter|tight|normal|wide|wider|widest)/g,
    // Leading
    /leading-(none|tight|snug|normal|relaxed|loose)/g,
    // Text transform
    /uppercase/g,
    /lowercase/g,
    /capitalize/g,
    // Tabular nums
    /tabular-nums/g,
  ];

  let result = className;
  for (const pattern of semanticClasses) {
    result = result.replace(pattern, '');
  }

  // Clean up multiple spaces
  return result.trim().replace(/\s+/g, ' ');
}

/**
 * Check if an element should be skipped (too complex for automation)
 * @param {object} node - AST node to check
 * @returns {object} - { skip: boolean, reason: string }
 */
export function shouldSkipElement(node) {
  // Skip if className is a template literal
  if (node.className && (node.className.includes('${') || node.className.includes('`'))) {
    return { skip: true, reason: 'Template literal className' };
  }

  // Skip if className uses clsx/cn function
  if (node.classNameType === 'expression') {
    return { skip: true, reason: 'Dynamic className expression' };
  }

  // Skip if children contain JSX elements (not just text)
  if (node.hasNonTextChildren) {
    return { skip: true, reason: 'Mixed JSX children' };
  }

  // Skip if element is a styled-system component
  const styledComponents = ['Box', 'Flex', 'Text', 'Stack'];
  if (styledComponents.includes(node.tagName)) {
    return { skip: true, reason: 'Styled-system component' };
  }

  return { skip: false, reason: null };
}

export default {
  classificationRules,
  classifyElement,
  extractUtilityClasses,
  shouldSkipElement,
};
