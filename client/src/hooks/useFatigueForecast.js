// ============================================================
// MARCOM / Lumi — useFatigueForecast
// ------------------------------------------------------------
// GET /api/lumi/entities/fatigue → per-campaign fatigue forecast (NAMED):
//   [{ entityId, name, channel, currentFrequency, velocity,
//      daysUntilSaturation, status, confidence }]
// Read-only; the server reuses the least-squares forecaster over the connector
// substrate. Loading/error stay explicit; only successful empty hides the panel.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';

export function useFatigueForecast() {
  const [forecast, setForecast] = useState([]);
  const [frequencyCeiling, setFrequencyCeiling] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const attemptRef = useRef(0);

  const load = useCallback(async () => {
    if (!aliveRef.current) return;
    const attempt = ++attemptRef.current;
    setIsLoading(true);
    setError(null);
    setFrequencyCeiling(null);
    try {
      const res = await api.get('/api/lumi/entities/fatigue');
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      setForecast(Array.isArray(res.data?.forecast) ? res.data.forecast : []);
      const ceiling = res.data?.frequencyCeiling;
      setFrequencyCeiling(Array.isArray(res.data?.forecast) && typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null);
    } catch (err) {
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      setError(err);
      setForecast([]);
      setFrequencyCeiling(null);
    } finally {
      if (aliveRef.current && attempt === attemptRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const attempts = attemptRef;
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; ++attempts.current; };
  }, [load]);

  return { forecast, frequencyCeiling, isLoading, error, refetch: load };
}
