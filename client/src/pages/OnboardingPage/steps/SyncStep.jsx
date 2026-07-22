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

export function SyncStep({ onComplete }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 1)), 600),
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 2)), 2000),
      setTimeout(() => setPhaseIdx((i) => Math.max(i, 3)), 4500),
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

  return (
    <div className="text-center">
      <Loader2 className="w-8 h-8 text-lumi-gold animate-spin mx-auto mb-3" strokeWidth={1.5} />
      <h1 className="decision-title text-lumi-text">Analyzing your campaigns</h1>
      <p className="text-sm text-lumi-muted mb-8">This usually takes under a minute.</p>

      <div className="space-y-3 text-left">
        {PHASES.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            {i < phaseIdx
              ? <CheckCircle2 className="w-4 h-4 text-signal-scale flex-shrink-0" strokeWidth={2} />
              : i === phaseIdx
                ? <Loader2 className="w-4 h-4 text-lumi-gold animate-spin flex-shrink-0" strokeWidth={2} />
                : <span className="w-4 h-4 rounded-full border border-lumi-border flex-shrink-0" />}
            <span className={`text-sm ${i < phaseIdx ? 'text-lumi-text' : i === phaseIdx ? 'text-lumi-gold' : 'text-lumi-muted'}`}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
