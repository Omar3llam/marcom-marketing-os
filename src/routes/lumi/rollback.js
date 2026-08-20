// ============================================================
// MARCOM / Lumi — Rollback handler
// POST /api/lumi/rollback/:actionId
// ============================================================
// R13-D / B3-C — RETIRED. This endpoint never performed a platform mutation,
// and it now says so instead of behaving as though it had.
//
// WHAT IT USED TO DO, and why none of it reached an ad account:
//
//   1. load an Action whose status is EXECUTED_SUCCESS, within a 24h window
//   2. build an inverse payload (pause ↔ resume, budget restore)
//   3. create the inverse as a PENDING Action, mark the original ROLLED_BACK
//   4. enqueue it onto the `actions` queue
//
// Step 4 handed the work to actionWorker, whose executor registry returned
// `{ ok: true, result: { stub: true } }` without calling Meta or Google. The
// inverse Action then reached EXECUTED_SUCCESS with `executedAt` stamped. So a
// rollback — the one operation whose entire purpose is undoing a real change on
// a real ad account — reported that it had succeeded while the campaign carried
// on exactly as before.
//
// It could not even reach that point. Step 1 requires an existing Action row,
// and the ONLY `action.create` anywhere in the repository was step 3 of this
// same handler: the inverse of a row that nothing else ever minted. The table
// is empty by construction, so this handler could never fire — the same
// self-sealing emptiness B3 found in `execution_requests`.
//
// WHY THIS IS A REFUSAL AND NOT A MIGRATION. Rolling back a real execution
// means inverting a persisted ExecutionRequest (PAUSE_CAMPAIGN → RESUME_CAMPAIGN)
// through POST /api/execute/meta, with attribution and lineage back to the
// original. That is a capability to BUILD, not one to move: there is nothing
// here to carry over, because nothing here ever mutated anything. Inventing it
// inside a retirement slice would be a second execution path — the exact thing
// this consolidation removes. It is named as remaining backend debt instead.
//
// The route is kept rather than deleted so a caller receives an explicit,
// machine-readable answer instead of a 404 that reads like a routing bug.
// ============================================================
import { Router } from 'express';
import { logger } from '../../utils/logger.js';

export const rollbackRouter = Router();

/** Shared by both retired legacy endpoints, so they cannot drift apart. */
export const LEGACY_RETIRED_CODE = 'LEGACY_EXECUTION_RETIRED';

// ─────────────────────────────────────────────────────────────
rollbackRouter.post('/:actionId', async (req, res) => {
  const { actionId } = req.params;

  // Authorization is still evaluated first. The answer below is the same either
  // way, but a caller without the seat should learn that before learning
  // anything about the feature — and removing the gate would quietly widen who
  // may probe the endpoint.
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (req.userRole !== 'ADMIN') {
    logger.warn({ actionId, userId: req.userId, userRole: req.userRole }, '[lumi/rollback] forbidden');
    return res.status(403).json({ error: 'Forbidden' });
  }

  logger.warn(
    { actionId, userId: req.userId, workspaceId: req.workspaceId },
    '[lumi/rollback] refused — legacy Action execution substrate is retired',
  );

  // 501, not 200-with-a-flag and not 410. The capability is not implemented on
  // the canonical path; it is not a resource that used to exist and went away.
  //
  // NOTHING IS WRITTEN BEFORE THIS RETURN. No Action row is created, the
  // original is not marked ROLLED_BACK, and no AuditLog is written — recording
  // a rollback that did not happen is the same lie in a different table.
  return res.status(501).json({
    error:   'RollbackUnsupported',
    code:    LEGACY_RETIRED_CODE,
    message:
      'Rollback ran on the legacy Action substrate, which performed no real platform '
      + 'mutation and has been retired. Nothing was changed on your ad account by this '
      + 'request, and nothing was changed by the action it refers to.',
    rolledBack: false,
  });
});
