// ============================================================
// MARCOM / Lumi — useAccountBriefing
// ------------------------------------------------------------
// Fetches GET /api/lumi/briefing (Phase 5 Memory Moat) and validates it against
// BriefingSchema — the contract for "what Lumi has learned about this account".
// Every pattern is a truth-weighted AccountPattern row (statement, status,
// accuracy = "was Lumi right?", confidence). On a contract mismatch we surface
// only the structurally-safe subset (patterns stay real) and log, rather than
// render an unvalidated shape — never fabricate.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { BriefingSchema } from '@/contracts/schemas/briefing.schema';

export function useAccountBriefing() {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/briefing');
      if (!aliveRef.current) return;
      const parsed = BriefingSchema.safeParse(res.data);
      if (parsed.success) {
        setBriefing(parsed.data);
      } else {
        // Contract drift — don't drop real patterns, but don't render an
        // unvalidated shape either: keep only what's structurally safe.
        console.warn('[useAccountBriefing] briefing contract mismatch:', parsed.error?.issues?.[0]);
        const raw = res.data || {};
        setBriefing({
          patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
          promotableCount: Number.isInteger(raw.promotableCount) ? raw.promotableCount : 0,
          conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
          network: raw.network ?? null,
        });
      }
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  // Opt this workspace in/out of the anonymized cross-account network.
  // Server gates this to STRATEGIST (403 otherwise); we don't trust the POST
  // body — we re-read /briefing (the validated source of truth) so the
  // displayed consent + insights reflect what the backend actually stored.
  const setConsent = useCallback(async (optIn, cohortTag) => {
    setConsentBusy(true);
    try {
      await api.post('/api/lumi/network/consent', { optIn, ...(cohortTag != null && { cohortTag }) });
      if (!aliveRef.current) return;
      await refetch();
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current) setConsentBusy(false);
    }
  }, [refetch]);

  useEffect(() => {
    aliveRef.current = true;
    refetch();
    return () => { aliveRef.current = false; };
  }, [refetch]);

  return { briefing, loading, error, refetch, setConsent, consentBusy };
}
