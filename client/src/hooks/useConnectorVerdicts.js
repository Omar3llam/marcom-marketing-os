// ============================================================
// MARCOM / Lumi — useConnectorVerdicts
// ------------------------------------------------------------
// Reads GET /api/lumi/entities/verdicts: the verdict engine run over the live
// connector campaigns that have MEASURED revenue. Campaigns without measured
// revenue come back in `gatedOut` (never scored) so the UI can show an honest
// "needs revenue data" state instead of a fabricated KILL.
//
// Returns: { verdicts, gatedOut, account, status, loading, error, refetch }
//   verdicts[]: { id, name, verdict, confidence, rationale, spendMinor, roas,
//                 revenueExpected, relativeRank, signalType, recommendationTypes,
//                 rootCause, dataConfidence, funnel }
//     rootCause      — machine-readable WHY (a funnel stage, INSUFFICIENT_DATA,
//                      TOO_EARLY, or a diagnosis signal). Distinguishes a WATCH
//                      that means "the landing page is broken" from one that
//                      means "not enough data yet" — same verdict, opposite
//                      implications.
//     dataConfidence — the input-quality half of `confidence` (the other half is
//                      the rule's own strength). Lets the UI say WHY confidence
//                      is low instead of just that it is.
//     funnel         — { signal, stage, evidence[], diagnosis, counterfactual,
//                      action } when a funnel stage was diagnosed, else null.
//                      NOTE its singular `counterfactual` is a PROSE sentence
//                      and a different thing from the array below.
//     hypotheses     — ranked candidate mechanisms, enum-keyed and never prose:
//                      { id, labelKey, source, supports[], contradicts[],
//                      observed[], confidence }. Nothing renders these yet.
//     counterfactuals— the alternatives set aside, one per rejected hypothesis:
//                      { mechanism, labelKey, rejectedBy[], preferredBecause[],
//                      confidence }. `[]` when there was no second candidate to
//                      argue against — a real answer, not a missing one.
//                      As of the reasoning snapshot both of these are also
//                      FROZEN onto the Decision row when a sweep persists a
//                      verdict, so what a client sees here (recomputed from
//                      today's signals) and what a stored decision carries
//                      (what we believed then) can legitimately differ.
//   gatedOut[]: { id, name, reason }
//
// Rows pass through WHOLE — this hook never projects a subset, so a new engine
// field reaches consumers without a change here.
//
// Disjoint from the CSV feed (useCampaignFeed) and from useConnectorCampaigns —
// this hook adds the engine verdict on top of the same connector substrate.
// useEffect has a cleanup guard (no setState after unmount) per the ONE WAY rules.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useConnectorVerdicts() {
  const [verdicts, setVerdicts] = useState([]);
  const [gatedOut, setGatedOut] = useState([]);
  const [account, setAccount] = useState(null);
  // Past decisions per campaign, keyed by entityId. A SEPARATE map, never a
  // field on a verdict: the verdict is what Lumi thinks now and this is what it
  // said before, and merging them would let history edit the current call.
  const [memory, setMemory] = useState({});
  // C-03 — whether `memory` above is an answer or a silence. An account that has
  // judged nothing and a failed history read both arrive as `{}`, so the map
  // cannot say which, and a surface reading only the map turns our outage into
  // "Lumi has never judged this campaign".
  //
  // Separate from `status` below, which is the verdict feed's own readiness.
  // The feed can be perfectly healthy while the history read failed.
  //
  // C-06 — NAMED AS THE SERVER NAMES IT. This used to be `memoryStatus`, which
  // undid the one thing the projection went out of its way to do: two different
  // things in that payload wear the word "memory", and the server spells this
  // one out in full so a reader cannot mistake the past DECISIONS for the
  // account's validated PATTERNS. Renaming it on arrival re-collapsed exactly
  // that distinction, three files downstream of the comment forbidding it.
  const [decisionHistoryStatus, setDecisionHistoryStatus] = useState(null);
  // The same fact as a KNOWLEDGE token (C-06): COULD_NOT_LOOK, KNOWN, and so
  // on. What lets a component act on the CLASS of an absence without learning
  // this vocabulary — and what stops the next component matching a string.
  const [decisionHistoryKnowledge, setDecisionHistoryKnowledge] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/entities/verdicts');
      if (!aliveRef.current) return;
      setVerdicts(Array.isArray(res.data?.verdicts) ? res.data.verdicts : []);
      setGatedOut(Array.isArray(res.data?.gatedOut) ? res.data.gatedOut : []);
      setAccount(res.data?.account ?? null);
      setMemory(res.data?.memoryByEntityId ?? {});
      // null, not 'OK', when the server said nothing about it: the field is
      // additive, and a response that predates it has made no claim either way.
      // The view model treats null exactly as OK, so an older payload keeps the
      // behaviour it has always had rather than growing an outage notice.
      setDecisionHistoryStatus(res.data?.decisionHistoryStatus ?? null);
      setDecisionHistoryKnowledge(res.data?.decisionHistoryKnowledge ?? null);
      setStatus(res.data?.status ?? null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refetch();
    return () => { aliveRef.current = false; };
  }, [refetch]);

  return {
    verdicts, gatedOut, account, memory,
    decisionHistoryStatus, decisionHistoryKnowledge,
    status, loading, error, refetch,
  };
}
