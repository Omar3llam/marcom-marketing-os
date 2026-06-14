// ============================================================
// MARCOM / Lumi — useConnectorCampaigns
// ------------------------------------------------------------
// Reads the connector entity-graph surface (GET /api/lumi/entities/campaigns):
// the substrate connector sync writes (Campaign entities + MetricSnapshot),
// DISJOINT from the legacy CampaignState feed that useCampaignFeed reads. This
// is why "Sync Live Meta" results show up here, not in the CSV-fed table.
//
// Returns: { campaigns, loading, error, refetch }
//   campaigns[]: { entityId, channel, name, adSetCount, spendMinor, roas, ctr,
//                  frequency, currency, lastDate }  — metrics are null-when-absent.
//
// Honest states are the caller's job; this hook just exposes loading/error/data.
// useEffect has a cleanup guard (no setState after unmount) per the ONE WAY rules.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useConnectorCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/entities/campaigns');
      if (!aliveRef.current) return;
      setCampaigns(Array.isArray(res.data?.campaigns) ? res.data.campaigns : []);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refetch();
    return () => { aliveRef.current = false; };
  }, [refetch]);

  return { campaigns, loading, error, refetch };
}
