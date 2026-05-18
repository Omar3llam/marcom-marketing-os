// ============================================================
// Decision Flow Registry
// ============================================================
// Centralized mapping of decision flow states → visual semantics.
// Similar to signals registry but for cognitive/decision attributes.
//
// Purpose:
//   - Unify confidence/risk/urgency/strength semantics across UI
//   - Prevent visual drift (e.g., "moderate risk" always looks the same)
//   - Enable UI to "think" in MARCOM's decision language
//
// Usage:
//   import { decisionFlows } from '@/design-system/flows/decisionFlows';
//   const { confidence, risk, urgency, strength } = decisionFlows;
//
//   <ConfidenceIndicator level={confidence.thresholds.high(0.92)} />
//   <RiskSignal severity={risk.levels.moderate} />
// ============================================================

/**
 * Confidence Level Thresholds
 * Maps numeric confidence (0-1) to semantic levels
 */
export const confidence = {
  thresholds: {
    high: (level) => level >= 0.85,
    medium: (level) => level >= 0.60 && level < 0.85,
    low: (level) => level < 0.60,
  },
  levels: {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
  },
  colors: {
    high: 'text-signal-success',
    medium: 'text-signal-warning',
    low: 'text-signal-danger',
  },
  labels: {
    high: 'High Confidence',
    medium: 'Medium Confidence',
    low: 'Low Confidence',
  },
};

/**
 * Risk Severity Levels
 * Business risk assessment semantics
 */
export const risk = {
  levels: {
    LOW: 'low',
    MODERATE: 'moderate',
    HIGH: 'high',
    CRITICAL: 'critical',
  },
  colors: {
    low: 'text-signal-success',
    moderate: 'text-signal-warning',
    high: 'text-orange-600',
    critical: 'text-signal-danger',
  },
  backgrounds: {
    low: 'bg-signal-success/10',
    moderate: 'bg-signal-warning/10',
    high: 'bg-orange-500/10',
    critical: 'bg-signal-danger/10',
  },
  borders: {
    low: 'border-signal-success/20',
    moderate: 'border-signal-warning/20',
    high: 'border-orange-500/20',
    critical: 'border-signal-danger/20',
  },
  labels: {
    low: 'Low Risk',
    moderate: 'Moderate Risk',
    high: 'High Risk',
    critical: 'Critical Risk',
  },
  icons: {
    low: '✓',
    moderate: '⚠',
    high: '⚠',
    critical: '✕',
  },
};

/**
 * Urgency Priority Levels
 * Time-sensitivity and execution priority
 */
export const urgency = {
  levels: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  },
  colors: {
    low: 'text-gray-600',
    medium: 'text-blue-700',
    high: 'text-orange-700',
    critical: 'text-red-700',
  },
  backgrounds: {
    low: 'bg-gray-100',
    medium: 'bg-blue-50',
    high: 'bg-orange-50',
    critical: 'bg-red-50',
  },
  borders: {
    low: 'border-gray-200',
    medium: 'border-blue-200',
    high: 'border-orange-200',
    critical: 'border-red-200',
  },
  dots: {
    low: 'bg-gray-400',
    medium: 'bg-blue-500',
    high: 'bg-orange-500',
    critical: 'bg-red-500',
  },
  labels: {
    low: 'Low Priority',
    medium: 'Medium Priority',
    high: 'High Priority',
    critical: 'Urgent',
  },
  // Critical urgency always pulses
  shouldPulse: {
    low: false,
    medium: false,
    high: false,
    critical: true,
  },
};

/**
 * Recommendation Strength Levels
 * AI/system recommendation conviction
 */
export const strength = {
  levels: {
    WEAK: 'weak',
    MODERATE: 'moderate',
    STRONG: 'strong',
    VERY_STRONG: 'very-strong',
  },
  bars: {
    weak: 1,
    moderate: 2,
    strong: 3,
    'very-strong': 4,
  },
  colors: {
    weak: 'text-gray-700',
    moderate: 'text-amber-700',
    strong: 'text-green-700',
    'very-strong': 'text-emerald-700',
  },
  backgrounds: {
    weak: 'bg-gray-50',
    moderate: 'bg-amber-50',
    strong: 'bg-green-50',
    'very-strong': 'bg-emerald-50',
  },
  borders: {
    weak: 'border-gray-200',
    moderate: 'border-amber-200',
    strong: 'border-green-200',
    'very-strong': 'border-emerald-200',
  },
  barColors: {
    weak: 'bg-gray-500',
    moderate: 'bg-amber-500',
    strong: 'bg-green-500',
    'very-strong': 'bg-emerald-500',
  },
  labels: {
    weak: 'Weak Recommendation',
    moderate: 'Moderate Recommendation',
    strong: 'Strong Recommendation',
    'very-strong': 'Very Strong Recommendation',
  },
};

/**
 * Decision Flow State Combinations
 * Common combinations of cognitive attributes
 */
export const stateProfiles = {
  // High confidence + low risk + strong recommendation = GO
  GO: {
    confidence: confidence.levels.HIGH,
    risk: risk.levels.LOW,
    strength: strength.levels.STRONG,
    urgency: urgency.levels.MEDIUM,
  },

  // Medium confidence + moderate risk + moderate recommendation = REVIEW
  REVIEW: {
    confidence: confidence.levels.MEDIUM,
    risk: risk.levels.MODERATE,
    strength: strength.levels.MODERATE,
    urgency: urgency.levels.HIGH,
  },

  // Low confidence + high risk + weak recommendation = BLOCK
  BLOCK: {
    confidence: confidence.levels.LOW,
    risk: risk.levels.HIGH,
    strength: strength.levels.WEAK,
    urgency: urgency.levels.LOW,
  },

  // High confidence + critical risk + strong recommendation = URGENT_REVIEW
  URGENT_REVIEW: {
    confidence: confidence.levels.HIGH,
    risk: risk.levels.CRITICAL,
    strength: strength.levels.STRONG,
    urgency: urgency.levels.CRITICAL,
  },
};

/**
 * Helper: Get Confidence Level from Numeric Value
 */
export function getConfidenceLevel(level) {
  if (confidence.thresholds.high(level)) return confidence.levels.HIGH;
  if (confidence.thresholds.medium(level)) return confidence.levels.MEDIUM;
  return confidence.levels.LOW;
}

/**
 * Helper: Get State Profile by Name
 */
export function getStateProfile(profileName) {
  return stateProfiles[profileName] || null;
}

/**
 * Export all registries
 */
export const decisionFlows = {
  confidence,
  risk,
  urgency,
  strength,
  stateProfiles,
  getConfidenceLevel,
  getStateProfile,
};

export default decisionFlows;
