// ============================================================
// Structured Feedback Prompt Building Tests — PR #33/34
// ============================================================
// Verifies that prompt builders generate targeted guidance
// based on structured feedback (feedbackType + severity + preserveAspects).
//
// PR #34 UPDATE: Tests now expect mutation engine format (surgical REQUIREMENTS
// modifications) instead of append-only format.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildCopyPrompt } from './copyPrompts.js';
import { buildVisualBriefPrompt } from './visualBriefPrompts.js';
import { buildCaptionPrompt } from './captionPrompts.js';
import { FEEDBACK_TYPE, SEVERITY, PRESERVE_ASPECT } from '../../../types/feedbackTypes.js';

describe('Structured Feedback Prompt Building', () => {
  describe('Copy Prompts with Structured Feedback', () => {
    it('should build targeted guidance for HOOK_ANGLE feedback', () => {
      const variables = {
        diagnosis: 'CREATIVE_FATIGUE',
        brandVoice: 'professional',
        targetAudience: 'B2B marketers',
        currentCTR: 1.8,
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.HOOK_ANGLE,
        severity: SEVERITY.HIGH,
        feedback: 'Add urgency trigger in first 5 words',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // PR #34: Mutation engine injects into REQUIREMENTS section
      expect(prompt).toContain('REQUIREMENTS:');
      expect(prompt).toContain('CRITICAL: Change the psychological trigger');
      expect(prompt).toContain('Add urgency trigger in first 5 words');
      expect(prompt).toContain('RE-EXECUTION CONTEXT');
      expect(prompt).toContain('structured reviewer feedback');
    });

    it('should build targeted guidance for TONE feedback', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        brandVoice: 'casual',
        targetAudience: 'Gen Z',
        currentCTR: 0.5,
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.TONE,
        severity: SEVERITY.MEDIUM,
        feedback: 'Too formal, needs to be more casual',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // PR #34: Mutation engine format
      expect(prompt).toContain('IMPORTANT: Adjust voice/personality');
      expect(prompt).toContain('Too formal, needs to be more casual');
    });

    it('should include preserveAspects in prompt', () => {
      const variables = {
        diagnosis: 'CREATIVE_FATIGUE',
        brandVoice: 'professional',
        targetAudience: 'B2B',
        currentCTR: 1.2,
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.HOOK_ANGLE,
        preserveAspects: [PRESERVE_ASPECT.BRAND_VOICE, PRESERVE_ASPECT.CTA],
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      // PR #34: Preservation constraints in REQUIREMENTS section
      expect(prompt).toContain('PRESERVE (do not change):');
      expect(prompt).toContain('brand voice');
      expect(prompt).toContain('cta');
    });

    it('should fallback to unstructured feedback when feedbackType is missing', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        brandVoice: 'professional',
        targetAudience: 'B2B',
        currentCTR: 1.0,
      };

      const decisionContext = {
        isReExecution: true,
        feedback: 'Make hooks more compelling',
        revisionInstructions: 'Focus on pain points',
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      expect(prompt).toContain('RE-EXECUTION CONTEXT');
      expect(prompt).toContain('Reviewer Feedback');
      expect(prompt).toContain('Make hooks more compelling');
      expect(prompt).toContain('Revision Instructions');
      expect(prompt).toContain('Focus on pain points');
    });
  });

  describe('Visual Brief Prompts with Structured Feedback', () => {
    it('should build targeted guidance for VISUAL_CONCEPT feedback', () => {
      const variables = {
        diagnosis: 'CREATIVE_FATIGUE',
        brandStyle: 'modern minimalist',
        targetAudience: 'millennials',
        hook: 'Transform your workflow',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.VISUAL_CONCEPT,
        severity: SEVERITY.HIGH,
        feedback: 'Concept too generic, needs more specificity',
      };

      const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_BRIEF', variables, decisionContext);

      // PR #34: Mutation engine format
      expect(prompt).toContain('CRITICAL: Develop new visual concept/metaphor');
      expect(prompt).toContain('Concept too generic, needs more specificity');
    });

    it('should build targeted guidance for COLOR_PALETTE feedback', () => {
      const variables = {
        diagnosis: 'LOW_ENGAGEMENT',
        brandStyle: 'vibrant',
        targetAudience: 'Gen Z',
        hook: 'Stand out',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.COLOR_PALETTE,
        severity: SEVERITY.MEDIUM,
        feedback: 'Colors too muted, need more vibrance',
        preserveAspects: [PRESERVE_ASPECT.VISUAL_CONCEPT],
      };

      const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_BRIEF', variables, decisionContext);

      // PR #34: Mutation engine format
      expect(prompt).toContain('IMPORTANT: Select new color palette');
      expect(prompt).toContain('Colors too muted, need more vibrance');
      expect(prompt).toContain('PRESERVE (do not change):');
      expect(prompt).toContain('visual concept');
    });
  });

  describe('Caption Prompts with Structured Feedback', () => {
    it('should build targeted guidance for AUDIENCE_FIT feedback', () => {
      const variables = {
        diagnosis: 'AUDIENCE_MISMATCH',
        currentAudience: 'broad',
        performanceData: { ctr: 0.5 },
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.AUDIENCE_FIT,
        severity: SEVERITY.HIGH,
        feedback: 'Too broad, need to narrow to tech professionals',
      };

      const prompt = buildCaptionPrompt('GENERATE_AUDIENCE_HYPOTHESES', variables, decisionContext);

      // PR #34: Mutation engine format
      expect(prompt).toContain('CRITICAL: Improve resonance with target audience');
      expect(prompt).toContain('Too broad, need to narrow to tech professionals');
    });

    it('should build targeted guidance for CREATIVE_ANGLE feedback', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        currentAngle: 'problem-solution',
        targetAudience: 'entrepreneurs',
        productName: 'TaskMaster Pro',
      };

      const decisionContext = {
        isReExecution: true,
        feedbackType: FEEDBACK_TYPE.CREATIVE_ANGLE,
        severity: SEVERITY.MEDIUM,
        feedback: 'Try aspirational instead of problem-focused',
      };

      const prompt = buildCaptionPrompt('GENERATE_ANGLE_VARIANTS', variables, decisionContext);

      // PR #34: Mutation engine format
      expect(prompt).toContain('IMPORTANT: Change creative angle');
      expect(prompt).toContain('problem-solution vs aspirational');
      expect(prompt).toContain('Try aspirational instead');
    });
  });

  describe('Backward Compatibility', () => {
    it('should work without any decision context (initial execution)', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        brandVoice: 'professional',
        targetAudience: 'B2B',
        currentCTR: 1.0,
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables);

      expect(prompt).not.toContain('RE-EXECUTION CONTEXT');
      expect(prompt).toContain('Generate 3 high-converting ad hooks');
    });

    it('should work with isReExecution=false', () => {
      const variables = {
        diagnosis: 'LOW_CTR',
        brandVoice: 'professional',
        targetAudience: 'B2B',
        currentCTR: 1.0,
      };

      const decisionContext = {
        isReExecution: false,
      };

      const prompt = buildCopyPrompt('GENERATE_HOOKS', variables, decisionContext);

      expect(prompt).not.toContain('RE-EXECUTION CONTEXT');
    });
  });
});
