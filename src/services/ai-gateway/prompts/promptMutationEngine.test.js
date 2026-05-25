// ============================================================
// Prompt Mutation Engine Tests — PR #34
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  applyPromptMutation,
  hasMutationRule,
  getSupportedMutationTypes,
} from './promptMutationEngine.js';

describe('Prompt Mutation Engine — PR #34', () => {
  const samplePrompt = `Generate 3 high-converting ad hooks for Meta ads.

CONTEXT:
Diagnosis: {diagnosis}
Brand Voice: {brandVoice}

REQUIREMENTS:
- 40-60 characters per hook
- Scroll-stopping and curiosity-driven
- Test different psychological triggers
- No emojis in hooks
- Mobile-first readability

OUTPUT FORMAT:
Return JSON array with hooks`;

  describe('applyPromptMutation', () => {
    it('should inject mutation constraint into REQUIREMENTS section', () => {
      const mutationContext = {
        feedbackType: 'hook_angle',
        severity: 'HIGH',
        feedback: 'Focus more on problem-awareness',
      };

      const mutated = applyPromptMutation(samplePrompt, mutationContext);

      expect(mutated).toContain('REQUIREMENTS:');
      expect(mutated).toContain('CRITICAL: Change the psychological trigger');
      expect(mutated).toContain('Focus more on problem-awareness');
      expect(mutated).toContain('OUTPUT FORMAT:'); // Preserved next section
    });

    it('should preserve original requirements while adding mutation', () => {
      const mutationContext = {
        feedbackType: 'tone',
        severity: 'MEDIUM',
      };

      const mutated = applyPromptMutation(samplePrompt, mutationContext);

      // Original requirements preserved
      expect(mutated).toContain('40-60 characters per hook');
      expect(mutated).toContain('Scroll-stopping and curiosity-driven');

      // Mutation added
      expect(mutated).toContain('IMPORTANT: Adjust voice/personality');
    });

    it('should add preservation constraints when preserveAspects provided', () => {
      const mutationContext = {
        feedbackType: 'cta',
        severity: 'HIGH',
        preserveAspects: ['brand_voice', 'hook_angle'],
      };

      const mutated = applyPromptMutation(samplePrompt, mutationContext);

      expect(mutated).toContain('PRESERVE (do not change):');
      expect(mutated).toContain('brand voice');
      expect(mutated).toContain('hook angle');
    });

    it('should use severity to determine priority level', () => {
      const highSeverity = applyPromptMutation(samplePrompt, {
        feedbackType: 'clarity',
        severity: 'HIGH',
      });

      const mediumSeverity = applyPromptMutation(samplePrompt, {
        feedbackType: 'clarity',
        severity: 'MEDIUM',
      });

      const lowSeverity = applyPromptMutation(samplePrompt, {
        feedbackType: 'clarity',
        severity: 'LOW',
      });

      expect(highSeverity).toContain('CRITICAL:');
      expect(mediumSeverity).toContain('IMPORTANT:');
      expect(lowSeverity).toContain('NOTE:');
    });

    it('should return base prompt unchanged if no feedbackType', () => {
      const mutated = applyPromptMutation(samplePrompt, {});
      expect(mutated).toBe(samplePrompt);
    });

    it('should return base prompt if feedbackType has no mutation rule', () => {
      const mutated = applyPromptMutation(samplePrompt, {
        feedbackType: 'unknown_type',
        severity: 'HIGH',
      });

      expect(mutated).toBe(samplePrompt);
    });

    it('should return base prompt if REQUIREMENTS section not found', () => {
      const noRequirementsPrompt = `Generate hooks.

CONTEXT:
Diagnosis: test

OUTPUT FORMAT:
JSON array`;

      const mutated = applyPromptMutation(noRequirementsPrompt, {
        feedbackType: 'hook_angle',
        severity: 'HIGH',
      });

      expect(mutated).toBe(noRequirementsPrompt);
    });

    it('should handle multiple preserveAspects', () => {
      const mutationContext = {
        feedbackType: 'brand_voice',
        severity: 'MEDIUM',
        preserveAspects: ['hook_angle', 'cta', 'length'],
      };

      const mutated = applyPromptMutation(samplePrompt, mutationContext);

      expect(mutated).toContain('PRESERVE (do not change):');
      expect(mutated).toContain('hook angle');
      expect(mutated).toContain('cta');
      expect(mutated).toContain('length');
    });

    it('should work with visual brief feedbackTypes', () => {
      const visualPrompt = `Generate a visual brief.

CONTEXT:
Brand: Test

REQUIREMENTS:
- Visual concept description
- Color palette (3-5 colors)
- Mobile-first framing

OUTPUT FORMAT:
JSON object`;

      const mutated = applyPromptMutation(visualPrompt, {
        feedbackType: 'color_palette',
        severity: 'HIGH',
        feedback: 'Use warmer tones',
      });

      expect(mutated).toContain('CRITICAL: Select new color palette');
      expect(mutated).toContain('Use warmer tones');
    });

    it('should work with audience strategy feedbackTypes', () => {
      const audiencePrompt = `Generate audience hypotheses.

CONTEXT:
Campaign: Test

REQUIREMENTS:
- Hypothesis 1: Refined targeting
- Hypothesis 2: Expansion targeting

OUTPUT FORMAT:
JSON array`;

      const mutated = applyPromptMutation(audiencePrompt, {
        feedbackType: 'creative_angle',
        severity: 'MEDIUM',
      });

      expect(mutated).toContain('IMPORTANT: Change creative angle');
    });

    it('should preserve prompt structure with multiple sections', () => {
      const complexPrompt = `Generate content.

CONTEXT:
Test context

REQUIREMENTS:
- Requirement 1
- Requirement 2

VALIDATION CHECKS:
- Check 1
- Check 2

OUTPUT FORMAT:
JSON`;

      const mutated = applyPromptMutation(complexPrompt, {
        feedbackType: 'tone',
        severity: 'HIGH',
      });

      // REQUIREMENTS section modified
      expect(mutated).toContain('CRITICAL: Adjust voice/personality');

      // Other sections preserved
      expect(mutated).toContain('VALIDATION CHECKS:');
      expect(mutated).toContain('Check 1');
      expect(mutated).toContain('OUTPUT FORMAT:');
    });
  });

  describe('hasMutationRule', () => {
    it('should return true for defined mutation types', () => {
      expect(hasMutationRule('hook_angle')).toBe(true);
      expect(hasMutationRule('tone')).toBe(true);
      expect(hasMutationRule('cta')).toBe(true);
      expect(hasMutationRule('visual_concept')).toBe(true);
      expect(hasMutationRule('color_palette')).toBe(true);
    });

    it('should return false for undefined mutation types', () => {
      expect(hasMutationRule('unknown_type')).toBe(false);
      expect(hasMutationRule('random_feedback')).toBe(false);
      expect(hasMutationRule('')).toBe(false);
    });
  });

  describe('getSupportedMutationTypes', () => {
    it('should return array of all supported types', () => {
      const types = getSupportedMutationTypes();

      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);

      // Check key types are included
      expect(types).toContain('hook_angle');
      expect(types).toContain('tone');
      expect(types).toContain('cta');
      expect(types).toContain('visual_concept');
      expect(types).toContain('color_palette');
      expect(types).toContain('brand_voice');
      expect(types).toContain('audience_fit');
    });

    it('should match all FEEDBACK_TYPE values from feedbackTypes.js', () => {
      const types = getSupportedMutationTypes();

      // Copy feedbackTypes
      const expectedCopyTypes = [
        'hook_angle',
        'tone',
        'cta',
        'clarity',
        'length',
        'brand_voice',
        'brand_guidelines',
        'audience_fit',
        'message_positioning',
      ];

      expectedCopyTypes.forEach(type => {
        expect(types).toContain(type);
      });

      // Visual feedbackTypes
      const expectedVisualTypes = [
        'visual_concept',
        'color_palette',
        'composition',
        'mobile_optimization',
      ];

      expectedVisualTypes.forEach(type => {
        expect(types).toContain(type);
      });

      // Strategy feedbackTypes
      expect(types).toContain('creative_angle');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty feedback text gracefully', () => {
      const mutated = applyPromptMutation(samplePrompt, {
        feedbackType: 'hook_angle',
        severity: 'HIGH',
        feedback: '',
      });

      expect(mutated).toContain('CRITICAL: Change the psychological trigger');
      expect(mutated).not.toContain(' — '); // No trailing separator
    });

    it('should handle preserveAspects with underscores', () => {
      const mutated = applyPromptMutation(samplePrompt, {
        feedbackType: 'tone',
        severity: 'LOW',
        preserveAspects: ['hook_angle', 'brand_voice', 'message_positioning'],
      });

      // Underscores converted to spaces
      expect(mutated).toContain('hook angle');
      expect(mutated).toContain('brand voice');
      expect(mutated).toContain('message positioning');
    });

    it('should handle prompt with REQUIREMENTS at end (no next section)', () => {
      const endPrompt = `Generate content.

CONTEXT:
Test

REQUIREMENTS:
- Requirement 1
- Requirement 2`;

      const mutated = applyPromptMutation(endPrompt, {
        feedbackType: 'clarity',
        severity: 'MEDIUM',
      });

      expect(mutated).toContain('IMPORTANT: Improve message clarity');
      expect(mutated).toContain('Requirement 1');
      expect(mutated).toContain('Requirement 2');
    });
  });
});
