/**
 * useDecisionFeed — Fetch and manage Lumi decision feed
 *
 * Handles:
 * - Feed fetching with contract validation
 * - Result pattern error handling
 * - Contract drift telemetry
 * - Request state management
 *
 * @example
 * ```tsx
 * const { state, data, error, refetch } = useDecisionFeed();
 *
 * if (state === 'loading') return <LoadingView />;
 * if (state === 'error') return <ErrorView error={error} onRetry={refetch} />;
 * if (state === 'success') return <FeedView data={data} />;
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { track } from '@/lib/telemetry';
import { parseLumiFeed } from '@/contracts/adapters';
import { ParsingError, ApiError, AppError } from '@/contracts/errors';
import { trackContractDrift } from '@/contracts/telemetry/contractDrift';
import type { LumiFeedResponse } from '@/contracts/schemas';
import type { RequestState } from '@/types/errors';

export interface UseDecisionFeedResult {
  state: RequestState;
  data: LumiFeedResponse | null;
  error: AppError | null;
  refetch: () => void;
}

export function useDecisionFeed(): UseDecisionFeedResult {
  const [state, setState] = useState<RequestState>('idle');
  const [data, setData] = useState<LumiFeedResponse | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const fetchFeed = useCallback(async () => {
    setState('loading');
    track('api_call', { endpoint: '/api/lumi/feed', version: 'v2' });

    try {
      // Fetch raw response
      const response = await api.get('/api/lumi/feed');

      // Validate and normalize via adapter (Result pattern)
      const result = parseLumiFeed(response.data);

      if (!result.success) {
        // Contract validation failed
        setError(result.error);
        setState('error');

        // Track contract drift for backend monitoring
        if (result.error instanceof ParsingError) {
          trackContractDrift(result.error);
        }

        track('api_error', {
          endpoint: '/api/lumi/feed',
          version: 'v2',
          classification: result.error.classification,
          message: result.error.message,
        });

        return;
      }

      // Success — data is validated and normalized
      setData(result.data);
      setState('success');
      track('api_call', {
        endpoint: '/api/lumi/feed',
        version: 'v2',
        success: true,
        campaignCount: result.data.campaigns.length,
        alertCount: result.data.campaigns.reduce((acc, c) => acc + c.alerts.length, 0),
      });
    } catch (err) {
      // Network or API error
      const apiError = new ApiError({
        message: err instanceof Error ? err.message : 'Failed to fetch feed',
        endpoint: '/api/lumi/feed',
        method: 'GET',
        httpStatus: (err as any).response?.status,
        cause: err instanceof Error ? err : undefined,
      });

      setError(apiError);
      setState('error');
      track('api_error', {
        endpoint: '/api/lumi/feed',
        version: 'v2',
        classification: apiError.classification,
        httpStatus: apiError.httpStatus,
        message: apiError.message,
      });
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  return {
    state,
    data,
    error,
    refetch: fetchFeed,
  };
}
