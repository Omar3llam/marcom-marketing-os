import { api } from '@/api/client';

export async function fetchRecentDecisions() {
  const response = await api.get('/api/memory/patterns');
  const narratives = response.data?.narratives || [];
  return narratives.map(mapNarrativeToDecision);
}

export function mapNarrativeToDecision(narrative) {
  const line = String(narrative?.line || '');
  return {
    id: narrative?.id,
    campaign: extractCampaignName(line),
    verdict: extractVerdict(line),
    timestamp: formatRelativeTimestamp(narrative?.recorded),
  };
}

function extractCampaignName(line) {
  const [campaign] = line.split(/\s*(?:\u2014|\u00e2\u20ac\u201d)\s*/);
  return campaign?.trim() || 'Unknown';
}

function extractVerdict(line) {
  if (line.includes('KILL')) return 'KILL';
  if (line.includes('SCALE')) return 'SCALE';
  if (line.includes('HOLD')) return 'HOLD';
  return 'TEST';
}

function formatRelativeTimestamp(date) {
  if (!date) return 'recent';

  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (!Number.isFinite(diffMs)) return 'recent';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}
