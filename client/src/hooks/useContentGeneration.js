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
  const [progress, setProgress] = useState(0);

  /**
   * Generate content with options
   * @param {object} params - { campaignContext, options, tone, brandVoice }
   */
  const generate = useCallback(async ({ campaignContext, options, tone, brandVoice }) => {
    setLoading(true);
    setError(null);
    setProgress(0);
    setContent(null);

    // Simulate progress for UX (real API call happens in parallel)
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return 95; // Cap at 95% until real response
        return prev + Math.random() * 15;
      });
    }, 150);

    try {
      const response = await api.post('/api/tools/content-generate', {
        campaignContext,
        options,
        tone,
        brandVoice,
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (response.data?.status === 'ok' && response.data?.content) {
        setContent(response.data.content);
      } else {
        throw new Error('Invalid response format from server');
      }

    } catch (err) {
      clearInterval(progressInterval);
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
    setProgress(0);
  }, []);

  return {
    generate,
    content,
    loading,
    error,
    progress,
    reset,
  };
}
