import { useQuery } from '@tanstack/react-query';
import { fetchRecentDecisions } from './services.js';

export const shellQueryKeys = {
  recentDecisions: ['shell', 'recent-decisions'],
};

export function useRecentDecisions() {
  return useQuery({
    queryKey: shellQueryKeys.recentDecisions,
    queryFn: fetchRecentDecisions,
    staleTime: 60_000,
  });
}
