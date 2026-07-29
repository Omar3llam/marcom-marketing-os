// ============================================================
// MARCOM / Lumi — useDecisionLearning
// ------------------------------------------------------------
// The track record behind a campaign's live verdict: how comparable decisions
// turned out after someone acted on them.
//
// `null` is the expected answer most of the time — no live verdict, too small a
// sample, or nothing that improved. The route returns 200 with learning: null
// for all three, so this hook has no error state to surface: there is nothing a
// user could do about "we have no track record yet", and a young workspace has
// no track record for almost anything. A failed request is indistinguishable
// from no data, on purpose.
// ============================================================
import { useState, useEffect } from 'react';
import { api } from '@/lib/api.js';

export function useDecisionLearning(entityId) {
  const [learning, setLearning] = useState(null);

  useEffect(() => {
    if (!entityId) { setLearning(null); return undefined; }

    // Cancelled on unmount / entity change so a slow response for a collapsed
    // row can never land on top of a newer one.
    let live = true;
    setLearning(null); // clear immediately — never show one campaign's record under another

    api.get(`/api/lumi/decisions/by-entity/${encodeURIComponent(entityId)}/learning`)
      .then((res) => { if (live) setLearning(res.data?.learning ?? null); })
      .catch(() => { if (live) setLearning(null); });

    return () => { live = false; };
  }, [entityId]);

  return learning;
}
