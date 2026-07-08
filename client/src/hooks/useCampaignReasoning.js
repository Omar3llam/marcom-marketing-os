// ============================================================
// MARCOM / Lumi — useCampaignReasoning
// ------------------------------------------------------------
// On-demand LLM reasoning for a single connector campaign's verdict.
// POST /api/lumi/entities/:id/reasoning → { reasoning }. Generated only when the
// marketer asks (a click) — never pre-fetched.
//
// SESSION CACHE: a module-level Map<entityId, reasoning>. Clicking the same
// campaign twice (or collapsing + re-expanding) shows the cached read instantly,
// with NO second API call. The cache lives for the tab session (module scope),
// which matches the ephemeral, non-persisted nature of the feature.
//
// The body carries only an optional `dialect` language hint; every metric is
// re-derived server-side, so the client never supplies numbers.
// ============================================================
import { useState, useCallback } from 'react';
import { api } from '@/lib/api.js';

const reasoningCache = new Map(); // entityId → reasoning string (session-lived)

/** Pure read of the session cache — lets a panel show a cached read on mount. */
export function getCachedReasoning(entityId) {
  return reasoningCache.get(entityId) ?? null;
}

export function useCampaignReasoning() {
  const [reasoning, setReasoning] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (entityId, { dialect } = {}, { bypassCache = false } = {}) => {
    if (!entityId) return null;

    if (!bypassCache && reasoningCache.has(entityId)) {
      const cached = reasoningCache.get(entityId);
      setReasoning(cached);
      setError(null);
      return cached; // instant — no spinner, no API call
    }

    setIsGenerating(true);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/entities/${entityId}/reasoning`, dialect ? { dialect } : {});
      const text = res.data?.reasoning ?? '';
      reasoningCache.set(entityId, text);
      setReasoning(text);
      return text;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const getReasoning = useCallback((entityId, opts) => request(entityId, opts), [request]);

  // Regenerate ignores the cache (and refreshes it) — the small secondary action.
  const regenerate = useCallback((entityId, opts) => {
    reasoningCache.delete(entityId);
    return request(entityId, opts, { bypassCache: true });
  }, [request]);

  return { getReasoning, regenerate, reasoning, isGenerating, error };
}
