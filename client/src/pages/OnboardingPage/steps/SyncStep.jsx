import { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api.js';

// The sync is a single synchronous POST — it resolves when the pull is done, so
// completion is gated on the real request, not a fixed timer. The phase labels
// advance visually while it runs. On failure we STILL advance: ReadyStep shows an
// honest empty state rather than trapping the user on a spinner.
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
  const doneRef = useRef(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 1)), 600),
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 2)), 2000),
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 3)), 4500),
      setTimeout(() => { if (!doneRef.current) setHint('soon'); }, 30_000),
      setTimeout(() => { if (!doneRef.current) setHint('long'); }, 60_000),
    ];
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      setPhaseIdx(PHASES.length - 1);
      setTimeout(onComplete, 700);
    };
    api.post('/api/lumi/connections/sync', { datePreset: 'maximum' })
      .then(finish)
      .catch(finish);
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

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
                : active
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
    </div>
  );
}
