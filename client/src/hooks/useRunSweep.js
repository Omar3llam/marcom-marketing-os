// ============================================================
// MARCOM / Lumi — useRunSweep (Phase 9 · the manual agentic-loop trigger)
// ------------------------------------------------------------
// POST /api/lumi/loop/run → { workspaceId, loopRun, agenda }. Manually steers
// the proactive loop: re-runs the sweep so Lumi re-scans the account and
// re-PROPOSES (it NEVER executes anything — proposals still ride the existing
// confirm→execute path). The cron/on-read loop does this automatically; this is
// the human "do it now" steer.
//
// Role: BUYER+STRATEGIST operator tier (route gate) — a CLIENT seat is
// read-only. The view gates the button; the server stays the arbiter.
//
// Returns { runSweep, sweeping, error }. `runSweep()` resolves to the response
// (or null on failure) so the caller can refetch the feed + surface honestly.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function useRunSweep() {
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState(null);

  const runSweep = useCallback(async () => {
    setSweeping(true);
    setError(null);
    try {
      const res = await api.post('/api/lumi/loop/run');
      return res.data; // { workspaceId, loopRun, agenda }
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setSweeping(false);
    }
  }, []);

  return { runSweep, sweeping, error };
}
