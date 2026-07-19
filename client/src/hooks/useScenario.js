// ============================================================
// MARCOM / Lumi — useScenario (Phase 4-E · forward what-if projection)
// ------------------------------------------------------------
// POST /api/lumi/scenario { change } → validate against ScenarioResponseSchema →
// a projection where EVERY metric is a { low, expected, high } RANGE plus a
// named assumptions[] (the honesty rule, enforced server-side and re-checked
// here). NOT auto-run: a projection only exists once the user asks for one —
// nothing is fabricated on mount. `scenario` is null with a `message` when the
// account has no channel data to project against.
//
// Its blendedCacMinor is a PROJECTED range — distinct from the realized current
// CAC on the unit-economics surface; the UI labels it as projected.
//
// THE PRODUCT SEAM: /scenario is requirePlan('PRO') server-side. A 403 is NOT an
// error — it's an honest LOCKED state (`gated`), so the view renders an upgrade
// prompt rather than a failure. Detection mirrors useIncrementality exactly
// (err?.response?.status === 403 → gated=true, error=null — never both set).
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { ScenarioResponseSchema } from '@/contracts/schemas';

export function useScenario() {
  const [scenario, setScenario] = useState(null);
  const [message, setMessage] = useState(null);
  const [gated, setGated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const run = useCallback(async (change) => {
    setLoading(true);
    setError(null);
    setMessage(null); // a fresh run must not show a prior run's message
    try {
      const res = await api.post('/api/lumi/scenario', { change });
      if (!aliveRef.current) return null;
      const parsed = ScenarioResponseSchema.safeParse(res.data);
      setGated(false);
      if (!parsed.success) {
        setScenario(null);
        setError(new Error('Scenario response failed contract validation'));
        return null;
      }
      setScenario(parsed.data.scenario);
      setMessage(parsed.data.message ?? null);
      return parsed.data.scenario;
    } catch (err) {
      if (!aliveRef.current) return null;
      // 403 = tier-gated. An honest locked state, not a failure.
      if (err?.response?.status === 403) { setGated(true); setScenario(null); setError(null); }
      else { setGated(false); setError(err); } // clear stale lock on a real failure
      return null;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  return { scenario, message, gated, loading, error, run };
}
