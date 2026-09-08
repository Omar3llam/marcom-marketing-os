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
//                  frequency, conversions, revenueMinor, impressions, clicks,
//                  currency, lastDate }  — metrics null-when-absent.
//
// Honest states are the caller's job; this hook just exposes loading/error/data.
// useEffect has a cleanup guard (no setState after unmount) per the ONE WAY rules.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';
import { ConnectorCampaignsResponseSchema } from '@/contracts/schemas';

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
      // PARITY-04 — parse at the boundary. What stood here was
      // `Array.isArray(res.data?.campaigns) ? … : []`, so a 200 whose shape had
      // changed became an empty list with `error` null: a malformed response
      // rendering as a measured empty account.
      //
      //     HTTP success ≠ semantic success
      //
      // A failed parse is an ERROR, never an empty collection. A VALID empty
      // collection still passes through as empty — that one is a fact.
      const parsed = ConnectorCampaignsResponseSchema.safeParse(res.data);
      if (!parsed.success) {
        setCampaigns([]);
        setError(new Error('Campaigns response failed contract validation'));
        return;
      }
      setCampaigns(parsed.data.campaigns);
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
