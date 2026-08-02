// ============================================================
// MARCOM / Lumi — useDismissals (Home · the interrupt storage seam)
// ------------------------------------------------------------
// The only place the Home page touches sessionStorage. Two keys with DIFFERENT
// polarity, which is exactly why they were confusing inline:
//
//   marcom:firstActivation        present ⇒ SHOW  (written by onboarding,
//                                 removed when the step is done)
//   lumi:revenue-prompt-dismissed present ⇒ HIDE  (written on dismissal)
//
// Both are read ONCE at mount via useState initialisers, as before — a re-read
// per render would let a dismissal in another tab yank a banner mid-interaction.
//
// The first-run flag also self-retires the instant data lands, so the guided
// "connect a channel" step never resurfaces on a later visit.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { INTERRUPT } from './overviewInterrupts.js';

const FIRST_RUN_KEY = 'marcom:firstActivation';
const REVENUE_KEY   = 'lumi:revenue-prompt-dismissed';

const read   = (k) => (typeof window !== 'undefined' ? window.sessionStorage?.getItem(k) : null);
const write  = (k) => { if (typeof window !== 'undefined') window.sessionStorage?.setItem(k, '1'); };
const remove = (k) => { if (typeof window !== 'undefined') window.sessionStorage?.removeItem(k); };

export function useDismissals({ hasAnyData = false } = {}) {
  const [firstRunFlag, setFirstRunFlag] = useState(() => read(FIRST_RUN_KEY) === '1');
  const [dismissed, setDismissed] = useState(() => {
    const s = new Set();
    if (read(REVENUE_KEY) === '1') s.add(INTERRUPT.REVENUE);
    return s;
  });

  const retireFirstRun = useCallback(() => {
    remove(FIRST_RUN_KEY);
    setFirstRunFlag(false);
  }, []);

  useEffect(() => {
    if (firstRunFlag && hasAnyData) retireFirstRun(); // data arrived → guided step is done
  }, [firstRunFlag, hasAnyData, retireFirstRun]);

  const dismiss = useCallback((id) => {
    if (id === INTERRUPT.FIRST_RUN) { retireFirstRun(); return; }
    if (id === INTERRUPT.REVENUE) {
      write(REVENUE_KEY);
      setDismissed((prev) => new Set(prev).add(INTERRUPT.REVENUE));
    }
    // CONNECT has no dismissal — it is the empty state, not a nudge, and an
    // account with nothing connected has nothing else to show.
  }, [retireFirstRun]);

  return { firstRunFlag, dismissed, dismiss };
}
