// ============================================================
// Feedback Types Validation Tests — PR #33
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_TYPE,
  SEVERITY,
  PRESERVE_ASPECT,
  isValidFeedbackType,
  isValidSeverity,
  isValidPreserveAspects,
  validateStructuredFeedback,
  isContentFeedback,
  isBrandFeedback,
  isStrategyFeedback,
  isVisualFeedback,
} from './feedbackTypes.js';

describe('Feedback Type System', () => {
  describe('Validation Functions', () => {
    it('should validate feedbackType correctly', () => {
      expect(isValidFeedbackType(FEEDBACK_TYPE.HOOK_ANGLE)).toBe(true);
      expect(isValidFeedbackType(FEEDBACK_TYPE.TONE)).toBe(true);
      expect(isValidFeedbackType(FEEDBACK_TYPE.VISUAL_CONCEPT)).toBe(true);
      expect(isValidFeedbackType('invalid_type')).toBe(false);
      expect(isValidFeedbackType(null)).toBe(true); // null is optional
      expect(isValidFeedbackType(undefined)).toBe(true); // undefined is optional
    });

    it('should validate severity correctly', () => {
      expect(isValidSeverity(SEVERITY.LOW)).toBe(true);
      expect(isValidSeverity(SEVERITY.MEDIUM)).toBe(true);
      expect(isValidSeverity(SEVERITY.HIGH)).toBe(true);
      expect(isValidSeverity('CRITICAL')).toBe(false);
      expect(isValidSeverity(null)).toBe(true); // optional
      expect(isValidSeverity(undefined)).toBe(true); // optional
    });

    it('should validate preserveAspects correctly', () => {
      expect(isValidPreserveAspects([PRESERVE_ASPECT.BRAND_VOICE])).toBe(true);
      expect(isValidPreserveAspects([PRESERVE_ASPECT.TONE, PRESERVE_ASPECT.CTA])).toBe(true);
      expect(isValidPreserveAspects(['invalid_aspect'])).toBe(false);
      expect(isValidPreserveAspects([])).toBe(true); // empty array is valid
      expect(isValidPreserveAspects(null)).toBe(true); // optional
      expect(isValidPreserveAspects(undefined)).toBe(true); // optional
      expect(isValidPreserveAspects('not_an_array')).toBe(false);
    });

    it('should validate full structured feedback object', () => {
      const valid = {
        feedbackType: FEEDBACK_TYPE.HOOK_ANGLE,
        severity: SEVERITY.HIGH,
        preserveAspects: [PRESERVE_ASPECT.BRAND_VOICE],
      };

      const result = validateStructuredFeedback(valid);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid structured feedback', () => {
      const invalid = {
        feedbackType: 'invalid',
        severity: 'CRITICAL',
        preserveAspects: ['not_valid'],
      };

      const result = validateStructuredFeedback(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should allow partial structured feedback', () => {
      const partial = {
        feedbackType: FEEDBACK_TYPE.TONE,
      };

      const result = validateStructuredFeedback(partial);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow null structured feedback (backward compat)', () => {
      const result = validateStructuredFeedback(null);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Type Guards', () => {
    it('should identify content feedback types', () => {
      expect(isContentFeedback(FEEDBACK_TYPE.HOOK_ANGLE)).toBe(true);
      expect(isContentFeedback(FEEDBACK_TYPE.TONE)).toBe(true);
      expect(isContentFeedback(FEEDBACK_TYPE.CTA)).toBe(true);
      expect(isContentFeedback(FEEDBACK_TYPE.CLARITY)).toBe(true);
      expect(isContentFeedback(FEEDBACK_TYPE.LENGTH)).toBe(true);
      expect(isContentFeedback(FEEDBACK_TYPE.BRAND_VOICE)).toBe(false);
      expect(isContentFeedback(FEEDBACK_TYPE.VISUAL_CONCEPT)).toBe(false);
    });

    it('should identify brand feedback types', () => {
      expect(isBrandFeedback(FEEDBACK_TYPE.BRAND_VOICE)).toBe(true);
      expect(isBrandFeedback(FEEDBACK_TYPE.BRAND_GUIDELINES)).toBe(true);
      expect(isBrandFeedback(FEEDBACK_TYPE.TONE)).toBe(false);
    });

    it('should identify strategy feedback types', () => {
      expect(isStrategyFeedback(FEEDBACK_TYPE.AUDIENCE_FIT)).toBe(true);
      expect(isStrategyFeedback(FEEDBACK_TYPE.MESSAGE_POSITIONING)).toBe(true);
      expect(isStrategyFeedback(FEEDBACK_TYPE.CREATIVE_ANGLE)).toBe(true);
      expect(isStrategyFeedback(FEEDBACK_TYPE.TONE)).toBe(false);
    });

    it('should identify visual feedback types', () => {
      expect(isVisualFeedback(FEEDBACK_TYPE.VISUAL_CONCEPT)).toBe(true);
      expect(isVisualFeedback(FEEDBACK_TYPE.COLOR_PALETTE)).toBe(true);
      expect(isVisualFeedback(FEEDBACK_TYPE.COMPOSITION)).toBe(true);
      expect(isVisualFeedback(FEEDBACK_TYPE.MOBILE_OPTIMIZATION)).toBe(true);
      expect(isVisualFeedback(FEEDBACK_TYPE.HOOK_ANGLE)).toBe(false);
    });
  });
});
