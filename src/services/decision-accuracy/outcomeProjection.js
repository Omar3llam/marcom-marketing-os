import { KNOWLEDGE } from '@marcom/runtime-contracts';
import { MONETARY_REASON } from '../../lib/operationalMonetary.js';

// OutcomeSnapshot stores human-reported deltas, but no authoritative monetary
// denomination. Its operational evidence reference does not attest those values.
// This is publication containment, including zero/new rows, not history repair.
export function outcomeMonetaryEvidence() {
  return {
    status: 'INSUFFICIENT_EVIDENCE',
    reason: MONETARY_REASON.OUTCOME_MONETARY_BASIS_UNPROVEN,
    knowledge: KNOWLEDGE.NOT_ENOUGH,
    spendDeltaMinor: null,
    revenueDeltaMinor: null,
    currency: null,
  };
}

// The POST receipt keeps its existing row identity/facts. Only explicitly named
// fields can cross this boundary; neither contextual currency nor extra raw
// fields can authorize or smuggle historical monetary values into the response.
export function projectOutcomeSnapshot(row) {
  if (!row) return null;
  const monetary = outcomeMonetaryEvidence();
  return {
    id: row.id, workspaceId: row.workspaceId, decisionId: row.decisionId,
    entityId: row.entityId, entityLevel: row.entityLevel,
    measuredAt: row.measuredAt ?? null, createdAt: row.createdAt,
    windowStart: row.windowStart ?? null, windowEnd: row.windowEnd ?? null,
    sustained: row.sustained ?? null,
    // Independently entered human-reported unitless comparison, not calculated
    // from the stored spend/revenue deltas and not a platform-verified result.
    roasDelta: row.roasDelta ?? null,
    spendDeltaMinor: monetary.spendDeltaMinor,
    revenueDeltaMinor: monetary.revenueDeltaMinor,
    currency: monetary.currency,
    monetary,
    evidenceReference: row.evidenceReference ?? null,
    supersededAt: row.supersededAt ?? null,
    supersededById: row.supersededById ?? null,
  };
}
