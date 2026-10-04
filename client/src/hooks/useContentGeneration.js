// ============================================================
// MARCOM / Lumi — useContentGeneration
// ------------------------------------------------------------
// Hook for Content Lab content generation flow.
// Handles API call, loading states, error handling, and retry.
// ============================================================
import { useState, useCallback } from 'react';
import { api } from '@/lib/api.js';

/**
 * Hook for generating marketing content via Content Lab
 * @returns {object} - { generate, content, loading, error, reset }
 */
export function useContentGeneration() {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Generate content with options
   * @param {object} params - { campaignContext, options, tone, brandVoice,
   *                            targetAudience, industry, objective, format,
   *                            dimensions }
   *   tone/brandVoice/targetAudience/industry/objective are the real onboarding
   *   signals (resolved client-side); campaignContext carries the picked
   *   campaign's diagnosis + ctr; format/dimensions come from the visual-format
   *   picker (drive the visual brief).
   */
  const generate = useCallback(async ({
    campaignContext, options, tone, brandVoice, targetAudience, industry, objective, format, dimensions,
  }) => {
    setLoading(true);
    setError(null);
    setContent(null);

    try {
      const response = await api.post('/api/tools/content-generate', {
        campaignContext,
        options,
        tone,
        brandVoice,
        targetAudience,
        industry,
        objective,
        format,
        dimensions,
      });

      if (response.data?.status === 'ok' && response.data?.content) {
        setContent(response.data.content);
      } else {
        throw new Error('Invalid response format from server');
      }

    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Content generation failed';
      setError(errorMessage);
      console.error('[useContentGeneration] Error:', err);

    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Reset to initial state
   */
  const reset = useCallback(() => {
    setContent(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    generate,
    content,
    loading,
    error,
    reset,
  };
}
