// ============================================================
// MARCOM / Lumi — useFatigueForecast
// ------------------------------------------------------------
// GET /api/lumi/entities/fatigue → per-campaign fatigue forecast (NAMED):
//   [{ entityId, name, channel, currentFrequency, velocity,
//      daysUntilSaturation, status, confidence }]
// Read-only; the server reuses the least-squares forecaster over the connector
// substrate. Honest states: loading, error (→ empty), and empty (→ panel hides).
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';

export function useFatigueForecast() {
  const [forecast, setForecast] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/entities/fatigue');
      if (!aliveRef.current) return;
      setForecast(Array.isArray(res.data?.forecast) ? res.data.forecast : []);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
      setForecast([]);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  return { forecast, isLoading, error, refetch: load };
}
