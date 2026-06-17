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
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { ScenarioResponseSchema } from '@/contracts/schemas';

export function useScenario() {
  const [scenario, setScenario] = useState(null);
  const [message, setMessage] = useState(null);
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
    try {
      const res = await api.post('/api/lumi/scenario', { change });
      if (!aliveRef.current) return null;
      const parsed = ScenarioResponseSchema.safeParse(res.data);
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
      setError(err);
      return null;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  return { scenario, message, loading, error, run };
}
