import { useState } from 'react';
import { api } from '@/lib/api.js';
import { toast } from 'sonner';
import { transformDecisionsToFeed } from '@/lib/feedTransform.js';

export function useCampaignAnalysis({ refetch, setCampaigns, setUploadOpen, refetchConnectors, refetchVerdicts }) {
  const [syncing, setSyncing] = useState(false);

  const handleAnalysisComplete = (uploadResult) => {
    if (uploadResult.mode === 'analyze' && uploadResult.decisions) {
      const transformed = transformDecisionsToFeed(uploadResult);
      setCampaigns(transformed);
      setUploadOpen(false);
    } else {
      refetch();
      setUploadOpen(false);
    }
  };

  // Sync Live Meta → drives the CONNECTOR pipeline (workspace-scoped), the same
  // path as the cron: authenticate → fetchRaw → normalize → landSnapshots. It
  // writes the entity graph + MetricSnapshot (read by <ConnectorCampaignsPanel>),
  // NOT the legacy CampaignState feed — so we refetch the CONNECTOR surface, not
  // the CSV feed, to show what actually landed. The button is workspace-scoped;
  // connectors read marcom_credentials by workspace_id (the Phase 12c bridge),
  // so there is no projectId to gate on.
  const handleMetaSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.post('/api/lumi/connections/sync', { datePreset: 'last_30d' });
      const { synced = 0, failed = 0, results = [] } = res.data || {};
      const skipped = results.filter((r) => r.status === 'skipped').length;
      const records = results
        .filter((r) => r.status === 'success')
        .reduce((n, r) => n + (r.snapshots || 0), 0);

      if (synced === 0 && failed === 0 && skipped === 0) {
        toast.info('No connected channels to sync. Connect Meta or Google in Settings → Integrations.');
      } else if (synced === 0) {
        // Every channel failed or was skipped (e.g. an expired token).
        toast.error('Sync couldn’t reach your channels. Reconnect in Settings → Integrations.');
      } else if (records === 0) {
        toast.info('Synced — no campaign data returned for the last 30 days.');
        await Promise.all([refetchConnectors?.(), refetchVerdicts?.()]);
      } else {
        toast.success(`Synced ${synced} channel${synced === 1 ? '' : 's'} · ${records} record${records === 1 ? '' : 's'}.`);
        await Promise.all([refetchConnectors?.(), refetchVerdicts?.()]);
      }
    } catch (err) {
      const status = err?.httpStatus ?? err?.response?.status;
      if (status === 401) toast.error('Session expired. Please sign in again.');
      else if (status === 400) toast.error('No workspace found. Complete onboarding first.');
      else toast.error('Sync failed. Try again in a moment.');
    } finally {
      setSyncing(false);
    }
  };

  return { syncing, handleAnalysisComplete, handleMetaSync };
}
