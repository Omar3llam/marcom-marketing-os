// ============================================================
// MARCOM / Lumi — useAccountBriefing
// ------------------------------------------------------------
// Fetches GET /api/lumi/briefing (Phase 5 Memory Moat) and validates it against
// BriefingSchema — the contract for "what Lumi has learned about this account".
// Every pattern is a truth-weighted AccountPattern row (statement, status,
// accuracy = "was Lumi right?", confidence).
//
// A contract mismatch is an ERROR: this hook reports it and holds NO briefing
// beside it, so a caller can tell "this account has learned nothing" from "we
// could not read what it learned". These four lines used to describe a salvage
// instead — and the salvage is precisely what made the first of those two
// render as the second, while ending on the words "never fabricate".
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
      if (!parsed.success) {
        // ACROSS Tier 1 — a parse failure is an INABILITY TO KNOW, never an
        // empty result. What stood here salvaged: it rebuilt a briefing from
        // the unvalidated payload and left `error` null, so a response we could
        // not read reached the operator as "No established patterns yet" — a
        // claim about what Lumi has learned, made from a read it did not
        // understand. `promotableCount: 0` and `conflicts: []` were invented
        // outright, three lines under a header that said "never fabricate".
        //
        // HTTP success ≠ semantic success. The view already renders `error`
        // honestly; it was this branch that could never produce one.
        setBriefing(null);
        setError(new Error('Briefing response failed contract validation'));
        return;
      }
      setBriefing(parsed.data);
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
  // R11 (F12): no cohort argument. The server assigns the cohort from a
  // controlled attribute and REFUSES a caller-supplied one with 400, so
  // sending a tag here would break the opt-in rather than choose a cohort.
  const setConsent = useCallback(async (optIn) => {
    setConsentBusy(true);
    try {
      await api.post('/api/lumi/network/consent', { optIn });
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
