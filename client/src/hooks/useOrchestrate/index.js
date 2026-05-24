import { useCallback, useRef } from 'react';
import axios from 'axios';
import { fetchContext, runCampaignFlow, runContentFlow, runStrategyFlow, delay } from './fetchers.js';

export function useOrchestrate({ onSuccess, onError, onStep }) {
  const abortRef = useRef(null);
  const timeoutRef = useRef(null);

  const execute = useCallback(async (mode, inputData) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    // Global orchestration timeout (90s max)
    timeoutRef.current = setTimeout(() => {
      abortRef.current?.abort();
      onError('Orchestration timeout - analysis took longer than expected', 'TIMEOUT');
    }, 90_000);

    try {
      onStep(0);
      await delay(450);

      onStep(1);
      const contextLock = await fetchContext(signal).catch(() => null);

      onStep(2);

      let result;
      if (mode === 'campaign') {
        result = await runCampaignFlow(inputData, contextLock, signal);
      } else if (mode === 'content') {
        result = await runContentFlow(inputData, contextLock, signal);
      } else if (mode === 'strategy') {
        result = await runStrategyFlow(inputData, contextLock, signal);
      } else {
        throw new Error(`Unknown mode: ${mode}`);
      }

      onStep(3);
      await delay(350);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      onSuccess(result);
    } catch (err) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (axios.isCancel?.(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;

      const status  = err?.response?.status;
      const message = err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'Unknown error';
      const code    = status ? String(status) : 'NETWORK_ERROR';

      onError(message, code);
    }
  }, [onSuccess, onError, onStep]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return { execute, cancel };
}
