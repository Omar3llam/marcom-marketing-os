import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api.js';
import { PRIMARY_BTN, GHOST_BTN } from './onboardingStyles.js';
import { syncFailureState } from './syncFailureState.js';

// The sync is a single synchronous POST — it resolves when the pull is done, so
// completion is gated on the real request, not a fixed timer. No intermediate
// stages are acknowledged by this contract. Failure stays here; context saving is a
// separate completion operation and retrying that must not repeat the sync.
// Elapsed time may change waiting copy, but cannot prove processing progress.
const HINTS = {
  soon: 'Large accounts may take longer. Waiting for sync results.',
  long: 'Still waiting for sync results. Keep this page open.',
};
const FAILURE_COPY = {
  NOT_PERMITTED: 'This seat can’t start a connection sync. Ask a workspace operator with sync access to continue.',
  AUTH_REQUIRED: 'Your session needs authentication. Sign in again before starting a sync.',
  INVALID_CONTEXT: 'Lumi couldn’t start this sync with the current workspace setup.',
  RETRYABLE: 'We couldn’t analyze your connections. Stay here and retry the sync.',
  FAILED: 'This sync request couldn’t be completed.',
};

export function SyncStep({ onComplete }) {
  const [hint, setHint] = useState(null); // null | 'soon' | 'long'
  const [status, setStatus] = useState('running');
  const [failure, setFailure] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const finishRef = useRef(null);
  const retryLock = useRef(true);
  const syncRequest = useRef(null);

  useEffect(() => {
    let active = true;
    let waiting = true;
    let completionTimer;
    doneRef.current = false;
    retryLock.current = true;
    setStatus('running');
    setFailure(null);
    setHint(null);
    const timers = [
      setTimeout(() => { if (active && waiting) setHint('soon'); }, 30_000),
      setTimeout(() => { if (active && waiting) setHint('long'); }, 60_000),
    ];
    const finish = () => {
      if (!active || doneRef.current) return;
      waiting = false;
      doneRef.current = true;
      setStatus('finishing');
      setHint(null);
      timers.forEach(clearTimeout);
      completionTimer = setTimeout(() => {
        if (active) {
          setStatus('complete');
          completeRef.current();
        }
      }, 700);
    };
    finishRef.current = finish;
    if (syncRequest.current?.attempt !== attempt) {
      syncRequest.current = { attempt, promise: api.post('/api/lumi/connections/sync', { datePreset: 'maximum' }) };
    }
    syncRequest.current.promise
      .then(({ data }) => {
        if (!active) return;
        waiting = false;
        if (data?.ok !== true || !(data.synced > 0) || !Array.isArray(data.results)) throw new Error('Sync not confirmed');
        if (data.results.some((result) => result.status !== 'success')) {
          timers.forEach(clearTimeout);
          setHint(null);
          setStatus('partial');
          retryLock.current = false;
        } else finish();
      })
      .catch((err) => {
        if (!active) return;
        waiting = false;
        timers.forEach(clearTimeout);
        setHint(null);
        const outcome = syncFailureState(err);
        setFailure(outcome);
        setStatus('failed');
        retryLock.current = !outcome.retryable;
      });
    return () => {
      active = false;
      waiting = false;
      timers.forEach(clearTimeout);
      clearTimeout(completionTimer);
      finishRef.current = null;
    };
  }, [attempt]);

  const retry = () => {
    if (retryLock.current) return;
    retryLock.current = true;
    finishRef.current = null;
    setStatus('running');
    setFailure(null);
    setHint(null);
    setAttempt((value) => value + 1);
  };

  return (
    <div data-lumi-env="product" className="bg-[var(--lumi-color-surface-base)]">
      <h1 className="decision-title text-[var(--lumi-color-text-claim)] mb-2">Analyzing your account</h1>
      <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)] mb-8">Sync results will appear when the request finishes.</p>

      {status === 'running' ? (
        <div role="status" className="flex items-center gap-3 text-[length:var(--lumi-type-body-default-size)] font-medium text-[var(--lumi-color-text-claim)]">
          Syncing your workspace…
        </div>
      ) : (status === 'finishing' || status === 'complete') && (
        <p role="status" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-claim)]">Sync results received.</p>
      )}

      {hint && (
        <p className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] text-center mt-6">{HINTS[hint]}</p>
      )}
      {status === 'failed' && (
        <div className="mt-6">
          <p role="alert" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-state-failed-foreground)] mb-3">{FAILURE_COPY[failure?.kind]}</p>
          {failure?.retryable && <button type="button" onClick={retry} className={PRIMARY_BTN}>Retry sync</button>}
        </div>
      )}
      {status === 'partial' && (
        <div className="mt-6">
          <p role="alert" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)] mb-3">Some connections were analyzed; others failed or were skipped. You can retry or continue with the available results.</p>
          <button type="button" onClick={retry} className={`${PRIMARY_BTN} mb-3`}>Retry sync</button>
          <button type="button" onClick={() => finishRef.current?.()} className={GHOST_BTN}>Continue with available results</button>
        </div>
      )}
    </div>
  );
}
