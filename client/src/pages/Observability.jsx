// ============================================================
// MARCOM / Lumi — Mission Control (Observability Dashboard)
// ============================================================
// Real-time execution monitoring. Auto-refreshes every 5 seconds.
// ============================================================
import { useState, useEffect } from 'react';
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

  const fetchData = async () => {
    try {
      const [live, providers, failures] = await Promise.all([
        api.get('/api/observability/live'),
        api.get('/api/observability/providers'),
        api.get('/api/observability/failures'),
      ]);
      setLiveData(live.data);
      setProvidersData(providers.data);
      setFailuresData(failures.data);
      setError(null);
    } catch (err) {
      console.error('[Observability] Fetch error:', err);
      setError(err.response?.data?.error || 'Failed to load observability data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
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
