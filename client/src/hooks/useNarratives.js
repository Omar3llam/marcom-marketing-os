// ============================================================
// MARCOM / Lumi — useNarratives (Phase 8 · the reporting surface)
// ------------------------------------------------------------
// GET  /api/lumi/narratives[?audience=]  → list persisted stakeholder narratives
// GET  /api/lumi/narratives/:id          → one narrative (full sections)
// POST /api/lumi/narratives/generate     → author one (STRATEGIST-only, 403 else)
//
// THE GUARD: a narrative is a REASONED REPORT, never a chart dump. Every figure
// the engine emitted is evidence-bound to a real row; this hook only validates
// + relays — it never derives a number. All three endpoints return the SAME
// serialized shape (StakeholderNarrativeSchema), so list/detail/generate never
// diverge. A 403 on generate is NOT an error — it's the honest "CLIENT/BUYER
// can't author" state (`isRestricted`), distinct from a real failure.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { NarrativesListResponseSchema, NarrativeResponseSchema } from '@/contracts/schemas';

export function useNarratives({ audience } = {}) {
  const [narratives, setNarratives] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRestricted, setIsRestricted] = useState(false); // 403 on generate — not a failure
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!aliveRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/narratives', { params: audience ? { audience } : undefined });
      if (!aliveRef.current) return;
      const parsed = NarrativesListResponseSchema.safeParse(res.data);
      setNarratives(parsed.success ? parsed.data.narratives : []);
      if (!parsed.success) setError(new Error('Narratives response failed contract validation'));
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
      setNarratives([]);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, [audience]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  // Fetch one narrative's full detail on demand (the list rows already carry
  // sections, but a deep-link/refresh path may want a single fetch).
  const getNarrative = useCallback(async (id) => {
    if (!id) return null;
    try {
      const res = await api.get(`/api/lumi/narratives/${id}`);
      const parsed = NarrativeResponseSchema.safeParse(res.data);
      return parsed.success ? parsed.data.narrative : null;
    } catch {
      return null;
    }
  }, []);

  // STRATEGIST-only. A 403 sets isRestricted (the honest "you can't author"
  // state); any other failure is a real error.
  const generate = useCallback(async ({ period, audience: aud } = {}) => {
    setIsGenerating(true);
    setError(null);
    setIsRestricted(false);
    try {
      const res = await api.post('/api/lumi/narratives/generate', { period, audience: aud });
      const parsed = NarrativeResponseSchema.safeParse(res.data);
      await load();
      return parsed.success ? parsed.data.narrative : null;
    } catch (err) {
      if (aliveRef.current) {
        if (err?.response?.status === 403) setIsRestricted(true);
        else setError(err);
      }
      return null;
    } finally {
      if (aliveRef.current) setIsGenerating(false);
    }
  }, [load]);

  return { narratives, isLoading, error, isRestricted, generate, isGenerating, getNarrative, refetch: load };
}
