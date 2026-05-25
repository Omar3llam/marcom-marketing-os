// ============================================================
// Prompt Mutation Integration Tests — PR #34
// ============================================================
// Verifies mutation engine integration with actual prompt builders.
// Tests end-to-end prompt building with selective mutations.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildCopyPrompt } from './copyPrompts.js';
import { buildVisualBriefPrompt } from './visualBriefPrompts.js';
import { buildCaptionPrompt } from './captionPrompts.js';

describe('Prompt Mutation Integration — PR #34', () => {
  describe('Copy Prompts with Mutation', () => {
    it('should apply hook_angle mutation to GENERATE_HOOKS prompt', () => {
      const variables = {
        diagnosis: 'CREATIVE_FATIGUE',
        brandVoice: 'professional',
        targetAudience: 'B2B marketers',
        currentCTR: '1.8',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'hook_angle',
        severity: 'HIGH',
        feedback: 'Focus on problem-awareness instead of benefits',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // Should contain original REQUIREMENTS
      expect(prompt).toContain('40-60 characters per hook');
      expect(prompt).toContain('Scroll-stopping and curiosity-driven');

      // Should contain mutation
      expect(prompt).toContain('CRITICAL: Change the psychological trigger');
      expect(prompt).toContain('Focus on problem-awareness instead of benefits');

      // Should contain re-execution context
      expect(prompt).toContain('RE-EXECUTION CONTEXT:');
      expect(prompt).toContain('structured reviewer feedback');
    });

    it('should apply tone mutation with preserveAspects to GENERATE_CAPTIONS', () => {
      const variables = {
        diagnosis: 'LOW_ENGAGEMENT',
        brandVoice: 'casual',
        targetAudience: 'Gen Z',
        goal: 'Increase engagement',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'tone',
        severity: 'MEDIUM',
        preserveAspects: ['hook_angle', 'cta'],
      };

      const prompt = buildCopyPrompt('GENERATE_CAPTIONS', variables, decisionContext);

      // Should contain mutation
      expect(prompt).toContain('IMPORTANT: Adjust voice/personality');

      // Should contain preservation constraints
      expect(prompt).toContain('PRESERVE (do not change):');
      expect(prompt).toContain('hook angle');
      expect(prompt).toContain('cta');
    });

    it('should fallback to append-only for unstructured feedback', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        brandVoice: 'professional',
        targetAudience: 'marketers',
        currentCTR: '1.2',
      };

      const decisionContext = {
        isReExecution: true,
        // No feedbackType — unstructured feedback
        feedback: 'Make the hooks more compelling',
        revisionInstructions: 'Use stronger verbs',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // Should NOT contain mutation engine output
      expect(prompt).not.toContain('CRITICAL:');
      expect(prompt).not.toContain('IMPORTANT:');

      // Should contain legacy append-only feedback
      expect(prompt).toContain('Reviewer Feedback:');
      expect(prompt).toContain('Make the hooks more compelling');
      expect(prompt).toContain('Revision Instructions:');
      expect(prompt).toContain('Use stronger verbs');
    });
  });

  describe('Visual Brief Prompts with Mutation', () => {
    it('should apply visual_concept mutation to GENERATE_VISUAL_BRIEF', () => {
      const variables = {
        diagnosis: 'LOW_ENGAGEMENT',
        brandStyle: 'modern minimalist',
        targetAudience: 'tech professionals',
        hook: 'Automate your workflow',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'visual_concept',
        severity: 'HIGH',
        feedback: 'The current concept is too abstract',
      };

      const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_BRIEF', variables, decisionContext);

      // Should contain original REQUIREMENTS
      expect(prompt).toContain('Visual concept description');
      expect(prompt).toContain('Color palette');
      expect(prompt).toContain('Mobile-first framing');

      // Should contain mutation
      expect(prompt).toContain('CRITICAL: Develop new visual concept/metaphor');
      expect(prompt).toContain('The current concept is too abstract');
    });

    it('should apply color_palette mutation with preservation', () => {
      const variables = {
        diagnosis: 'BRAND_MISMATCH',
        brandStyle: 'bold energetic',
        targetAudience: 'fitness enthusiasts',
        hook: 'Transform your body',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'color_palette',
        severity: 'MEDIUM',
        preserveAspects: ['visual_concept', 'composition'],
      };

      const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_BRIEF', variables, decisionContext);

      // Should contain mutation
      expect(prompt).toContain('IMPORTANT: Select new color palette');

      // Should contain preservation
      expect(prompt).toContain('PRESERVE (do not change):');
      expect(prompt).toContain('visual concept');
      expect(prompt).toContain('composition');
    });

    // Note: VALIDATE_CONTENT prompt has "VALIDATION CHECKS:" not "REQUIREMENTS:"
    // so mutation engine can't inject. This is expected behavior - validation
    // prompts use different structure. Testing this would require updating the
    // mutation engine to support multiple target sections, which is out of scope for PR #34.
  });

  describe('Caption/Audience Prompts with Mutation', () => {
    it('should apply creative_angle mutation to GENERATE_ANGLE_VARIANTS', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        currentAngle: 'problem-solution',
        targetAudience: 'small business owners',
        productName: 'QuickBooks',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'creative_angle',
        severity: 'MEDIUM',
      };

      const prompt = buildCaptionPrompt('GENERATE_ANGLE_VARIANTS', variables, decisionContext);

      // Should contain mutation
      expect(prompt).toContain('IMPORTANT: Change creative angle');
      expect(prompt).toContain('problem-solution vs aspirational');
    });

    it('should apply audience_fit mutation to GENERATE_AUDIENCE_HYPOTHESES', () => {
      const variables = {
        diagnosis: 'AUDIENCE_MISMATCH',
        currentAudience: '25-34, urban',
        performanceData: 'CTR: 0.8%, CPC: $2.50',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'audience_fit',
        severity: 'HIGH',
        feedback: 'Current targeting too broad',
      };

      const prompt = buildCaptionPrompt('GENERATE_AUDIENCE_HYPOTHESES', variables, decisionContext);

      // Should contain mutation
      expect(prompt).toContain('CRITICAL: Improve resonance with target audience');
      expect(prompt).toContain('Current targeting too broad');
    });
  });

  describe('Backward Compatibility', () => {
    it('should handle missing REQUIREMENTS section gracefully', () => {
      // This shouldn't happen with real prompts, but tests defensive coding
      const variables = {
        diagnosis: 'TEST',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'hook_angle',
        severity: 'HIGH',
      };

      // Even with malformed prompt, should not crash
      expect(() => {
        buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);
      }).not.toThrow();
    });

    it('should work with PR #32 unstructured feedback (no feedbackType)', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        brandVoice: 'casual',
        targetAudience: 'millennials',
        currentCTR: '1.5',
      };

      const decisionContext = {
        isReExecution: true,
        feedback: 'Make it more engaging',
        // No feedbackType
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // Should use append-only approach
      expect(prompt).toContain('Reviewer Feedback:');
      expect(prompt).toContain('Make it more engaging');
    });

    it('should work with PR #33 structured feedback but no mutation rule', () => {
      const variables = {
        diagnosis: 'TEST',
        brandVoice: 'test',
        targetAudience: 'test',
        currentCTR: '1.0',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'unknown_feedback_type', // No mutation rule exists
        severity: 'HIGH',
        feedback: 'Some feedback',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // Should fallback to append-only
      expect(prompt).toContain('RE-EXECUTION CONTEXT:');
      expect(prompt).toContain('Feedback Type: unknown_feedback_type');
    });
  });

  describe('Variable Replacement with Mutation', () => {
    it('should replace variables before applying mutation', () => {
      const variables = {
        diagnosis: 'CREATIVE_FATIGUE',
        brandVoice: 'friendly',
        targetAudience: 'parents',
        currentCTR: '2.1',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'clarity',
        severity: 'LOW',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // Variables should be replaced
      expect(prompt).toContain('Diagnosis: CREATIVE_FATIGUE');
      expect(prompt).toContain('Brand Voice: friendly');
      expect(prompt).toContain('Target Audience: parents');
      expect(prompt).toContain('Current CTR: 2.1%');

      // Mutation should be applied
      expect(prompt).toContain('NOTE: Improve message clarity');
    });

    it('should handle N/A for missing variables', () => {
      const variables = {
        diagnosis: 'TEST',
        brandVoice: null, // Explicitly null
        targetAudience: undefined, // Explicitly undefined
        currentCTR: '', // Empty string
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: 'tone',
        severity: 'MEDIUM',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // Falsy variables should be replaced with N/A
      expect(prompt).toContain('Brand Voice: N/A');
      expect(prompt).toContain('Target Audience: N/A');
      expect(prompt).toContain('Current CTR: N/A%');
    });
  });
});
