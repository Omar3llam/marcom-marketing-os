import { useState, useEffect } from 'react';
import { api } from '@/lib/api.js';

export function useMemory() {
  const [data, setData]     = useState({ patterns: [], narratives: [], total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/memory/patterns')
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const recordDecision = async ({ campaignId, actionType, decisionRationale }) => {
    try {
      await api.post('/api/memory/record', { campaignId, actionType, decisionRationale });
    } catch {}
  };

  return { ...data, loading, recordDecision };
}
