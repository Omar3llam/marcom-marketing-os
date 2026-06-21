// ============================================================
// MARCOM / Lumi — useOnboardingContext
// ------------------------------------------------------------
// Reads the workspace's raw onboarding profile (user.context) — the same blob
// the onboarding wizard persisted and that ProtectedRoute already reads. Used
// where a feature needs the real onboarding signals (brand tone, industry,
// objective, audience), e.g. Content Lab grounding.
//
// We read user.context directly via GET /api/campaigns/me/context rather than
// piling fields onto /api/user/workspace: that endpoint surfaces only one
// onboarding field (industry) and would need per-field plumbing, whereas this
// one already returns the WHOLE context blob in a single call.
//
// Returns { context, loading, error }. context is null until loaded / when the
// account has no onboarding data — callers must treat null as "no signal".
// ============================================================
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext.jsx';
import { fetchContext } from '@/hooks/useOrchestrate/fetchers.js';

export function useOnboardingContext() {
  const { currentUser } = useAuth();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentUser) {
      setContext(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchContext(controller.signal)
      .then((ctx) => {
        if (controller.signal.aborted) return;
        setContext(ctx ?? null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setContext(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [currentUser]);

  return { context, loading, error };
}
