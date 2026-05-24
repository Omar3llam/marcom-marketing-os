import { useState } from 'react';
import { api } from '@/lib/api.js';
import { toast } from 'sonner';
import { transformDecisionsToFeed } from '@/lib/feedTransform.js';
import { useProjectId } from '@/hooks/useProjectId.js';

export function useCampaignAnalysis({ refetch, setCampaigns, setUploadOpen }) {
  const [syncing, setSyncing] = useState(false);
  const { projectId } = useProjectId();

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

  const handleMetaSync = async () => {
    if (syncing) return;
    if (!projectId) {
      toast.error('Complete onboarding before syncing Meta campaigns.');
      return;
    }
    setSyncing(true);
    try {
      await api.post('/api/campaigns/fetch-meta', { datePreset: 'last_30d', projectId });
      await refetch();
      toast.success('Meta campaigns synced.');
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Meta not connected. Go to Settings → Integrations to connect.');
      } else if (err.response?.status === 401) {
        toast.error('Meta session expired. Reconnect in Settings → Integrations.');
      } else if (err.response?.status === 400) {
        toast.error('Workspace setup incomplete. Complete onboarding first.');
      } else {
        toast.error('Sync failed. Try again in a moment.');
      }
    } finally {
      setSyncing(false);
    }
  };

  return { syncing, handleAnalysisComplete, handleMetaSync };
}
