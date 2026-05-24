// ============================================================
// DecisionMemory — payload serializer / validator
// ============================================================
// Validates and normalizes a raw recordDecisionMemory() payload
// before it reaches the DB.  Throws on any missing or invalid field.
//
// Design note: signal types and outcomes are open strings — no
// closed enum yet.  The examples below are canonical but the
// system accepts any non-empty string so it can grow without a
// schema migration.
//
// Canonical signalType examples:
//   LOW_CTR, HIGH_CTR, CREATIVE_FATIGUE, AUDIENCE_SATURATION,
//   HIGH_CPC, LOW_ROAS, BUDGET_EXHAUSTION, CONVERSION_DROP
//
// Canonical outcome examples:
//   improved_ctr, improved_roas, reduced_cpm, reduced_cpc,
//   no_change, stabilized, worsened, pending
// ============================================================

/**
 * Validates and normalizes a raw memory payload.
 * Returns a clean object ready for prisma.decisionMemory.create({ data }).
 * Throws an Error with a user-readable message on any violation.
 */
export function serializeMemoryPayload(raw) {
  const {
    workspaceId,
    executionId,
    correlationId,
    decisionType,
    signalType,
    diagnosis,
    actionTaken,
    outcome,
    confidence,
  } = raw ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') throw new Error('workspaceId is required');
  if (!executionId || typeof executionId !== 'string') throw new Error('executionId is required');
  if (!decisionType || typeof decisionType !== 'string' || !decisionType.trim()) throw new Error('decisionType is required');
  if (!signalType   || typeof signalType   !== 'string' || !signalType.trim())   throw new Error('signalType is required');
  if (!diagnosis    || typeof diagnosis    !== 'string' || !diagnosis.trim())     throw new Error('diagnosis is required');
  if (!actionTaken  || typeof actionTaken  !== 'string' || !actionTaken.trim())   throw new Error('actionTaken is required');
  if (!outcome      || typeof outcome      !== 'string' || !outcome.trim())       throw new Error('outcome is required');

  const conf = Number(confidence);
  if (confidence === undefined || confidence === null || !Number.isFinite(conf) || conf < 0 || conf > 1) {
    throw new Error('confidence must be a number between 0 and 1 (inclusive)');
  }

  return {
    workspaceId:   workspaceId.trim(),
    executionId:   executionId.trim(),
    correlationId: correlationId ? String(correlationId).trim() : null,
    decisionType:  decisionType.trim(),
    signalType:    signalType.trim(),
    diagnosis:     diagnosis.trim(),
    actionTaken:   actionTaken.trim(),
    outcome:       outcome.trim(),
    confidence:    conf,
  };
}
