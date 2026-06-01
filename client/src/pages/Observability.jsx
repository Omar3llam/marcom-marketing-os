// ============================================================
// MARCOM / Lumi — Mission Control (Observability Dashboard)
// ============================================================
// Real-time execution monitoring. Auto-refreshes every 5 seconds.
// ============================================================
import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { MetricsSummary }    from '@/components/observability/MetricsSummary.jsx';
import { ProviderPerformance } from '@/components/observability/ProviderPerformance.jsx';
import { ExecutionTable }    from '@/components/observability/ExecutionTable.jsx';

export default function Observability() {
  const [liveData, setLiveData] = useState(null);
  const [providersData, setProvidersData] = useState(null);
  const [failuresData, setFailuresData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Holds the interval ID so fetchData can clear it on non-retryable auth errors.
  const intervalRef = useRef(null);

  const fetchData = async (signal) => {
    try {
      const [live, providers, failures] = await Promise.all([
        api.get('/api/observability/live', { signal }),
        api.get('/api/observability/providers', { signal }),
        api.get('/api/observability/failures', { signal }),
      ]);
      setLiveData(live.data);
      setProvidersData(providers.data);
      setFailuresData(failures.data);
      setError(null);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      console.error('[Observability] Fetch error:', err);
      const status = err?.httpStatus;
      if (status === 401 || status === 403) {
        // Auth errors won't resolve by retrying — stop polling immediately.
        clearInterval(intervalRef.current);
        setError('Unable to load — workspace not found or session invalid. Reload the page.');
      } else {
        setError(err?.message || 'Failed to load observability data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    intervalRef.current = setInterval(() => fetchData(ctrl.signal), 5000);
    return () => {
      ctrl.abort();
      clearInterval(intervalRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark">
        <div className="text-dark-soft">Loading mission control...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark">
        <div className="text-signal-kill">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-dark p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[1.5rem] font-bold text-dark-base">
              🛰️ LUMI Mission Control
            </h1>
            <p className="font-body text-sm text-dark-soft">
              Live execution monitoring · Auto-refreshes every 5s
            </p>
          </div>
          <div className="font-mono text-xs text-dark-soft">
            Last update: {liveData ? new Date(liveData.generated_at).toLocaleTimeString() : '—'}
          </div>
        </div>

        <MetricsSummary liveData={liveData} />
        <ProviderPerformance providersData={providersData} />
        <ExecutionTable liveData={liveData} failuresData={failuresData} />
      </div>
    </div>
  );
}
