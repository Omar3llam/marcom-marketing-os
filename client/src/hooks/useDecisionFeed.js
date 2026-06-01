import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import {
  useDecisionFSM,
  loadHistoryFromStorage,
  loadRadarAlertsFromStorage,
} from '@/fsm/useDecisionFSMCompat';
import { useOrchestrate } from '@/hooks/useOrchestrate.js';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { useMemory } from '@/hooks/useMemory.js';
import { useSSE } from '@/services/useSSE';
import { api } from '@/lib/api.js';

export function useDecisionFeed() {
  const { currentUser } = useAuth();
  const {
    state, dispatch, abortSignal,
    startFlow, reviewAlert, submitInput, reportSuccess, reportError,
    confirmExecution, executeAction, executionComplete, commitToMemory,
    reset, replay, loadRadarAlerts, updateExecutionStatus,
  } = useDecisionFSM();

  const { execute, cancel } = useOrchestrate({
    onSuccess: reportSuccess,
    onError:   reportError,
    onStep:    (step) => dispatch({ type: 'THEATRE_ADVANCE', step }),
  });

  const { summary } = useCampaignFeed();
  const { recordDecision } = useMemory();
  const { refresh } = useIntelligence();

  const [metaStatus, setMetaStatus] = useState('unknown');

  // Stable ref so the radar effect only fires once (not on every loadRadarAlerts identity change).
  const loadRadarAlertsRef = useRef(loadRadarAlerts);
  useEffect(() => { loadRadarAlertsRef.current = loadRadarAlerts; }, [loadRadarAlerts]);

  useEffect(() => {
    const history = loadHistoryFromStorage();
    if (history.length > 0) dispatch({ type: 'LOAD_HISTORY', history });
    const alerts = loadRadarAlertsFromStorage();
    if (alerts.length > 0) loadRadarAlertsRef.current(alerts);
  }, [dispatch]);

  // Fetch radar alerts exactly once on mount.
  // 503 = Meta not configured — stop immediately, do not retry.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/paid/radar')
      .then((res) => {
        if (cancelled) return;
        const alerts = res.data?.alerts;
        if (Array.isArray(alerts) && res.data?.source !== 'mock') {
          loadRadarAlertsRef.current(alerts);
          setMetaStatus('connected');
          try { localStorage.setItem('lumi:radarAlerts', JSON.stringify(alerts)); } catch { /* quota exceeded */ }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 503) {
          console.warn('[RadarFetch] Meta Ads not connected (503) — radar polling suspended');
          setMetaStatus('disconnected');
        } else {
          console.warn('[RadarFetch] live fetch failed:', status, err?.message);
        }
      });
    return () => { cancelled = true; };
  }, []); // intentional: fire once — 503 means not configured, retry on next page load after user connects

  const { state: sseState, metrics: sseMetrics } = useSSE({
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[DecisionFeed] SSE message:', data);
        if (data.type === 'EXECUTION_STATUS') {
          const { status, error, timestamp, actionType, targetId } = data;
          updateExecutionStatus(status, error, timestamp);
          if (status === 'QUEUED') {
            toast.info('Action queued', { description: `${actionType || 'Action'} for ${targetId || 'target'}`, duration: 2000 });
          } else if (status === 'EXECUTING') {
            toast.loading('Executing action...', { description: 'Applying changes to Meta Ads', duration: 2000 });
          } else if (status === 'EXECUTED_SUCCESS') {
            toast.success('Action executed successfully', { description: 'Changes applied to Meta Ads', duration: 3000 });
          } else if (status === 'EXECUTED_FAILED') {
            toast.error('Execution failed', { description: error || 'Unknown error', duration: 4000 });
          }
        }
      } catch (err) {
        console.error('[DecisionFeed] Failed to parse SSE message:', err);
      }
    },
    onError: (error) => {
      console.error('[DecisionFeed] SSE error:', error);
      if (sseState === 'FAILED') {
        toast.error('Real-time updates disconnected', { description: 'Refresh the page to reconnect', duration: 5000 });
      }
    },
    autoConnect: true,
    workspaceId: currentUser?.uid ?? null,
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 32000,
  });

  useEffect(() => {
    if (sseState === 'RECONNECTING' && state.isProcessing) {
      console.warn('[DecisionFeed] SSE dropped during execution, FSM will switch to polling');
      dispatch({ type: 'SSE_DISCONNECTED' });
    }
    if (sseMetrics.reconnectAttempts > 0) {
      console.log('[DecisionFeed] SSE metrics:', { state: sseState, attempts: sseMetrics.reconnectAttempts, downtime: sseMetrics.downtime, totalMessages: sseMetrics.totalMessages });
    }
  }, [sseState, sseMetrics, state.isProcessing, dispatch]);

  useEffect(() => {
    if (state.view === 'THEATER' && state.activeMode && state.inputData) {
      execute(state.activeMode, state.inputData, abortSignal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);

  useEffect(() => {
    if (state.view === 'API_EXECUTION' && state.outputData) {
      executeMetaAction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);

  async function executeMetaAction() {
    try {
      const verdict = state.outputData?.verdict;
      const actionTypeMap = { KILL: 'PAUSE_CAMPAIGN', PAUSE: 'PAUSE_CAMPAIGN', HOLD: 'PAUSE_CAMPAIGN', SCALE: 'SCALE_CAMPAIGN', OPTIMIZE: 'OPTIMIZE_CAMPAIGN' };
      const actionType = actionTypeMap[verdict] || 'PAUSE_CAMPAIGN';
      const targetId   = state.outputData?.action?.target_id || state.outputData?.targetId;
      const targetType = state.outputData?.action?.target_type || state.outputData?.targetType || 'campaign';

      if (!targetId) {
        reportError('Invalid target ID', 'INVALID_TARGET', 'validation', false, 'Target campaign/adset not found');
        return;
      }

      const payload = { actionType, targetId, targetType, idempotencyKey: crypto.randomUUID(), options: state.outputData?.options || {} };
      const response = await api.post('/api/execute/meta', payload, { timeout: 15000 });

      if (response.data.success) {
        const isReplay = response.data.idempotentReplay === true;
        toast.success(isReplay ? 'Action already executed' : 'Action executed successfully', {
          description: isReplay ? `${verdict} was previously applied to ${targetId}` : `${verdict} action applied to ${targetId}`,
          duration: 2000,
        });
        executionComplete();
      } else {
        reportError(response.data.error || 'Execution failed', response.data.code || 'EXECUTION_ERROR', 'platform', true, 'Check Meta Ads account and retry');
      }
    } catch (err) {
      let classification = 'network';
      let fallbackAction = 'Check your connection and retry';
      if (err.response?.status === 401 || err.response?.status === 403) { classification = 'auth'; fallbackAction = 'Please sign in again'; }
      else if (err.response?.status === 400 || err.response?.status === 422) { classification = 'validation'; fallbackAction = 'Review the action parameters and retry'; }
      else if (err.response?.status >= 500) { classification = 'platform'; fallbackAction = 'Meta API error - try again in a few moments'; }
      else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') { classification = 'network'; fallbackAction = 'Request timed out - please retry'; }
      reportError(err.response?.data?.error || err.message || 'Failed to execute action', err.response?.data?.code || err.code || 'UNKNOWN_ERROR', classification, true, fallbackAction);
    }
  }

  useEffect(() => {
    if (state.view !== 'MEMORY_COMMIT') return;
    toast.success('Action executed successfully', {
      description: `${state.outputData?.verdict} action applied via Meta API`,
      duration: 3000,
    });
    recordDecision({
      campaignId:        state.outputData?.campaignId ?? state.inputData?.campaignId ?? 'unknown',
      actionType:        state.outputData?.verdict ?? 'UNKNOWN',
      decisionRationale: state.outputData?.whyBreakdown?.[0] ?? state.outputData?.why ?? '',
    }).catch(() => {});
    const t = setTimeout(() => { commitToMemory(); refresh(); }, 500);
    return () => clearTimeout(t);
  }, [state.view, state.outputData, state.inputData, commitToMemory, recordDecision, refresh]);

  return {
    state, dispatch,
    startFlow, reviewAlert, submitInput, confirmExecution, executeAction,
    commitToMemory, reset, replay,
    execute, cancel,
    summary, sseState, sseMetrics,
    currentUser, metaStatus,
  };
}
