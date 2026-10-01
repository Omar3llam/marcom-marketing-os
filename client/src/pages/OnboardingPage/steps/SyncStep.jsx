import { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api.js';
import { PRIMARY_BTN, GHOST_BTN } from './onboardingStyles.js';

// The sync is a single synchronous POST — it resolves when the pull is done, so
// completion is gated on the real request, not a fixed timer. The phase labels
// advance visually while it runs. Failure stays here; context saving is a
// separate completion operation and retrying that must not repeat the sync.
const PHASES = [
  'Connected to Meta',
  'Scanning campaigns…',
  'Calculating signals…',
  'Building verdicts…',
  'Preparing results…',
];

// A 'maximum' date-preset pull on a large account can outlast the phase list —
// and the api client gives up at 60s. Rather than leave the user watching a
// stalled timeline, say what is happening. Nothing here claims progress it
// can't see; both lines are about expectations, not state.
const HINTS = {
  soon: 'Large accounts can take a few minutes. Still working.',
  long: 'You can safely leave this page open — the sync continues.',
};

export function SyncStep({ onComplete }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [hint, setHint] = useState(null); // null | 'soon' | 'long'
  const [status, setStatus] = useState('running');
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const finishRef = useRef(null);
  const retryLock = useRef(true);
  const syncRequest = useRef(null);

  useEffect(() => {
    let active = true;
    let completionTimer;
    doneRef.current = false;
    retryLock.current = true;
    setStatus('running');
    setPhaseIdx(0);
    setHint(null);
    const timers = [
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 1)), 600),
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 2)), 2000),
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 3)), 4500),
      setTimeout(() => { if (!doneRef.current) setHint('soon'); }, 30_000),
      setTimeout(() => { if (!doneRef.current) setHint('long'); }, 60_000),
    ];
    const finish = () => {
      if (!active || doneRef.current) return;
      doneRef.current = true;
      setStatus('finishing');
      setHint(null);
      timers.forEach(clearTimeout);
      setPhaseIdx(PHASES.length - 1);
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
        if (data?.ok !== true || !(data.synced > 0) || !Array.isArray(data.results)) throw new Error('Sync not confirmed');
        if (data.results.some((result) => result.status !== 'success')) {
          timers.forEach(clearTimeout);
          setHint(null);
          setStatus('partial');
          retryLock.current = false;
        } else finish();
      })
      .catch(() => {
        if (!active) return;
        timers.forEach(clearTimeout);
        setHint(null);
        setStatus('failed');
        retryLock.current = false;
      });
    return () => {
      active = false;
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
    setAttempt((value) => value + 1);
  };

  // The timeline IS the progress indicator — no separate spinner above it.
  return (
    <div>
      <h1 className="decision-title text-lumi-text mb-2">Analyzing your account</h1>
      <p className="text-sm text-lumi-muted mb-8">This usually takes under a minute.</p>

      <div className="space-y-4">
        {PHASES.map((label, i) => {
          const done = i < phaseIdx;
          const active = i === phaseIdx;
          return (
            <div
              key={label}
              className={`flex items-center gap-3 transition-opacity duration-300 ${
                done || active ? 'opacity-100' : 'opacity-30'
              }`}
            >
              {done
                ? <CheckCircle2 className="w-[18px] h-[18px] text-signal-scale flex-shrink-0" strokeWidth={2} />
                : active && status === 'running'
                  ? <Loader2 className="w-[18px] h-[18px] text-lumi-accent animate-spin flex-shrink-0" strokeWidth={2} />
                  : <span className="w-[18px] h-[18px] rounded-full border border-lumi-border flex-shrink-0" />}
              <span
                className={`text-sm font-medium ${
                  // The active row was text-lumi-gold: 1.34:1 on the light
                  // surface. Weight carries the emphasis instead.
                  done ? 'text-lumi-muted' : active ? 'text-lumi-text font-semibold' : 'text-lumi-subtle'
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {hint && (
        <p className="text-xs text-lumi-muted text-center mt-6">{HINTS[hint]}</p>
      )}
      {status === 'failed' && (
        <div className="mt-6">
          <p role="alert" className="text-sm text-signal-kill mb-3">We couldn’t analyze your connections. Stay here and retry the sync.</p>
          <button type="button" onClick={retry} className={PRIMARY_BTN}>Retry sync</button>
        </div>
      )}
      {status === 'partial' && (
        <div className="mt-6">
          <p role="alert" className="text-sm text-lumi-muted mb-3">Some connections were analyzed; others failed or were skipped. You can retry or continue with the available results.</p>
          <button type="button" onClick={retry} className={`${PRIMARY_BTN} mb-3`}>Retry sync</button>
          <button type="button" onClick={() => finishRef.current?.()} className={GHOST_BTN}>Continue with available results</button>
        </div>
      )}
    </div>
  );
}
