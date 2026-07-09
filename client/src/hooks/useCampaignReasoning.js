// ============================================================
// MARCOM / Lumi — useCampaignReasoning
// ------------------------------------------------------------
// Reads the PRE-GENERATED "Lumi's Read" for a connector campaign.
// GET /api/lumi/entities/:id/reasoning → { reasoning, verdict, impactScore,
// generatedAt, stale }. Reasoning is written by the agentic sweep (top-N by
// impact) — never on demand — so this is a cheap read the panel shows instantly
// on expand. No row yet → { reasoning: null } (the panel says "after the next
// sweep"); a row past the stale window → stale: true.
//
// SESSION CACHE: a module-level Map<entityId, payload> so re-expanding the same
// campaign (or remounting the row) serves the last read with NO second request.
// Cached for the tab session; a page reload re-reads.
// ============================================================
import { useState, useCallback } from 'react';
import { api } from '@/lib/api.js';

const reasoningCache = new Map(); // entityId → { reasoning, stale, generatedAt }

/** Pure read of the session cache. */
export function getCachedReasoning(entityId) {
  return reasoningCache.get(entityId) ?? null;
}

export function useCampaignReasoning() {
  const [reasoning, setReasoning] = useState(null);
  const [stale, setStale] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (entityId) => {
    if (!entityId) return null;

    if (reasoningCache.has(entityId)) {
      const cached = reasoningCache.get(entityId);
      setReasoning(cached.reasoning);
      setStale(cached.stale);
      setGeneratedAt(cached.generatedAt);
      setError(null);
      return cached; // instant — no request
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/lumi/entities/${entityId}/reasoning`);
      const payload = {
        reasoning: res.data?.reasoning ?? null,
        stale: res.data?.stale ?? false,
        generatedAt: res.data?.generatedAt ?? null,
      };
      reasoningCache.set(entityId, payload);
      setReasoning(payload.reasoning);
      setStale(payload.stale);
      setGeneratedAt(payload.generatedAt);
      return payload;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { load, reasoning, stale, generatedAt, isLoading, error };
}
