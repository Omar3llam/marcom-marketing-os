// ============================================================
// One experiment, read as a destination (B8-05)
// ------------------------------------------------------------
// EXPERIMENT has two producers and therefore two by-id reads, and R-E1 keeps
// them apart because their ENTITLEMENTS are genuinely different:
//
//   GET /tests/:id            requirePlan('PRO')
//   GET /incrementality/:id   requirePlan('PRO')  AND  requireMeasurementTier
//
// Those are two independent axes (measurement.js:28-33): a PRO workspace with
// measurementTier NONE still gets a 403 on the second. One shared address would
// have to satisfy the looser gate, which is how a by-id read becomes a way
// around the gate on the list it came from — the reasoning testing.js already
// applies to its own PRO gate.
//
// ── THE REFUSALS ────────────────────────────────────────────────────────────
//
//   404  no such row in this workspace   → NOT_FOUND      (COULD_NOT_LOOK)
//   403  the reader is not entitled      → NOT_PERMITTED  (CANNOT_ASK)
//   500 / unparseable / anything else    → UNREADABLE     (COULD_NOT_LOOK)
//
// B8-02's ruling holds: a failure is a MEASURED state, reported, never
// converted into an empty experiment. And C-07's holds on top of it — a token
// cannot replace a reason. Both 403s land on NOT_PERMITTED, but "upgrade your
// plan" and "measurement is not enabled for this workspace" are two different
// things for a person to do, so the REASON travels beside the token and the
// copy is chosen from it (exactly how B8-02's adapter is built: token for
// shape, reason for words).
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';
import { incrementalityGateReason } from './incrementalityGateReason.js';
import { KNOWLEDGE } from '@marcom/runtime-contracts';
import {
  TestExperimentDetailResponseSchema,
  IncrementalityDetailResponseSchema,
} from '@/contracts/schemas';

/** Why this experiment could not be shown. */
export const DETAIL_REFUSAL = Object.freeze({
  NOT_FOUND:     'NOT_FOUND',
  NOT_PERMITTED: 'NOT_PERMITTED',
  UNREADABLE:    'UNREADABLE',
});

/** PURE: the C-06 token a refusal carries, for `absenceState()`. */
export function knowledgeOfRefusal(refusal) {
  switch (refusal) {
    // "This question is not ours to ask" — no retry, no reload, no amount of
    // waiting changes an entitlement.
    case DETAIL_REFUSAL.NOT_PERMITTED: return KNOWLEDGE.CANNOT_ASK;
    // We learned nothing about the experiment either way.
    case DETAIL_REFUSAL.NOT_FOUND:
    case DETAIL_REFUSAL.UNREADABLE:    return KNOWLEDGE.COULD_NOT_LOOK;
    default: return null;
  }
}

// Preserve the existing A/B detail contract. Holdouts supply the strict shared
// classifier below: auth refusal is reachable and cannot establish tier depth.
function entitlementReason(err) {
  return err?.code === 'PLAN_REQUIRED' ? 'PLAN_REQUIRED' : 'NOT_ENTITLED';
}

/**
 * The shared loader. Both surfaces refuse identically; only the URL and the
 * response schema differ, and a second copy of this logic is how two halves of
 * one class drift apart — which is the defect B8-05 exists to stop repeating.
 */
function useByIdRead(id, { path, schema, reasonForError = entitlementReason }) {
  const [test, setTest] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [reason, setReason] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!id) { setIsLoading(false); setRefusal(DETAIL_REFUSAL.NOT_FOUND); return; }
    setIsLoading(true);
    setRefusal(null);
    setReason(null);
    try {
      const res = await api.get(`${path}/${encodeURIComponent(id)}`);
      if (!aliveRef.current) return;

      const parsed = schema.safeParse(res.data);
      if (!parsed.success) {
        // C-04: a field on the wire is not a field the client has. A shape we
        // cannot read is not an experiment we can show.
        setTest(null);
        setRefusal(DETAIL_REFUSAL.UNREADABLE);
        return;
      }
      setTest(parsed.data.test);
    } catch (err) {
      if (!aliveRef.current) return;
      if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
      const status = err?.httpStatus ?? err?.response?.status;
      setTest(null);
      if (status === 404) setRefusal(DETAIL_REFUSAL.NOT_FOUND);
      else if (status === 403) {
        setRefusal(DETAIL_REFUSAL.NOT_PERMITTED);
        setReason(reasonForError(err));
      } else setRefusal(DETAIL_REFUSAL.UNREADABLE);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, [id, path, schema, reasonForError]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  return { test, refusal, reason, isLoading, refetch: load };
}

/** One A/B experiment — `GET /api/lumi/tests/:id`. PRO. */
export function useTestDetail(id) {
  return useByIdRead(id, {
    path: '/api/lumi/tests',
    schema: TestExperimentDetailResponseSchema,
  });
}

/** One holdout — `GET /api/lumi/incrementality/:id`. PRO + measurement tier. */
export function useHoldoutDetail(id) {
  return useByIdRead(id, {
    path: '/api/lumi/incrementality',
    schema: IncrementalityDetailResponseSchema,
    reasonForError: incrementalityGateReason,
  });
}
